#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
restart-daemon.py —— 重启 WorkDaddy daemon（不重启 WorkBuddy）。

来源：workdaddy-maintain skill §B.2.2。daemon.js / 被 require 的模块不热更，
只有 inject.js 能靠 POST /api/inject 热更；所以改了后端就必须重启 daemon。

流程：取 pid（/api/status 与 %APPDATA%\\WorkDaddy\\.daemon.lock 互校）→ taskkill /F /PID
      → 等 watchdog 自动 respawn（延迟 3s 起）→ 轮询 /api/status 直到 buildId 变化
      → 顺带热更 inject.js → 探一遍新接口。

用法：
  python restart-daemon.py          # 常规：buildId 已变则跳过
  python restart-daemon.py force    # 强制重拉（改了「被 require 的模块」但没动 daemon.js 时用；
                                    #  此时 buildId 不变，不加 force 会被误判成「已是新构建」）
  python restart-daemon.py --probe=/api/thinking-stats   # 重启后顺带探指定端点（可多个）
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

PORT = 47832
BASE = 'http://127.0.0.1:%d' % PORT
TOKEN_FILE = os.path.join(os.environ.get('APPDATA', ''), 'WorkDaddy', '.api-token')
LOCK_FILE = os.path.join(os.environ.get('APPDATA', ''), 'WorkDaddy', '.daemon.lock')
FORCE = 'force' in sys.argv

# 系统代理会把 127.0.0.1 也拦掉（见过 /api/status 返 502）⇒ 一律绕开代理。
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def token():
    try:
        with open(TOKEN_FILE, 'r', encoding='utf-8-sig') as handle:
            return handle.read().strip()
    except Exception:
        return ''


def get(path, timeout=20):
    request = urllib.request.Request(BASE + path)
    request.add_header('X-WorkDaddy-Token', token())
    with OPENER.open(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def post(path, body=b'', timeout=20):
    request = urllib.request.Request(BASE + path, data=body, method='POST')
    request.add_header('X-WorkDaddy-Token', token())
    with OPENER.open(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def status_soft():
    try:
        return get('/api/status', timeout=5)
    except Exception:
        return None


def workbuddy_pids():
    """WorkBuddy.exe 进程数 —— 重启前后必须不变（证明没碰到用户正在用的客户端）。"""
    try:
        out = subprocess.check_output(
            ['powershell', '-NoProfile', '-Command',
             "(Get-Process WorkBuddy -ErrorAction SilentlyContinue | Measure-Object).Count"],
            stderr=subprocess.DEVNULL).decode('utf-8', 'replace').strip()
        return out
    except Exception:
        return '?'


def main():
    before = status_soft()
    if not before:
        print('[x] daemon 没有响应 %s/api/status —— 先确认它是不是在跑' % BASE)
        return 1
    old_pid = before.get('pid')
    old_build = before.get('buildId')
    print('[1] 老构建 pid=%s buildId=%s' % (old_pid, old_build))

    # pid 一致性互校：/api/status 报的 pid 必须等于 .daemon.lock 里写的那个
    try:
        with open(LOCK_FILE, 'r', encoding='utf-8-sig') as handle:
            lock_pid = json.loads(handle.read()).get('pid')
        if lock_pid and old_pid and int(lock_pid) != int(old_pid):
            print('[!] .daemon.lock 的 pid=%s 与 /api/status 的 pid=%s 不一致 —— 中止，先排查' % (lock_pid, old_pid))
            return 1
        print('[2] pid 与 .daemon.lock 一致（%s）' % old_pid)
    except Exception as error:
        print('[!] 读 .daemon.lock 失败（%s）—— 跳过互校继续' % error)

    wb_before = workbuddy_pids()

    print('[3] taskkill /F /PID %s' % old_pid)
    subprocess.call(['taskkill', '/F', '/PID', str(old_pid)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    deadline = time.time() + 90
    new_status = None
    while time.time() < deadline:
        time.sleep(3)
        current = status_soft()
        if not current:
            continue
        changed = str(current.get('buildId')) != str(old_build) or str(current.get('pid')) != str(old_pid)
        if changed or FORCE:
            new_status = current
            break
    if not new_status:
        print('[x] 90 秒内 daemon 没回来。看 %s\\daemon.log / watchdog.log；'
              'watchdog 退避最长 60s，必要时等一轮再看' % os.path.dirname(LOCK_FILE))
        return 1
    print('[4] 新构建 pid=%s buildId=%s' % (new_status.get('pid'), new_status.get('buildId')))

    wb_after = workbuddy_pids()
    print('[5] WorkBuddy 进程数 %s → %s %s' % (wb_before, wb_after, '（未变 ✓）' if wb_before == wb_after else '（变了！）'))

    # 顺带热更 inject.js（daemon 每次注入都现读磁盘）
    try:
        injected = post('/api/inject')
        print('[6] 热更 inject.js → %s' % json.dumps(injected, ensure_ascii=False)[:160])
    except Exception as error:
        print('[!] 热更 inject.js 失败：%s' % error)

    # 探一轮「本轮新接口」—— 默认不探任何 feature 专属路由（避免下一轮留下假报错）；
    # 需要时用 --probe=/api/xxx 显式指定，可给多个。
    probes = [a.split('=', 1)[1] for a in sys.argv if a.startswith('--probe=')]
    for path in probes:
        try:
            print('[7] %s → %s' % (path, json.dumps(get(path), ensure_ascii=False)[:200]))
        except Exception as error:
            print('[!] %s 探测失败：%s' % (path, error))

    # 收尾提醒：403/404 经常是「新路由没生效」的伪装，这里给出判据
    # ⚠️ 刻意不做 feature 名硬编码（形状匹配即可）—— 硬编码 feature 名会让下一轮改动假红。
    if not re.match(r'^release-\d+\.\d+\.\d+-\d{8}-[a-z0-9-]+-r\d+', str(new_status.get('buildId') or '')):
        print('[i] 提示：buildId 形状异常（%s）—— 确认改的是不是 D:\\WorkDaddy\\scripts\\daemon.js，'
              '以及 DAEMON_BUILD_ID 是否已 bump' % new_status.get('buildId'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
