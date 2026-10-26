'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const query = new URLSearchParams(window.location.search);

function readMock() {
  const raw = query.get('mock');
  if (!raw) return null;
  try {
    try {
      return JSON.parse(raw);
    } catch {
      return JSON.parse(decodeURIComponent(raw));
    }
  } catch {
    return null;
  }
}

const mock = readMock();
const listeners = new Set();

ipcRenderer.on('engine:message', (_event, message) => {
  for (const fn of listeners) {
    try {
      fn(message);
    } catch (err) {
      console.error('state listener failed', err);
    }
  }
});

const api = {
  meta: {
    mock: Boolean(mock),
    displayId: Number(query.get('display') || 0),
    primary: query.get('primary') !== '0',
    reason: query.get('reason') || 'due',
  },
  getState: () => ipcRenderer.invoke('engine:invoke', 'get-state'),
  setConfig: (patch) => ipcRenderer.invoke('engine:invoke', 'set-config', patch),
  command: (name, payload) => ipcRenderer.invoke('engine:invoke', name, payload),
  onMessage: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

if (mock) {
  const snapshot = mock.snapshot || {};
  api.getState = async () => snapshot;
  api.setConfig = async (patch) => ({ ...snapshot, config: { ...(snapshot.config || {}), ...patch } });
  api.command = async (name) => (name === 'meta'
    ? { userData: String.raw`C:\Users\you\AppData\Roaming\SedentaryReminder`, version: '1.0.0', electron: process.versions.electron }
    : { ...snapshot, lastCommand: name });
  api.onMessage = (fn) => {
    fn({ type: 'state', snapshot });
    for (const event of mock.events || []) fn({ type: 'event', event });
    return () => {};
  };
}

contextBridge.exposeInMainWorld('sedentary', Object.freeze(api));
