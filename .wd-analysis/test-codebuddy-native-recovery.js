'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseRecoveryUid, recoverNativeSession } = require('../scripts/codebuddy-native-recovery.js');

const accounts = [
  { uid: 'old', authValid: true, lastRefreshTime: 10 },
  { uid: 'newest', authValid: true, lastRefreshTime: 30 },
  { uid: 'broken', authValid: false, lastRefreshTime: 90 },
];

test('native recovery prefers the last confirmed account', () => {
  assert.equal(chooseRecoveryUid(accounts, { uid: 'old' }, ''), 'old');
});

test('native recovery falls back to the selected primary account', () => {
  assert.equal(chooseRecoveryUid(accounts, { uid: 'missing' }, 'old'), 'old');
});

test('native recovery uses the newest valid backup when old state is missing', () => {
  assert.equal(chooseRecoveryUid(accounts, null, ''), 'newest');
});

test('native recovery is disabled after an explicit logout', () => {
  assert.equal(chooseRecoveryUid(accounts, { explicitLogout: true }, 'old'), '');
});

test('native recovery writes through the official service and verifies the result', async () => {
  const calls = [];
  const native = {
    replace: async session => { calls.push(['replace', session.account.uid]); return { uid: session.account.uid }; },
    read: async () => ({ account: { uid: 'newest' }, auth: { accessToken: 'redacted-fixture' } }),
  };
  const result = await recoverNativeSession({
    native, accounts, state: null, primaryUid: '',
    readSession: async uid => ({ account: { uid }, auth: { accessToken: 'redacted-fixture' } }),
  });
  assert.equal(result.uid, 'newest');
  assert.deepEqual(calls, [['replace', 'newest']]);
});
