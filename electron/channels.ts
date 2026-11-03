export const CHANNELS = {
  request: 'rex:request',
  terminal: 'rex:terminal',
  command: 'app:command',
  readClipboard: 'app:clipboard:read',
  writeClipboard: 'app:clipboard:write',
  getSettings: 'app:settings:get',
  setSettings: 'app:settings:set',
  windowControl: 'app:window',
} as const;
