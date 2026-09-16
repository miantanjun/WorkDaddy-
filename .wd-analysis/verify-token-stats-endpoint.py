# -*- coding: utf-8 -*-
"""端到端验证：重启后的 daemon 通过 /api/token-stats 返回的账号维度用量是否正确。"""
import json
import urllib.request

TOKEN = open(r'C:\Users\Lyon\AppData\Roaming\WorkDaddy\.api-token', encoding='utf-8').read().strip()
HEADERS = {'x-workdaddy-token': TOKEN}
BASE = 'http://127.0.0.1:47832'
UID177 = '028cbdf0-a0b5-4b45-ad68-8681d5314736'
NAMES = {'028cbdf0': '177', '827977d7': '18688296454', '1d80c722': '面瘫君'}

out = []


def log(s=''):
    out.append(s)


def get(path):
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    return json.loads(urllib.request.urlopen(req, timeout=180).read().decode('utf-8'))


def nm(u):
    if not u:
        return '(空/未归属)'
    return '%s [%s]' % (NAMES.get(u[:8], '?'), u[:8])


version = get('/api/status')
log('daemon 版本: version=%s buildId=%s pid=%s (顶层字段，不在 daemon 子对象里)' % (
    version.get('version'), version.get('buildId'), version.get('pid')))


def show_accounts(label, body):
    s = body.get('stats') or {}
    log('')
    log('=== %s ===' % label)
    log('  totals: in=%s out=%s calls=%s' % (
        (s.get('totals') or {}).get('input'), (s.get('totals') or {}).get('output'), (s.get('totals') or {}).get('calls')))
    log('  -- accounts --')
    for a in (s.get('accounts') or []):
        log('     %-24s in=%-12s out=%-9s calls=%s' % (nm(a.get('account')), a.get('input'), a.get('output'), a.get('calls')))
    log('  -- models --')
    for m in (s.get('models') or []):
        log('     %-28s in=%-12s out=%-9s calls=%s' % (m.get('model') or '(空)', m.get('input'), m.get('output'), m.get('calls')))


show_accounts('days=1 全部账号', get('/api/token-stats?days=1'))
show_accounts('days=1 仅 177 (account=%s)' % UID177[:8], get('/api/token-stats?days=1&account=' + UID177))
show_accounts('days=7 全部账号', get('/api/token-stats?days=7'))

log('')
log('=== 验收结论 ===')
one = (get('/api/token-stats?days=1&account=' + UID177).get('stats') or {})
ds = [m for m in (one.get('models') or []) if 'deepseek' in (m.get('model') or '').lower()]
if ds and ds[0].get('calls'):
    log('  PASS  177 账号的 deepseek 用量已可见: %s in=%s calls=%s' % (ds[0]['model'], ds[0]['input'], ds[0]['calls']))
else:
    log('  FAIL  177 账号仍然查不到 deepseek 用量: %s' % json.dumps(one.get('models')))

with open(r'D:\WorkDaddy\.wd-analysis\verify-endpoint.out.txt', 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(out) + '\n')
print('ok')
