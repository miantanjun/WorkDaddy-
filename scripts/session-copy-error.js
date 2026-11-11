'use strict';
// 上游 1.2.19 新增（本地化吸纳）：异常文案白名单。任意 exception 文本可能含 SQL 行、
// 鉴权材料或用户输入内容 ⇒ 绝不把原始文本透出到 UI 或任务日志。
// ⚠️ 本地未吸纳上游 account-identity.js（账号身份隔离层），故此处内联 AMBIGUOUS_SESSION_ACCOUNT，
//    使本模块零依赖、可独立生效；若将来吸纳身份层，改回 require('./account-identity') 即可。
const AMBIGUOUS_SESSION_ACCOUNT = '个人版与企业版共用官方会话 UID，无法可靠区分会话归属，已停止同步；账号备份和切换仍可使用';
function sanitizeSessionCopyError(error) {
  if (error && error.code === 'WBS_AMBIGUOUS_SESSION_ACCOUNT') return AMBIGUOUS_SESSION_ACCOUNT;
  const text = String(error && (error.code || error.message) || error || '');
  if (/SQLITE_BUSY|SQLITE_LOCKED/i.test(text)) return '会话数据库正被占用，请稍后重新同步';
  if (/EACCES|EPERM/i.test(text)) return '没有读取或写入会话文件的权限，请检查文件权限后重新同步';
  if (/ENOENT/i.test(text)) return '会话数据库或文件不存在，请确认 WorkBuddy 已正常启动后重新同步';
  if (/ENOSPC/i.test(text)) return '磁盘空间不足，请释放空间后重新同步';
  if (/SQLITE_CORRUPT|SQLITE_NOTADB/i.test(text)) return '会话数据库无法读取，请先检查 WorkBuddy 是否能正常打开会话';
  if (/SQLITE_ERROR/i.test(text)) return '会话数据库结构不兼容，请更新 WorkDaddy 后重新同步';
  return '同步任务异常中断，请稍后重新同步；若仍失败，请反馈客户端版本及同步阶段';
}
module.exports = { sanitizeSessionCopyError };
