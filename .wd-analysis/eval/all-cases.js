/* 评测集统一入口 —— 合并四代题集
 *
 * 为什么分批存而不在 cases.js 里直接追加：
 *   原 39 题是「阶段 6 客观基线」的口径来源，baseline-stage6.json 就是按它算出来的。
 *   往里塞题会让新旧基线不可比（分母变了，历史数字立刻失真）。
 *
 *   batch3 单独一批的理由不同：它是**从画册会话挖出来的 numeric 富矿**，
 *   与 batch2（wd 会话的时序/实体）素材来源完全不同。分开存便于单独跑、
 *   单独看「哪一批题在拉低整体分」，也便于以后整批作废而不碰别的。
 *
 *   fresh（第四批）**必须单独成组、且不进 ALL 的默认总分**：
 *   它是故意做成「gold 的新鲜度两极分化」的因果实验题（latest vs earliest），
 *   混进总分会把「新鲜度梯度」这个自变量稀释掉 —— 那正是它要测的东西。
 *   ⇒ 要看整体能力用 ALL；要回答「换位机制值不值」用 FRESH 单独跑。
 *
 *   and（第五批，2026-11-05）**同样单独成组、不进 ALL**，理由与前四批不同：
 *   它的 gold 是从源题**沿用**的，短查询的全部 bigram 又都取自 gold 行内
 *   ⇒ 天然偏向「词法强相关」的行，MRR 绝对值不代表语义召回率。
 *   把它混进 ALL 会污染整体召回率数字。
 *   它的正确用途是**相对 A/B**（同一批题、改动前后比），
 *   以及回答一个前四批根本答不了的问题：AND 路的排序行为与 OR 路是否一致。
 */
'use strict';
const { CASES, SID_WD, SID_APP, SID_CAT } = require('./cases.js');
const { EXTRA_CASES } = require('./cases-extra.js');
const { BATCH3 } = require('./cases-batch3.js');
const { FRESH, LATEST, EARLIEST, MID, FRESH_NEG } = require('./cases-fresh.js');
const { AND_CASES } = require('./cases-and.js');

const GROUPS = { base: CASES, extra: EXTRA_CASES, b3: BATCH3, fresh: FRESH, and: AND_CASES };

// id 全局唯一性检查：重复 id 会让「回看某题」时分不清是哪条
const seen = new Set();
for (const k of Object.keys(GROUPS)) {
  for (const c of GROUPS[k]) {
    if (seen.has(c.id)) throw new Error('用例 id 重复: ' + c.id + '（出现在 ' + k + '）');
    seen.add(c.id);
  }
}

/** 全量题集（不含 fresh —— 见上方注释，fresh 是独立的因果实验组） */
const ALL = CASES.concat(EXTRA_CASES, BATCH3);

/** 全量 + fresh，用于「大样本」统计 */
const ALL_PLUS_FRESH = ALL.concat(FRESH);

/** 按类别统计 */
function stats(list) {
  const out = {};
  for (const c of list) out[c.cat] = (out[c.cat] || 0) + 1;
  return out;
}

/** 正例 = 有 gold 的题；配对负例（gold 空但 cat!=='negative'）与 negative 都不算 */
const isPos = (c) => c.cat !== 'negative' && (c.gold || []).length > 0;
const isPairNeg = (c) => c.cat !== 'negative' && !(c.gold || []).length;

module.exports = {
  ALL, ALL_PLUS_FRESH, BASE: CASES, EXTRA: EXTRA_CASES, BATCH3, FRESH, AND_CASES, GROUPS,
  LATEST, EARLIEST, MID, FRESH_NEG,
  stats, isPos, isPairNeg, SID_WD, SID_APP, SID_CAT,
};

if (require.main === module) {
  console.log('原基线 ' + CASES.length + ' 条：' + JSON.stringify(stats(CASES)));
  console.log('第二批 ' + EXTRA_CASES.length + ' 条：' + JSON.stringify(stats(EXTRA_CASES)));
  console.log('第三批 ' + BATCH3.length + ' 条：' + JSON.stringify(stats(BATCH3)));
  console.log('合计   ' + ALL.length + ' 条：' + JSON.stringify(stats(ALL)));
  const pos = ALL.filter(isPos);
  const pn = ALL.filter(isPairNeg);
  console.log('正例 ' + pos.length + ' 条 · 纯负例 '
    + ALL.filter((c) => c.cat === 'negative').length + ' 条 · 配对负例 ' + pn.length + ' 条');
  console.log('── 第四批（新鲜度梯度，单独成组）' + FRESH.length + ' 条：'
    + JSON.stringify(stats(FRESH)));
  console.log('   latest ' + LATEST.length + ' · mid ' + MID.length
    + ' · earliest ' + EARLIEST.length + ' · 配对负例 ' + FRESH_NEG.length);
  console.log('   正例 ' + FRESH.filter(isPos).length + ' 条');
  console.log('── 第五批（AND 路短查询配对，单独成组）' + AND_CASES.length + ' 条：'
    + JSON.stringify(stats(AND_CASES)));
  console.log('   正例 ' + AND_CASES.filter(isPos).length + ' 条（全部有 gold，均是源题 gold 的沿用）');
  console.log('全量+fresh ' + ALL_PLUS_FRESH.length + ' 条，其中正例 '
    + ALL_PLUS_FRESH.filter(isPos).length + ' 条');
  console.log('⚠️ AND_CASES 不进 ALL_PLUS_FRESH：它只用于相对 A/B，见文件头注释');
}
