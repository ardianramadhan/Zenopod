'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (patch) => ipcRenderer.invoke('settings:save', patch),
  installedApps: () => ipcRenderer.invoke('settings:installed-apps'),
  hooks: (action) => ipcRenderer.invoke('settings:hooks', action),
  autostart: (enabled) => ipcRenderer.invoke('settings:autostart', enabled),
  preview: (kind) => ipcRenderer.invoke('settings:preview', kind),
  pickFolder: () => ipcRenderer.invoke('settings:pick-folder'),
  checkUpdate: () => ipcRenderer.invoke('settings:check-update'),
  chatKey: (key) => ipcRenderer.invoke('settings:chat-key', key),
  chatTest: () => ipcRenderer.invoke('settings:chat-test'),
  searchCity: (name) => ipcRenderer.invoke('settings:search-city', name),
  voiceDownload: () => ipcRenderer.invoke('settings:voice-download'),
  voiceTest: (text) => ipcRenderer.invoke('settings:voice-test', text),
  onVoiceStatus: (callback) => ipcRenderer.on('settings:voice-status', (_event, status) => callback(status)),
  onChanged: (callback) => ipcRenderer.on('settings:changed', () => callback()),
  onSection: (callback) => ipcRenderer.on('settings:section', (_event, section) => callback(section)),
});
