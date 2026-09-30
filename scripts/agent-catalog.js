'use strict';

/**
 * agent-catalog.js —— 子 Agent「模型目录」（**声明制**，与具体 AI 解耦）
 *
 * 为什么需要（2026-10-01 用户需求）：
 *   旧实现用 `/qwen/i.test(model)` **猜**「是不是本地」——
 *   换任何别的 AI（本地 / 云端 / 第三方）立刻失效，而且你机器上第二个模型
 *   `deepseek-flash` **当前就已经被判错了**。
 *
 *   ⇒ 改成**声明制**：插件**不猜**任何模型的性质，性质由用户在「模型」页里声明；
 *      未声明的一律按 `unknown` 处理，**不参与需要判断的统计**。
 *
 * 三条设计约束：
 *   ① **只写插件自己的目录**（`<dataDir>/agent-catalog.json`）——
 *      绝不碰官方 `models.json`（那是"模型本体"，这份只是"我们对它的看法"）
 *   ② **读时过滤**，不是"写时判断" —— 记录是**事后解析 jsonl** 得到的，
 *      所以开关随时改、**历史可重算**，且不需要任何迁移
 *   ③ **缺失即默认** —— 文件不存在 / 损坏 / 字段缺失都**不抛错**，
 *      用 `defaults` 兜底（缺配置不该让功能挂掉）
 */

const fs = require('fs');
const path = require('path');
const { replaceFileWithRetry } = require('./atomic-file-write');

/** 模型性质：**由用户声明**，不由插件猜。 */
const KINDS = ['local', 'cloud', 'unknown'];

/** 目录文件名（放插件数据目录，与官方 `models.json` 完全分离）。 */
const CATALOG_FILE = 'agent-catalog.json';

/**
 * 默认值。
 *
 * ⚠️ `record: true` 是**有意**选的：宁可多记再筛，也不要"悄悄漏记" ——
 *    漏记是**无声**的（用户根本不知道少了），多记只是统计里多一行，看得见。
 * ⚠️ `delegate: false` 也是**有意**的：宁可少提，也不要让 AI 去调一个它不认识的模型。
 */
const DEFAULTS = {
  kind: 'unknown',
  record: true,
  delegate: false,
};

function catalogFile(dataDir) {
  return path.join(String(dataDir || ''), CATALOG_FILE);
}

function emptyCatalog() {
  return { version: 1, entries: {}, defaults: Object.assign({}, DEFAULTS), corrupt: false };
}

/** 规整 kind（非法值一律回落 unknown，不抛错）。 */
function normalizeKind(value) {
  const k = String(value || '').trim().toLowerCase();
  return KINDS.indexOf(k) >= 0 ? k : DEFAULTS.kind;
}

function normalizeBool(value, fallback) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

/**
 * 读目录。
 * ⚠️ **任何异常都返回空目录**（文件不存在、JSON 损坏、字段类型不对都算）——
 *    调用方永远拿到一个结构合法的对象，不需要自己 try/catch。
 * ⚠️ 若是「**文件存在但损坏**」，额外标 `corrupt: true` —— 这样写入前会先留一份备份，
 *    不会把用户的声明**静默覆盖**（损坏是人为的，数据往往还能救回）。
 */
function readCatalog(dataDir) {
  const base = emptyCatalog();
  let raw = '';
  try {
    raw = fs.readFileSync(catalogFile(dataDir), 'utf8');
  } catch (_) {
    return base;   // 文件不存在 ⇒ 干净的默认值（不是损坏）
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (_) {
    base.corrupt = true;   // ⚠️ 存在但解析不了 ⇒ 标记为损坏（写前会备份）
    return base;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    base.corrupt = true;
    return base;
  }

  const def = parsed.defaults && typeof parsed.defaults === 'object' ? parsed.defaults : {};
  base.defaults = {
    kind: normalizeKind(def.kind),
    record: normalizeBool(def.record, DEFAULTS.record),
    delegate: normalizeBool(def.delegate, DEFAULTS.delegate),
  };

  const entries = parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)
    ? parsed.entries : {};
  for (const id of Object.keys(entries)) {
    const e = entries[id];
    if (!e || typeof e !== 'object') continue;
    base.entries[id] = {
      kind: normalizeKind(e.kind),
      record: normalizeBool(e.record, base.defaults.record),
      delegate: normalizeBool(e.delegate, base.defaults.delegate),
      label: typeof e.label === 'string' ? e.label : '',
    };
  }
  return base;
}

/**
 * 取某个模型的**生效条目**（未登记 ⇒ 用 defaults 兜底，并标 `declared: false`）。
 *
 * @param {object} catalog readCatalog 的返回值
 * @param {string} modelId 模型 id（可以为空 —— 空 id 一律走 defaults）
 * @returns {{id:string,kind:string,record:boolean,delegate:boolean,label:string,declared:boolean}}
 */
