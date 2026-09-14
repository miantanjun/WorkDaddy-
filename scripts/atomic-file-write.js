'use strict';

const crypto = require('crypto');
const fs = require('fs');

const WINDOWS_TRANSIENT_CODES = new Set(['UNKNOWN', 'EPERM', 'EACCES', 'EBUSY', 'EMFILE', 'ENFILE']);

function defaultSleep(ms) {
  if (ms <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function defaultSuffix() {
  return `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function replaceFileWithRetry(file, content, mode, options = {}) {
  const fileSystem = options.fs || fs;
  const platform = options.platform || process.platform;
  const sleep = options.sleep || defaultSleep;
  const suffix = options.suffix || defaultSuffix;
  const maxAttempts = platform === 'win32' ? 80 : 1;
  const tmp = `${file}.wbs-tmp-${suffix()}`;
  let tempReady = false;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (!tempReady) {
        fileSystem.writeFileSync(tmp, content, 'utf8');
        if (mode !== undefined) fileSystem.chmodSync(tmp, mode);
        tempReady = true;
      }
      fileSystem.renameSync(tmp, file);
      return;
    } catch (error) {
      lastError = error;
      const retryable = platform === 'win32' && WINDOWS_TRANSIENT_CODES.has(error && error.code);
      if (!tempReady) {
        try { fileSystem.unlinkSync(tmp); } catch (_) {}
      }
      if (!retryable || attempt === maxAttempts) break;
      if (attempt === 1 && error && error.code === 'EPERM') {
        try { fileSystem.chmodSync(file, 0o666); } catch (_) {}
      }
      sleep(Math.min(250, 50 + attempt * 10));
    }
  }

  try { fileSystem.unlinkSync(tmp); } catch (_) {}
  throw lastError;
}

module.exports = { replaceFileWithRetry, WINDOWS_TRANSIENT_CODES };
