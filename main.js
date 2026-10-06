'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, dialog, shell, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

// TT_SMOKE=<dir> runs against a throwaway data folder (used for automated checks).
const SMOKE = process.env.TT_SMOKE;
if (SMOKE) {
  app.setPath('userData', SMOKE);
  app.setPath('documents', SMOKE);
}
app.setAppUserModelId('local.timetracker');
app.disableHardwareAcceleration(); // software rendering: smaller footprint for a simple UI

const { Store, validate } = require('./src/store');
const { runBackup } = require('./src/backup');

const ICON = path.join(__dirname, 'assets', 'icon.png');
const defaultBackupDir = () => path.join(app.getPath('documents'), 'TimeTracker-Backup');

let win = null;
let tray = null;
let store = null;
let quitting = false;
let dirty = false;
let backupTimer = null;
let lastBackup = null;

const backupDir = () => (store.data && store.data.settings && store.data.settings.backupDir) || defaultBackupDir();

function doBackup() {
  clearTimeout(backupTimer);
  backupTimer = null;
  if (!store || !store.data) return null;
  try {
    const result = runBackup(store.data, backupDir());
    if (!result.errors.length) { lastBackup = Date.now(); dirty = false; }
    return result;
  } catch (e) {
    return { dir: backupDir(), files: [], errors: [e.message] };
  }
}

function scheduleBackup() {
  dirty = true;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(doBackup, 4000);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 760,
    minHeight: 540,
    show: false,
    title: 'Time Tracker',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#15181e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep the countdown accurate while hidden in the tray
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  win.on('close', (e) => {
    if (!quitting && store.data && store.data.settings.minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Time Tracker');
  tray.on('click', () => (win && win.isVisible() ? win.hide() : showWindow()));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Time Tracker', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function registerIpc() {
  ipcMain.handle('store:load', () => store.load());
  ipcMain.handle('store:save', (_e, data, backup) => {
    store.save(data);
    if (backup) scheduleBackup();
    return true;
  });
  ipcMain.on('store:save-sync', (e, data) => {
    try { store.save(data); dirty = true; } catch { /* keep the last good file */ }
    e.returnValue = true;
  });

  ipcMain.handle('backup:now', () => doBackup());
  ipcMain.handle('backup:info', () => ({ dir: backupDir(), last: lastBackup, dataFile: store.file }));
  ipcMain.handle('backup:choose-dir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose backup folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('backup:open-dir', () => { fs.mkdirSync(backupDir(), { recursive: true }); return shell.openPath(backupDir()); });
  ipcMain.handle('data:open-dir', () => shell.openPath(store.dir));

  ipcMain.handle('data:restore', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a backup file',
      defaultPath: path.join(backupDir(), 'snapshots'),
      filters: [{ name: 'Time Tracker backup', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    try {
      const data = validate(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
      try { // keep what is there now, just in case
        fs.mkdirSync(path.join(backupDir(), 'snapshots'), { recursive: true });
        fs.copyFileSync(store.file, path.join(backupDir(), 'snapshots', `pre-restore-${Date.now()}.json`));
      } catch { /* nothing to keep */ }
      return { ok: true, data };
    } catch {
      return { ok: false, error: 'That file is not a valid Time Tracker backup.' };
    }
  });

  ipcMain.handle('app:get-login', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('app:set-login', (_e, on) => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!on });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.on('app:notify', (_e, title, body) => {
    if (Notification.isSupported()) new Notification({ title, body, icon: ICON }).show();
    if (win && !win.isVisible()) showWindow();
  });
  ipcMain.on('tray:tooltip', (_e, text) => tray && tray.setToolTip(String(text).slice(0, 120)));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'), path.join(defaultBackupDir(), 'snapshots'));
    registerIpc();
    createWindow();
    createTray();
    powerMonitor.on('suspend', () => { if (win) win.webContents.send('power:suspend'); });
    if (SMOKE) runSmoke();
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { if (dirty) doBackup(); });
  app.on('window-all-closed', () => app.quit());
}

function runSmoke() {
  win.webContents.on('console-message', (_e, level, msg) => console.log('[renderer]', level, msg));
  win.webContents.on('did-finish-load', async () => {
    try {
      const script = fs.readFileSync(process.env.TT_SMOKE_SCRIPT, 'utf8');
      console.log('SMOKE RESULT', JSON.stringify(await win.webContents.executeJavaScript(script)));
      if (process.env.TT_SMOKE_SHOT) fs.writeFileSync(process.env.TT_SMOKE_SHOT, (await win.webContents.capturePage()).toPNG());
    } catch (e) {
      console.log('SMOKE ERROR', e.message);
    }
    quitting = true;
    app.quit();
  });
}