function resolveEntry(catalog, modelId) {
  const cat = catalog && typeof catalog === 'object' ? catalog : emptyCatalog();
  const def = cat.defaults || DEFAULTS;
  const id = String(modelId || '');
  const own = id && cat.entries ? cat.entries[id] : null;
  if (!own) {
    return {
      id,
      kind: normalizeKind(def.kind),
      record: normalizeBool(def.record, DEFAULTS.record),
      delegate: normalizeBool(def.delegate, DEFAULTS.delegate),
      label: '',
      declared: false,
    };
  }
  return {
    id,
    kind: normalizeKind(own.kind),
    record: normalizeBool(own.record, def.record),
    delegate: normalizeBool(own.delegate, def.delegate),
    label: String(own.label || ''),
    declared: true,
  };
}

/** 原子写（复用 `replaceFileWithRetry`，Windows 上带瞬态退避重试）。 */
function writeCatalog(dataDir, catalog) {
  const target = catalogFile(dataDir);
  // ⚠️ 原文件损坏时**先留一份备份**再覆盖 —— 否则用户对模型的声明会被静默抹掉。
  //    （损坏几乎都是人为编辑导致，原文件里往往还有能救回的内容。）
  if (catalog && catalog.corrupt) {
    try { fs.copyFileSync(target, target + '.corrupt-' + Date.now() + '.bak'); } catch (_) {}
    delete catalog.corrupt;
  }
  const json = JSON.stringify(catalog, null, 2) + '\n';
  replaceFileWithRetry(target, json, 0o600);
  return catalog;
}

/**
 * 合并式写入**单个**条目（未提供的字段保持原值）。
 * 空 `modelId` 直接拒绝 —— 没有 id 就没有可寻址的实体。
 */
function setEntry(dataDir, modelId, patch) {
  const id = String(modelId || '').trim();
  if (!id) throw new Error('缺少模型 ID，无法保存子 Agent 配置');
  const catalog = readCatalog(dataDir);
  const prev = resolveEntry(catalog, id);
  const next = {
    kind: normalizeKind(patch && patch.kind !== undefined ? patch.kind : prev.kind),
    record: normalizeBool(patch && patch.record, prev.record),
    delegate: normalizeBool(patch && patch.delegate, prev.delegate),
    label: patch && patch.label !== undefined ? String(patch.label || '') : prev.label,
  };
  catalog.entries[id] = next;
  writeCatalog(dataDir, catalog);
  return Object.assign({ id, declared: true }, next);
}

/** 删除单个条目（用于"清理未使用条目"；不影响任何官方文件）。 */
function removeEntry(dataDir, modelId) {
  const id = String(modelId || '').trim();
  if (!id) return false;
  const catalog = readCatalog(dataDir);
  if (!catalog.entries || !catalog.entries[id]) return false;
  delete catalog.entries[id];
  writeCatalog(dataDir, catalog);
  return true;
}

/**
 * ⭐ **读时过滤**：按目录的 `record` 决定哪条派活记录进台账。
 *
 * 关键点：过滤发生在**解析之后、聚合之前** ⇒
 *   · 某模型 `record` 从 false 改回 true，**历史立刻回来**（不需要重跑采集）
 *   · 没有 id 的记录（未指定模型）**始终保留** —— 它们正是"漏到云端"的证据，
 *     不该因为"没登记"而被藏起来
 */
function filterRecords(catalog, records) {
  const list = Array.isArray(records) ? records : [];
  return list.filter((r) => {
    const id = String((r && r.model) || '').trim();
    if (!id) return true;                    // 未指定模型 ⇒ 永远保留（"漏到云端"的证据）
    return resolveEntry(catalog, id).record;
  });
}

/**
 * 供「提醒规则」动态生成：列出**可委派**的模型（`delegate: true`）。
 * ⚠️ 返回空数组时，调用方应当**整段不注入提醒** ——
 *    宁可不提，也不要让 AI 去调一个不存在的模型。
 */
function delegatable(catalog) {
  const cat = catalog && typeof catalog === 'object' ? catalog : emptyCatalog();
  const out = [];
  for (const id of Object.keys(cat.entries || {})) {
    const e = resolveEntry(cat, id);
    if (e.delegate) out.push({ id, kind: e.kind, label: e.label });
  }
  return out;
}

/**
 * 用「已登记的模型 id」补齐目录（首次启用时把官方 models.json 里的模型列进来）。
 * ⚠️ 只**补缺**，不覆盖已有条目；`kind` 一律给 `unknown` —— **不替用户判断**。
 */
function ensureEntries(dataDir, modelIds) {
  const ids = (Array.isArray(modelIds) ? modelIds : [])
    .map((x) => String(x || '').trim()).filter(Boolean);
  if (!ids.length) return readCatalog(dataDir);
  const catalog = readCatalog(dataDir);
  let changed = false;
  for (const id of ids) {
    if (catalog.entries[id]) continue;
    catalog.entries[id] = Object.assign({}, DEFAULTS);
    changed = true;
  }
  if (changed) writeCatalog(dataDir, catalog);
  return catalog;
}

module.exports = {
  CATALOG_FILE,
  KINDS,
  DEFAULTS,
  catalogFile,
  emptyCatalog,
  readCatalog,
  resolveEntry,
  writeCatalog,
  setEntry,
  removeEntry,
  filterRecords,
  delegatable,
  ensureEntries,
};
