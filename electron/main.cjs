const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const desktopState = require('./desktop-state.cjs');

if (process.argv.some((argument) => argument.startsWith('--squirrel-'))) process.exit(0);

const APP_SCHEME = 'procedural-terrain';
const APP_ID = 'com.zyfou.proceduralterrains';
const API_PROXY_PATH = '/api/v1';
const EDITABLE_FORMAT = 'procedural-terrains-project';
const DOCUMENT_EXTENSIONS = new Set(['.ptrterrain', '.json']);
const artifactExtensions = new Map([
  ['application/zip', 'zip'], ['model/gltf-binary', 'glb'], ['model/obj', 'obj'],
  ['image/png', 'png'], ['application/json', 'json'], ['text/plain', 'txt'],
]);

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

let mainWindow = null;
let pendingDocumentPaths = [];
let pendingStartupDocument = null;
let rendererReady = false;
let closing = false;
let activeBackend = null;
const writableDocumentPaths = new Set();
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const execFileAsync = promisify(execFile);

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const documentPath = findDocumentArgument(argv);
    if (documentPath) queueDocumentPath(documentPath);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function isDesktopDocumentPath(filePath) {
  return typeof filePath === 'string' && DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function findDocumentArgument(argv = process.argv) {
  return argv.find((value) => isDesktopDocumentPath(value) && path.isAbsolute(value)) || null;
}

async function registerFileAssociation() {
  if (process.platform !== 'win32') return;
  const classRoot = 'HKCU\\Software\\Classes';
  const progId = 'ProceduralTerrains.ptrterrain';
  const executable = process.execPath;
  try {
    await execFileAsync('reg.exe', ['ADD', `${classRoot}\\.ptrterrain`, '/ve', '/d', progId, '/f']);
    await execFileAsync('reg.exe', ['ADD', `${classRoot}\\${progId}`, '/ve', '/d', 'Procedural Terrains project', '/f']);
    await execFileAsync('reg.exe', ['ADD', `${classRoot}\\${progId}\\DefaultIcon`, '/ve', '/d', `${executable},0`, '/f']);
    await execFileAsync('reg.exe', ['ADD', `${classRoot}\\${progId}\\shell\\open\\command`, '/ve', '/d', `\"${executable}\" \"%1\"`, '/f']);
  } catch {
    // Windows keeps the user in control of the default app. Registration is
    // best-effort so a policy-restricted machine can still run the editor.
  }
}

function rendererIsTrusted(event) {
  return !!mainWindow && event.sender === mainWindow.webContents;
}

function requireTrustedSender(event) {
  if (!rendererIsTrusted(event)) throw new Error('Untrusted renderer request.');
}

function sanitizeFilename(input, fallback = 'terrain') {
  const name = path.basename(String(input || fallback)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim();
  return name || fallback;
}

function ensureExtension(filename, extension) {
  if (!extension || path.extname(filename)) return filename;
  return `${filename}.${extension}`;
}

function isEditableDocument(document) {
  return document && typeof document === 'object' && document.format === EDITABLE_FORMAT && document.terrain;
}

function isRuntimeTerrainDocument(document) {
  return document && typeof document === 'object' && typeof document.format === 'string'
    && document.format !== EDITABLE_FORMAT && document.format.includes('terrain');
}

async function readDocument(documentPath) {
  if (!isDesktopDocumentPath(documentPath)) throw new Error('Choose a .ptrterrain or .json project file.');
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(documentPath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('This project file is not valid JSON.');
    throw new Error(`Could not read the project file: ${error.message}`);
  }
  const extension = path.extname(documentPath).toLowerCase();
  if (extension === '.ptrterrain' && !isEditableDocument(parsed)) {
    if (isRuntimeTerrainDocument(parsed)) throw new Error('This .ptrterrain is a Unity/Blender runtime export, not an editable Procedural Terrains project.');
    throw new Error('This .ptrterrain is not an editable Procedural Terrains project.');
  }
  writableDocumentPaths.add(documentPath);
  return { path: documentPath, document: parsed, legacy: extension === '.json' };
}

async function rememberDocument(documentPath, document) {
  const metadata = document?.metadata || {};
  const entry = {
    path: documentPath,
    name: String(metadata.name || path.basename(documentPath, path.extname(documentPath))),
    modified: new Date().toISOString(),
  };
  await desktopState.rememberRecent(app.getPath('userData'), entry);
  app.addRecentDocument(documentPath);
}

async function saveDocument(payload = {}) {
  const serialized = typeof payload.content === 'string' ? payload.content : '';
  if (!serialized) throw new Error('The project document is empty.');
  let document;
  try { document = JSON.parse(serialized); } catch { throw new Error('The project document cannot be serialized.'); }
  if (!isEditableDocument(document)) throw new Error('Only editable .ptrterrain project documents can be saved.');

  let documentPath = payload.forceSaveAs ? null : payload.path;
  if (!documentPath || !writableDocumentPaths.has(documentPath)) {
    const suggested = ensureExtension(sanitizeFilename(payload.suggestedName, 'terrain'), 'ptrterrain');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Procedural Terrains project',
      defaultPath: suggested,
      filters: [{ name: 'Procedural Terrains project', extensions: ['ptrterrain'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    documentPath = result.filePath;
  }
  if (path.extname(documentPath).toLowerCase() !== '.ptrterrain') documentPath = `${documentPath}.ptrterrain`;
  await fs.writeFile(documentPath, `${serialized}\n`, 'utf8');
  writableDocumentPaths.add(documentPath);
  await rememberDocument(documentPath, document);
  return { canceled: false, path: documentPath };
}

async function saveArtifact(payload = {}) {
  const bytes = payload.data;
  if (!(bytes instanceof Uint8Array) && !ArrayBuffer.isView(bytes) && !(bytes instanceof ArrayBuffer)) throw new Error('Export data is missing.');
  const extension = artifactExtensions.get(payload.mime) || path.extname(String(payload.suggestedName || '')).slice(1) || 'bin';
  const suggested = ensureExtension(sanitizeFilename(payload.suggestedName, `terrain.${extension}`), extension);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export terrain artifact',
    defaultPath: suggested,
    filters: [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }, { name: 'All files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength));
  return { canceled: false, path: result.filePath };
}

function validateBackendSettings(settings = {}) {
  const profile = settings.profile === 'local' ? 'local' : 'remote';
  const remoteUrl = String(settings.remoteUrl || '').trim().replace(/\/+$/, '');
  if (profile === 'remote') {
    let url;
    try { url = new URL(remoteUrl); } catch { throw new Error('Enter a valid HTTPS URL for the remote backend.'); }
    if (url.protocol !== 'https:') throw new Error('The remote backend must use HTTPS.');
  }
  return { profile, remoteUrl };
}

function configureBackend(settings) {
  activeBackend = validateBackendSettings(settings);
  return activeBackend;
}

function backendBaseUrl() {
  if (!activeBackend) return null;
  return activeBackend.profile === 'local'
    ? 'http://localhost:6062/api/v1'
    : activeBackend.remoteUrl;
}

async function proxyApiRequest(request, requestUrl) {
  const baseUrl = backendBaseUrl();
  if (!baseUrl) return new Response('The desktop backend has not been configured yet.', { status: 503 });

  const suffix = requestUrl.pathname.slice(API_PROXY_PATH.length);
  const target = `${baseUrl.replace(/\/+$/, '')}${suffix}${requestUrl.search}`;
  const headers = new Headers(request.headers);
  // These identify the renderer's local origin and would make the remote API
  // apply browser CORS rules to a request made by Electron's trusted process.
  ['host', 'origin', 'referer', 'content-length', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user']
    .forEach((header) => headers.delete(header));
  const init = { method: request.method, headers, credentials: 'include' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
  try {
    return await net.fetch(target, init);
  } catch {
    return new Response('The configured backend is unavailable.', { status: 502 });
  }
}

function queueDocumentPath(documentPath) {
  if (!documentPath) return;
  if (!mainWindow || mainWindow.webContents.isLoading()) {
    pendingDocumentPaths.push(documentPath);
    return;
  }
  readDocument(documentPath)
    .then((payload) => {
      if (!rendererReady) pendingStartupDocument = payload;
      else mainWindow?.webContents.send('desktop:document:open-from-os', payload);
    })
    .catch((error) => {
      const payload = { path: documentPath, error: error.message };
      if (!rendererReady) pendingStartupDocument = payload;
      else mainWindow?.webContents.send('desktop:document:open-from-os', payload);
    });
}

function createWindow() {
  const icon = path.join(__dirname, 'assets', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: 'Procedural Terrains',
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.once('did-finish-load', () => {
    const paths = pendingDocumentPaths;
    pendingDocumentPaths = [];
    paths.forEach(queueDocumentPath);
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL
      ? url.startsWith(process.env.ELECTRON_RENDERER_URL)
      : url.startsWith(`${APP_SCHEME}://`);
    if (!allowed) event.preventDefault();
  });
  mainWindow.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    mainWindow.webContents.send('desktop:window:close-requested');
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) mainWindow.loadURL(rendererUrl);
  else mainWindow.loadURL(`${APP_SCHEME}://app/index.html`);
}

app.whenReady().then(async () => {
  app.setAppUserModelId(APP_ID);
  registerFileAssociation();
  const distRoot = app.isPackaged ? path.join(process.resourcesPath, 'dist') : path.join(__dirname, '..', 'dist');
  protocol.handle(APP_SCHEME, async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === API_PROXY_PATH || requestUrl.pathname.startsWith(`${API_PROXY_PATH}/`)) {
      return proxyApiRequest(request, requestUrl);
    }
    const relativePath = decodeURIComponent(requestUrl.pathname || '/index.html').replace(/^\/+/, '') || 'index.html';
    const resolved = path.resolve(distRoot, relativePath);
    if (resolved !== distRoot && !resolved.startsWith(`${distRoot}${path.sep}`)) return new Response('Not found', { status: 404 });
    try { return net.fetch(pathToFileURL(resolved).toString()); }
    catch { return new Response('Not found', { status: 404 }); }
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  });
  createWindow();
  const fromLaunch = findDocumentArgument();
  if (fromLaunch) queueDocumentPath(fromLaunch);
});

app.on('window-all-closed', () => app.quit());

ipcMain.handle('desktop:document:open', async (event) => {
  requireTrustedSender(event);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Procedural Terrains project',
    properties: ['openFile'],
    filters: [
      { name: 'Procedural Terrains project', extensions: ['ptrterrain'] },
      { name: 'Legacy JSON project', extensions: ['json'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const payload = await readDocument(result.filePaths[0]);
  if (!payload.legacy) await rememberDocument(payload.path, payload.document);
  return { canceled: false, ...payload };
});

ipcMain.handle('desktop:document:take-startup', async (event) => {
  requireTrustedSender(event);
  rendererReady = true;
  const payload = pendingStartupDocument;
  pendingStartupDocument = null;
  return payload;
});

ipcMain.handle('desktop:document:open-recent', async (event, documentPath) => {
  requireTrustedSender(event);
  try {
    const payload = await readDocument(documentPath);
    await rememberDocument(payload.path, payload.document);
    return { canceled: false, ...payload };
  } catch (error) {
    await desktopState.forgetRecent(app.getPath('userData'), documentPath);
    throw error;
  }
});

ipcMain.handle('desktop:document:save', async (event, payload) => {
  requireTrustedSender(event);
  return saveDocument(payload);
});

ipcMain.handle('desktop:recent:list', async (event) => {
  requireTrustedSender(event);
  return desktopState.listRecent(app.getPath('userData'));
});

ipcMain.handle('desktop:artifact:save', async (event, payload) => {
  requireTrustedSender(event);
  return saveArtifact(payload);
});

ipcMain.handle('desktop:backend:get', async (event) => {
  requireTrustedSender(event);
  const settings = await desktopState.getSettings(app.getPath('userData'));
  if (settings) configureBackend(settings);
  return settings;
});

ipcMain.handle('desktop:backend:set', async (event, settings) => {
  requireTrustedSender(event);
  const backend = configureBackend(settings);
  return desktopState.setSettings(app.getPath('userData'), backend);
});

ipcMain.on('desktop:window:close-response', (event, action) => {
  if (!rendererIsTrusted(event) || action === 'cancel') return;
  closing = true;
  mainWindow?.close();
});
