import json, os, ssl, subprocess, time, urllib.request
import urllib.error

APP = r'C:\Users\Lyon\AppData\Roaming\WorkDaddy'
API = 'http://127.0.0.1:47832'
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
op = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ctx))
token = open(os.path.join(APP, '.api-token'), encoding='utf-8').read().strip()
log = []


def api(path, timeout=8):
    req = urllib.request.Request(API + path, headers={'X-WorkDaddy-Token': token})
    with op.open(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


st = api('/api/status')
old = st.get('pid')
lock = json.load(open(os.path.join(APP, '.daemon.lock'), encoding='utf-8'))
log.append('before pid=%s buildId=%s lock.pid=%s' % (old, st.get('buildId'), lock.get('pid')))
if str(lock.get('pid')) != str(old):
    log.append('PID MISMATCH -> abort')
else:
    r = subprocess.run(['taskkill', '/F', '/PID', str(old)], capture_output=True, timeout=30)
    log.append('taskkill rc=%d' % r.returncode)
    new = None
    for i in range(45):
        time.sleep(1)
        try:
            s = api('/api/status', timeout=4)
            if str(s.get('pid')) != str(old):
                new = s
                break
        except Exception:
            pass
    log.append('after pid=%s buildId=%s waited=%ds' % ((new or {}).get('pid'), (new or {}).get('buildId'), i + 1) if new else 'RESTART FAILED')

open(r'D:\WorkDaddy\.wd-tmp\_restart2.txt', 'w', encoding='utf-8').write('\n'.join(log))
print('\n'.join(log))
