'use strict';

// Choose only from backups that the active profile has already accepted. The
// caller still validates and writes the complete session through CodeBuddy's
// native service; this module never handles token contents.
function chooseRecoveryUid(accounts, state, primaryUid) {
  if (state && state.explicitLogout === true) return '';
  const valid = (Array.isArray(accounts) ? accounts : [])
    .filter(account => account && account.authValid === true && /^[A-Za-z0-9_-]{1,128}$/.test(String(account.uid || '')));
  const byUid = new Map(valid.map(account => [String(account.uid), account]));
  const remembered = state && String(state.uid || '');
  if (remembered && byUid.has(remembered)) return remembered;
  const primary = String(primaryUid || '');
  if (primary && byUid.has(primary)) return primary;
  valid.sort((a, b) => Number(b.lastRefreshTime || 0) - Number(a.lastRefreshTime || 0));
  return valid[0] ? String(valid[0].uid) : '';
}

async function recoverNativeSession({ native, accounts, state, primaryUid, readSession }) {
  if (!native || typeof readSession !== 'function') return null;
  const uid = chooseRecoveryUid(accounts, state, primaryUid);
  if (!uid) return null;
  const session = await readSession(uid);
  const result = await native.replace(session);
  if (!result || result.uid !== uid) throw new Error('CodeBuddy 原生会话恢复未确认');
  const restored = await native.read();
  if (!restored || String(restored.account && restored.account.uid || '') !== uid) {
    throw new Error('CodeBuddy 原生会话恢复复核失败');
  }
  return { uid, session: restored };
}

module.exports = { chooseRecoveryUid, recoverNativeSession };
