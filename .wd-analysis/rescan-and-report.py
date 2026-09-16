# -*- coding: utf-8 -*-
"""触发全量空间重扫并等待收尾（daemon 重启后旧 v2 缓存会被丢弃，必须重扫一次）。"""
import json
import time
import urllib.request

TOKEN = open(r'C:\Users\Lyon\AppData\Roaming\WorkDaddy\.api-token', encoding='utf-8').read().strip()
HEADERS = {'x-workdaddy-token': TOKEN}
BASE = 'http://127.0.0.1:47832'


def call(path, method='GET'):
    req = urllib.request.Request(BASE + path, method=method, headers=HEADERS)
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8'))


print('start:', json.dumps(call('/api/space/scan/start', 'POST'), ensure_ascii=False)[:200], flush=True)
t0 = time.time()
status = None
while time.time() - t0 < 420:
    st = call('/api/space/scan/status')
    # ⚠️ 进度在 resp.job 里（接口是 {ok, job, cached}），读顶层永远是 None —— 会白轮询到超时。
    job = st.get('job') or {}
    status = job.get('status')
    print('  %3.0fs status=%s processed=%s hasResult=%s' % (
        time.time() - t0, status, job.get('processed'), job.get('hasResult')), flush=True)
    if status in ('done', 'cancelled', 'error'):
        break
    time.sleep(10)

body = call('/api/space/scan/result')
result = body.get('result') or {}
print('RESULT version=%s spaces=%s sessions=%s conversations=%s' % (
    result.get('version'), len(result.get('spaces') or []),
    len(result.get('sessions') or []), len(result.get('conversations') or [])), flush=True)
for s in (result.get('spaces') or [])[:10]:
    conv = s.get('conversations') or []
    print('  %s | %6.1fMB %d文件 %s份记录 -> %s' % (
        s.get('cwd'), (s.get('bytes') or 0) / 1048576, s.get('files') or 0, s.get('sessions') or 0,
        ' | '.join('%s(%.1fMB x%d)' % (c.get('title'), (c.get('bytes') or 0) / 1048576, c.get('sessions'))
                   for c in conv) or '(无会话记录)'), flush=True)
