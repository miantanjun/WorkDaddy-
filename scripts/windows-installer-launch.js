'use strict';

const { spawn } = require('node:child_process');

function launchWindowsInstaller(installerPath, spawnImpl = spawn) {
  if (typeof installerPath !== 'string' || !/\.exe$/i.test(installerPath)) {
    throw new Error('Windows installer path must point to Setup.exe');
  }
  return spawnImpl(installerPath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
}

module.exports = { launchWindowsInstaller };
