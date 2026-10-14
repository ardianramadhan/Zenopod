'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snip', {
  onImage: (callback) => ipcRenderer.on('snip:image', (_event, dataUrl) => callback(dataUrl)),
  done: (rect) => ipcRenderer.send('snip:done', rect),
});
