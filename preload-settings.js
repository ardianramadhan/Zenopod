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
  chatKey: (key, provider) => ipcRenderer.invoke('settings:chat-key', key, provider),
  chatTest: () => ipcRenderer.invoke('settings:chat-test'),
  chatModels: (provider) => ipcRenderer.invoke('settings:chat-models', provider),
  calendarAdd: (name, url) => ipcRenderer.invoke('settings:calendar-add', name, url),
  calendarRefresh: () => ipcRenderer.invoke('settings:calendar-refresh'),
  habitDone: (id, done) => ipcRenderer.invoke('settings:habit-done', id, done),
  searchCity: (name) => ipcRenderer.invoke('settings:search-city', name),
  voiceDownload: () => ipcRenderer.invoke('settings:voice-download'),
  voiceTest: (text) => ipcRenderer.invoke('settings:voice-test', text),
  onVoiceStatus: (callback) => ipcRenderer.on('settings:voice-status', (_event, status) => callback(status)),
  onChanged: (callback) => ipcRenderer.on('settings:changed', () => callback()),
  onSection: (callback) => ipcRenderer.on('settings:section', (_event, section) => callback(section)),
});
