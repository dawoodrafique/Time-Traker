'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (data, backup = true) => ipcRenderer.invoke('store:save', data, backup),
  saveSync: (data) => ipcRenderer.sendSync('store:save-sync', data),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  backupInfo: () => ipcRenderer.invoke('backup:info'),
  chooseBackupDir: () => ipcRenderer.invoke('backup:choose-dir'),
  openBackupDir: () => ipcRenderer.invoke('backup:open-dir'),
  openDataDir: () => ipcRenderer.invoke('data:open-dir'),
  restore: () => ipcRenderer.invoke('data:restore'),
  getLogin: () => ipcRenderer.invoke('app:get-login'),
  setLogin: (v) => ipcRenderer.invoke('app:set-login', v),
  notify: (title, body) => ipcRenderer.send('app:notify', title, body),
  tray: (text) => ipcRenderer.send('tray:tooltip', text),
  onSuspend: (cb) => ipcRenderer.on('power:suspend', () => cb()),
});
