// Ad-hoc experiment driver: boots one harness scene and runs a script module
// that receives { page, h } helpers. Used to attribute costs (toggle uniforms,
// swap shader paths) before committing to an optimization.
//
//   node tools/perf-harness/probe.mjs <experiment.mjs> [--scene studio] [--port 6071] [--url http://127.0.0.1:6071]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCENES } from './scenes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const experiment = args.find((a) => !a.startsWith('--') && a.endsWith('.mjs'));
const sceneId = opt('scene', 'studio');
const port = Number(opt('port', 6073));
let base = opt('url');
// --cold: throw-away browser profile (empty GPU shader disk cache), like a
// first launch on a user's machine.
const COLD = args.includes('--cold');
const PROFILE = COLD
  ? fs.mkdtempSync(path.join(ROOT, 'output', 'perf-harness', '.profile-cold-'))
  : path.join(ROOT, 'output', 'perf-harness', '.profile-warm');

let server = null;
if (!base) {
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  server = spawn(process.execPath, [vite, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  await new Promise((resolve, reject) => {
    const on = (b) => { if (/Local:|ready in/i.test(b.toString().replace(/\x1b\[[0-9;]*m/g, ''))) resolve(); };
    server.stdout.on('data', on);
    server.stderr.on('data', on);
    setTimeout(() => reject(new Error('vite did not start')), 120000);
  });
  base = `http://127.0.0.1:${port}`;
}
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'msedge', headless: true, viewport: { width: 1280, height: 720 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-precise-memory-info',
    '--js-flags=--expose-gc', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--force-device-scale-factor=1'],
});
try {
  const scene = SCENES.find((s) => s.id === sceneId) || SCENES[0];
  const config = JSON.parse(opt('config', 'null')) || scene.config;
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
  await page.goto(`${base}/tools/perf-harness/harness.html?config=${encodeURIComponent(JSON.stringify(config))}`);
  await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 180000 });
  console.log('boot', await page.evaluate(() => window.__h.boot()));
  if (scene.mode && !opt('config')) console.log('mode', await page.evaluate((m) => window.__h.transition(m), scene.mode));
  const mod = await import(pathToFileURL(path.resolve(experiment)).href);
  const h = new Proxy({}, { get: (_, name) => (...a) => page.evaluate(({ name: n, a: args2 }) => window.__h[n](...args2), { name, a }) });
  const shot = async (file) => {
    const url = await page.evaluate(() => window.__h.capture());
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  };
  await mod.default({ page, h, scene, shot, ROOT });
} finally {
  await context.close().catch(() => {});
  if (COLD) fs.rmSync(PROFILE, { recursive: true, force: true });
  if (server) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true });
}
