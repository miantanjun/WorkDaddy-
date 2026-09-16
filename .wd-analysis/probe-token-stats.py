# -*- coding: utf-8 -*-
"""复现「用量统计里查不到某账号的 deepseek 用量」——直接读本地 API 的原始返回。"""
import json
import urllib.request

TOKEN = open(r'C:\Users\Lyon\AppData\Roaming\WorkDaddy\.api-token', encoding='utf-8').read().strip()
HEADERS = {'x-workdaddy-token': TOKEN}
BASE = 'http://127.0.0.1:47832'


def get(path):
    req = urllib.request.Request(BASE + path, headers=HEADERS)
    return json.loads(urllib.request.urlopen(req, timeout=180).read().decode('utf-8'))


def show(label, path):
    body = get(path)
    s = body.get('stats') or {}
    print('=== %s ===' % label)
    print('  totals:', json.dumps(s.get('totals'), ensure_ascii=False))
    print('  files=%s parsedLines=%s parseErrors=%s cached=%s' % (
        s.get('files'), s.get('parsedLines'), s.get('parseErrors'), s.get('cached')))
    print('  -- models --')
    for m in (s.get('models') or []):
        print('     %-34s in=%-10s out=%-8s calls=%s' % (
            m.get('model') or '(空)', m.get('input'), m.get('output'), m.get('calls')))
    print('  -- accounts --')
    for a in (s.get('accounts') or []):
        print('     %-12s %-10s in=%-10s out=%-8s calls=%s' % (
            a.get('account') or '(空)', a.get('nickname') or '', a.get('input'), a.get('output'), a.get('calls')))
    print('  -- daily --')
    for d in (s.get('daily') or []):
        print('     %s in=%-10s out=%-8s calls=%s' % (d.get('day'), d.get('input'), d.get('output'), d.get('calls')))
    print()


show('days=1 全部', '/api/token-stats?days=1')
show('days=7 全部', '/api/token-stats?days=7')
