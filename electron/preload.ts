import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from './channels.js';
import type { RexBridge, TerminalFrame } from '../src/shared/types.js';

const bridge: RexBridge = {
  request: (method, args) => ipcRenderer.invoke(CHANNELS.request, method, args),
  onTerminal: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, frame: TerminalFrame) => callback(frame);
    ipcRenderer.on(CHANNELS.terminal, listener);
    return () => ipcRenderer.removeListener(CHANNELS.terminal, listener);
  },
  onCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: string) => callback(command);
    ipcRenderer.on(CHANNELS.command, listener);
    return () => ipcRenderer.removeListener(CHANNELS.command, listener);
  },
  readClipboard: () => ipcRenderer.invoke(CHANNELS.readClipboard),
  writeClipboard: (text) => ipcRenderer.invoke(CHANNELS.writeClipboard, text),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  setSettings: (settings) => ipcRenderer.invoke(CHANNELS.setSettings, settings),
  windowControl: (action) => ipcRenderer.send(CHANNELS.windowControl, action),
};

contextBridge.exposeInMainWorld('rex', bridge);
