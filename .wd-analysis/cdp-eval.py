#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Minimal CDP client for the WorkBuddy renderer (port 9222).

Usage:
  python cdp-eval.py eval <file-with-js>
  python cdp-eval.py shot <out.png> [--clip-selector "<css>"]
  python cdp-eval.py targets

Used by WorkDaddy maintenance to verify injected-UI changes against the real
renderer instead of guessing from source. Keep it dependency-light:
websocket-client + PIL only.
"""
import json
import sys
import base64
import urllib.request

import websocket  # websocket-client

CDP_PORT = 9222


def target_ws():
    data = json.loads(urllib.request.urlopen(
        "http://127.0.0.1:%d/json/list" % CDP_PORT, timeout=5).read().decode("utf-8"))
    pages = [t for t in data if t.get("type") == "page" and "webSocketDebuggerUrl" in t]
    if not pages:
        raise SystemExit("no page target with ws url")
    return pages[0]["webSocketDebuggerUrl"]


class Client:
    def __init__(self):
        # Chromium rejects WS handshakes carrying an Origin header unless the
        # browser was started with --remote-allow-origins; suppress it like the
        # daemon's own CDP client does.
        self.ws = websocket.create_connection(
            target_ws(), timeout=60, suppress_origin=True, origin=None,
            header=["User-Agent: workdaddy-maintain"])
        self.id = 0

    def send(self, method, params=None):
        self.id += 1
        mid = self.id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(json.dumps(msg["error"], ensure_ascii=False))
                return msg.get("result")

    def evaluate(self, expr, await_promise=True):
        r = self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": await_promise,
        })
        if r.get("exceptionDetails"):
            detail = r["exceptionDetails"]
            text = detail.get("exception", {}).get("description") or detail.get("text")
            raise RuntimeError("page error: " + str(text)[:800])
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    mode = sys.argv[1]
    if mode == "targets":
        print(urllib.request.urlopen(
            "http://127.0.0.1:%d/json/list" % CDP_PORT, timeout=5).read().decode("utf-8"))
        return
    c = Client()
    try:
        if mode == "eval":
            expr = open(sys.argv[2], encoding="utf-8").read()
            # {{NAME}} tokens can be supplied as --set NAME=jsValue (raw JS, not JSON).
            rest = sys.argv[3:]
            i = 0
            while i < len(rest):
                if rest[i] == "--set" and i + 1 < len(rest):
                    pair = rest[i + 1]
                    i += 2
                elif rest[i].startswith("--set "):
                    pair = rest[i][6:]
                    i += 1
                else:
                    i += 1
                    continue
                if "=" in pair:
                    key, value = pair.split("=", 1)
                    expr = expr.replace("{{%s}}" % key, value)
            out = c.evaluate(expr)
            print(json.dumps(out, ensure_ascii=False, indent=2))
        elif mode == "shot":
            out = sys.argv[2]
            clip = None
            if "--clip-selector" in sys.argv:
                sel = sys.argv[sys.argv.index("--clip-selector") + 1]
                box = c.evaluate(
                    "(function(){var e=document.querySelector(%s);if(!e)return null;"
                    "var r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()"
                    % json.dumps(sel))
                if box:
                    clip = {"x": box["x"], "y": box["y"], "width": box["width"],
                            "height": box["height"], "scale": 1}
            params = {"format": "png", "captureBeyondViewport": False}
            if clip:
                params["clip"] = clip
            r = c.send("Page.captureScreenshot", params)
            png = base64.b64decode(r["data"])
            open(out, "wb").write(png)
            print("saved", out, len(png), "bytes")
        else:
            raise SystemExit(__doc__)
    finally:
        c.close()


if __name__ == "__main__":
    main()
