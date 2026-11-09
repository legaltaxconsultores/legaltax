// LegalTax Consultores — aplicación de escritorio (Windows / macOS).
// Abre el sistema LegalTax en su propia ventana y se conecta al servidor central del despacho,
// donde están la base de datos y todos los documentos que comparte el equipo.
const { app, BrowserWindow, Menu, shell, ipcMain, dialog, Notification, session } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch (_) { return {}; } };
const writeCfg = c => { fs.mkdirSync(path.dirname(CONFIG()), { recursive: true }); fs.writeFileSync(CONFIG(), JSON.stringify(c, null, 2)); };
const clean = u => String(u || '').trim().replace(/\/+$/, '');
const PARTITION = 'persist:legaltax'; // la sesión se conserva al cerrar la aplicación

let win = null;
let cfg = readCfg();

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.setAppUserModelId('do.legaltax.escritorio');

function isServerUrl(url) {
  try { return cfg.server && new URL(url).origin === new URL(cfg.server).origin; } catch (_) { return false; }
}

function createWindow() {
  const b = cfg.bounds || { width: 1360, height: 860 };
  win = new BrowserWindow({
    ...b, minWidth: 980, minHeight: 640, show: false, title: 'LegalTax Consultores', backgroundColor: '#F6F5F3',
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { partition: PARTITION, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (cfg.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  const saveBounds = () => { if (!win.isMaximized() && !win.isMinimized()) cfg.bounds = win.getBounds(); cfg.maximized = win.isMaximized(); writeCfg(cfg); };
  win.on('close', saveBounds);

  // Enlaces: dentro del servidor se abren en la app; WhatsApp, correo y otros sitios en el navegador o programa del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isServerUrl(url) || url.startsWith('blob:')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 820, autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { partition: PARTITION, sandbox: true } } };
    }
    if (/^(https?:|mailto:|tel:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || isServerUrl(url)) return;
    e.preventDefault(); if (/^(https?:|mailto:)/.test(url)) shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'pages', 'error.html'), { query: { server: cfg.server || '', desc } });
  });
  openHome();
}

function openHome() {
  if (!cfg.server) return win.loadFile(path.join(__dirname, 'pages', 'setup.html'));
  win.loadURL(cfg.server + '/');
}

// Descargas: se guardan en Descargas\LegalTax y se avisa con una notificación (clic = abrir el archivo).
function setupDownloads() {
  session.fromPartition(PARTITION).on('will-download', (e, item) => {
    const dir = path.join(app.getPath('downloads'), 'LegalTax'); fs.mkdirSync(dir, { recursive: true });
    // nombre real del archivo según el servidor (admite acentos: Cédula, Resolución…)
    let name = item.getFilename();
    try {
      const cd = item.getContentDisposition() || '';
      const star = cd.match(/filename\*=UTF-8''([^;]+)/i); const plain = cd.match(/filename="([^"]+)"/i);
      if (star) name = decodeURIComponent(star[1].trim()); else if (plain) name = plain[1];
    } catch (_) { /* se usa el nombre sugerido */ }
    name = name.replace(/[\\/:*?"<>|]/g, '_');
    const ext = path.extname(name); const base = path.basename(name, ext);
    let target = path.join(dir, name); let n = 1;
    while (fs.existsSync(target)) target = path.join(dir, `${base} (${n++})${ext}`);
    item.setSavePath(target);
    item.once('done', (_, state) => {
      if (state !== 'completed') return;
      if (Notification.isSupported()) {
        const nt = new Notification({ title: 'Descarga completada', body: `${path.basename(target)} — clic para abrir`, icon: path.join(__dirname, 'build', 'icon.png') });
        nt.on('click', () => shell.openPath(target)); nt.show();
      }
    });
  });
}

function buildMenu() {
  const t = [
    { label: 'Archivo', submenu: [
      { label: 'Inicio', accelerator: 'CmdOrCtrl+H', click: () => openHome() },
      { label: 'Abrir carpeta de descargas', click: () => { const d = path.join(app.getPath('downloads'), 'LegalTax'); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); } },
      { type: 'separator' },
      { label: 'Cambiar servidor…', click: () => win.loadFile(path.join(__dirname, 'pages', 'setup.html'), { query: { server: cfg.server || '' } }) },
      { type: 'separator' },
      { role: 'quit', label: 'Salir' },
    ] },
    { label: 'Editar', submenu: [
      { role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' },
      { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' },
    ] },
    { label: 'Ver', submenu: [
      { role: 'reload', label: 'Actualizar' },
      { label: 'Atrás', accelerator: 'Alt+Left', click: () => win.webContents.navigationHistory?.canGoBack() && win.webContents.navigationHistory.goBack() },
      { type: 'separator' },
      { role: 'zoomIn', label: 'Acercar' }, { role: 'zoomOut', label: 'Alejar' }, { role: 'resetZoom', label: 'Tamaño normal' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'Pantalla completa' },
    ] },
    { label: 'Ayuda', submenu: [
      { label: 'Acerca de LegalTax', click: () => dialog.showMessageBox(win, { type: 'info', title: 'LegalTax Consultores', icon: path.join(__dirname, 'build', 'icon.png'),
        message: 'LegalTax Consultores SRL', detail: `Aplicación de escritorio v${app.getVersion()}\nServidor: ${cfg.server || 'sin configurar'}\n\nAv. Rómulo Betancourt No. 517, Santo Domingo · (809) 363-9979` }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

// La pantalla de configuración prueba que la dirección sea un servidor LegalTax antes de guardarla.
ipcMain.handle('lt:test-server', async (_, url) => {
  const u = clean(url);
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'La dirección debe empezar con https:// (o http:// en la red de la oficina).' };
  try {
    const r = await fetch(u + '/api/me', { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (!('user' in j)) throw new Error('respuesta inesperada');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'No se encontró un servidor LegalTax en esa dirección. Revise la dirección y su conexión. (Si es la demo gratuita de Render, puede tardar 1 minuto en despertar: vuelva a intentar.)' };
  }
});
ipcMain.handle('lt:save-server', async (_, url) => { cfg.server = clean(url); writeCfg(cfg); openHome(); return true; });
ipcMain.handle('lt:get-server', () => cfg.server || '');
ipcMain.handle('lt:retry', () => openHome());

app.whenReady().then(() => { buildMenu(); setupDownloads(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
