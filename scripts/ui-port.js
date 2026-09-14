'use strict';

const PROFILE_UI_PORTS = Object.freeze({
  'workbuddy-cn': Object.freeze([47832, 17832, 27832, 37832]),
  'workbuddy-ai': Object.freeze([47833, 17833, 27833, 37833]),
  'codebuddy-cn': Object.freeze([47834, 17834, 27834, 37834]),
  'codebuddy-intl': Object.freeze([47835, 17835, 27835, 37835]),
});

function validUiPort(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

function profileUiPortCandidates(profileId, options = {}) {
  const fixed = PROFILE_UI_PORTS[profileId] || PROFILE_UI_PORTS['workbuddy-cn'];
  const ports = [];
  const add = (port) => {
    const value = Number(port);
    if (validUiPort(value) && !ports.includes(value)) ports.push(value);
  };
  if (fixed.includes(Number(options.persistedPort))) add(options.persistedPort);
  add(options.preferredPort);
  fixed.forEach(add);
  return ports;
}

function selectPersistedUiPort(profileId, state) {
  if (!state || state.profileId !== profileId) return null;
  const port = Number(state.port);
  return (PROFILE_UI_PORTS[profileId] || []).includes(port) ? port : null;
}

function parseUiPortState(text, profileId) {
  try { return selectPersistedUiPort(profileId, JSON.parse(String(text || ''))); } catch (_) { return null; }
}

module.exports = {
  PROFILE_UI_PORTS,
  parseUiPortState,
  profileUiPortCandidates,
  selectPersistedUiPort,
  validUiPort,
};
