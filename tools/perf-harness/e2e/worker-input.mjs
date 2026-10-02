// End-to-end: in worker-renderer mode, a manual sculpt / texture-paint stroke
// must start on mouse down and END on mouse up (it used to keep painting).
//   node tools/perf-harness/e2e/worker-input.mjs [--port 6075]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] || 6075) || 6075;
const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [vite, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
await new Promise((resolve, reject) => {
  const on = (b) => { if (/Local:|ready in/i.test(b.toString().replace(/\x1b\[[0-9;]*m/g, ''))) resolve(); };
  server.stdout.on('data', on); server.stderr.on('data', on);
  setTimeout(() => reject(new Error('vite did not start')), 120000);
});
const profile = path.join(ROOT, 'output', 'perf-harness', '.profile-e2e');
fs.mkdirSync(profile, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: 'msedge', headless: true, viewport: { width: 1280, height: 720 },
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--force-device-scale-factor=1'],
});
let failed = false;
try {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${port}/tools/perf-harness/e2e/worker-input.html`);
  await page.waitForFunction(() => window.__engine, null, { timeout: 180000 });
  console.log('transport', await page.evaluate(() => window.__transport));
  await page.evaluate(() => window.__booted);
  await page.evaluate(async () => {
    const e = window.__engine;
    await e.transitionMode({ worldMode: 'studio', projectMode: 'manual', project: { projectMode: 'manual', seed: 7 }, reason: 'project-create' });
    await e.setManualWorkspaceActive(true);
  });
  const stroke = async (tool) => {
    const before = await page.evaluate(() => window.__manualEvents.length);
    await page.mouse.move(560, 420);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(560 + i * 12, 420 + i * 4); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.waitForTimeout(800);
    // hovering after release must not paint again
    for (let i = 1; i <= 8; i++) { await page.mouse.move(700 - i * 15, 470); await page.waitForTimeout(30); }
    await page.waitForTimeout(800);
    const events = await page.evaluate((n) => window.__manualEvents.slice(n), before);
    const ended = events.filter((ev) => ev.label && new RegExp(tool, 'i').test(ev.label));
    console.log(tool, 'stroke-end events:', ended.length, JSON.stringify(ended.map((ev) => ev.label)));
    if (ended.length !== 1) failed = true;
  };
  await page.evaluate(() => window.__engine.setManualSculptEnabled(true));
  await page.waitForTimeout(300);
  await stroke('Sculpted');
  await page.evaluate(() => window.__engine.setManualSculptEnabled(false));
  await page.evaluate(() => window.__engine.setManualTexturePaintEnabled(true));
  await page.waitForTimeout(500);
  await stroke('Painted');
  console.log(failed ? 'FAIL' : 'PASS');
} finally {
  await context.close().catch(() => {});
  spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true });
}
process.exitCode = failed ? 1 : 0;
