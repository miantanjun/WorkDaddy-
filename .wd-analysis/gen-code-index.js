#!/usr/bin/env node
/**
 * gen-code-index.js —— 给超大单文件生成「函数级索引」（B4）。
 *
 * 为什么需要它：
 *   `daemon.js` 1.6 万行、`inject.js` 1.78 万行。每次定位一个函数都要 grep 好几轮，
 *   而**每一轮都要把整段上下文重发一次**（实测单次 input p50 ≈ 17 万 token）。
 *   索引是**一次性**的生成成本，换来之后每个定位任务少跑 1~3 轮。
 *
 * 产出：`.wd-analysis/CODE-INDEX.md`（生成物，别提交）
 *
 * 用法：
 *   node .wd-analysis/gen-code-index.js                   # 重新生成索引
 *   node .wd-analysis/gen-code-index.js --grep 折叠        # 直接在索引里搜（比 grep 整个文件便宜）
 *   node .wd-analysis/gen-code-index.js --grep 折叠 --ctx  # 带上下文原文行号提示
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = 'D:/WorkDaddy';
const OUT = path.join(REPO, '.wd-analysis', 'CODE-INDEX.md');
const TARGETS = [
  { rel: 'scripts/daemon.js' },
  { rel: 'scripts/inject.js' },
  // 省 token 专项新增的纯模块（体积不大，但定位 contextAudit/contextFix 的调用点时会用到）
  { rel: 'scripts/context-audit.js' },
  { rel: 'scripts/context-fix.js' },
];

// 保守取三种「明确是函数定义」的写法，宁可少收也不误收对象属性。
const PATTERNS = [
  { re: /^(\s*)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/, kind: 'fn' },
  { re: /^(\s*)const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/, kind: 'const' },
  { re: /^(\s*)([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function\s*\(/, kind: 'method' },
];

function commentAbove(lines, i) {
  for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
    const s = lines[k].trim();
    if (!s) continue;
    if (s.startsWith('*') || s.startsWith('/*') || s.startsWith('//')) {
      return s.replace(/^\/\*\*?/, '').replace(/\*\/$/, '').replace(/^\*+\s*/, '').replace(/^\/\/\s*/, '').trim().slice(0, 90);
    }
    break;
  }
  return '';
}

function scan(rel) {
  const full = path.join(REPO, rel);
  const raw = fs.readFileSync(full, 'utf8');
  const lines = raw.split(raw.indexOf('\r\n') >= 0 ? '\r\n' : '\n');
  const fns = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过注释行，避免把注释里举的例子当函数
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const p of PATTERNS) {
      const m = line.match(p.re);
      if (!m) continue;
      const indent = m[1].length;
      const name = m[2];
      // 顶层函数（缩进 0）和闭包内的函数都收；缩进超过 8 空格的多半是内联回调，跳过
      if (indent > 8) break;
      fns.push({ line: i + 1, name, kind: p.kind, indent, note: commentAbove(lines, i) });
      break;
    }
  }
  return { lines: lines.length, bytes: Buffer.byteLength(raw, 'utf8'), fns };
}

function build() {
  const results = TARGETS.map((t) => ({ rel: t.rel, ...scan(t.rel) }));
  const out = [
    '# 代码索引（自动生成，勿手改）',
    '',
    '> 由 `.wd-analysis/gen-code-index.js` 生成 · ' + new Date().toISOString().slice(0, 19).replace('T', ' '),
    '> 用途：定位大文件里的函数，**替代「grep 整个文件」**（索引按需读，不常驻上下文）。',
    '> 查法：`node .wd-analysis/gen-code-index.js --grep <关键词>`',
    '',
  ];
  for (const r of results) {
    out.push('## ' + r.rel + '  （' + r.lines + ' 行 / ' + r.fns.length + ' 个函数）');
    out.push('');
    out.push('| 行 | 函数 | 类型 | 摘要 |');
    out.push('|---|---|---|---|');
    for (const f of r.fns) {
      out.push('| ' + f.line + ' | `' + f.name + '` | ' + f.kind + ' | ' + (f.note || '').replace(/\|/g, '\\|') + ' |');
    }
    out.push('');
  }
  const total = results.reduce((n, r) => n + r.fns.length, 0);
  out.push('合计 **' + total + '** 个函数。');
  out.push('');
  return { text: out.join('\n'), results, total };
}

// ---------------------------------------------------------------- main
const argv = process.argv.slice(2);
const gi = argv.indexOf('--grep');
if (gi >= 0) {
  const needle = String(argv[gi + 1] || '').trim();
  if (!needle) { console.error('用法：--grep <关键词>'); process.exit(2); }
  if (!fs.existsSync(OUT)) { console.error('索引不存在，先跑一次不带参数的：node .wd-analysis/gen-code-index.js'); process.exit(2); }
  const idx = fs.readFileSync(OUT, 'utf8').split('\n');
  const hits = idx.filter((l) => l.startsWith('| ') && l.indexOf(needle) >= 0 && !/^\|\s*行\s*\|/.test(l) && !/^\|---/.test(l));
  console.log(hits.length ? hits.join('\n') : '（索引里没匹配到：' + needle + '）');
  console.log('\n匹配 ' + hits.length + ' 条。');
  process.exit(0);
}

const built = build();
fs.writeFileSync(OUT, built.text, 'utf8');
console.log('索引 -> ' + OUT);
for (const r of built.results) console.log('  ' + r.rel + ': ' + r.lines + ' 行 / ' + r.fns.length + ' 个函数');
console.log('  合计 ' + built.total + ' 个函数 · ' + Buffer.byteLength(built.text, 'utf8') + ' B');
