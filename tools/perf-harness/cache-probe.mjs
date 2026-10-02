// Inspect Chrome's GPU program disk cache across launches of the production
// app (main-thread renderer) in one persistent profile.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '../..');
const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [vite, 'preview', '--port', '6075', '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
await new Promise((r) => server.stdout.on('data', (b) => { if (/http:\/\//.test(b.toString())) r(); }));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'terrain-cache-'));
const dirSize = (d) => { let n = 0, f = 0; if (!fs.existsSync(d)) return [0, 0]; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { const [a, b] = dirSize(p); n += a; f += b; } else { n += fs.statSync(p).size; f++; } } return [n, f]; };
const linger = Number(process.argv[2] || 4000);
const modes = String(process.argv[3] || 'none').split(',');
for (let run = 0; run < 4; run++) {
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true, viewport: { width: 1280, height: 720 }, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('terrain-studio-perf-v1', JSON.stringify({ preset: 'balanced', useWorker: false, workerPreferenceExplicit: true })); } catch {} });
  if ((modes[run] ?? modes[modes.length - 1]) === 'no-parallel') {
    await ctx.addInitScript(() => {
      const proto = WebGL2RenderingContext.prototype;
      const get = proto.getExtension;
      proto.getExtension = function (name) { return name === 'KHR_parallel_shader_compile' ? null : get.call(this, name); };
      const sup = proto.getSupportedExtensions;
      proto.getSupportedExtensions = function () { return (sup.call(this) || []).filter((n) => n !== 'KHR_parallel_shader_compile'); };
    });
  }
  if ((modes[run] ?? modes[modes.length - 1]) === 'late-resolve') {
    await ctx.addInitScript(() => {
      const proto = WebGL2RenderingContext.prototype;
      const link = proto.linkProgram;
      proto.linkProgram = function (program) {
        link.call(this, program);
        const gl = this;
        const ext = gl.getExtension('KHR_parallel_shader_compile');
        const poll = () => {
          if (!ext || gl.getProgramParameter(program, ext.COMPLETION_STATUS_KHR)) gl.getProgramParameter(program, gl.LINK_STATUS);
          else setTimeout(poll, 20);
        };
        setTimeout(poll, 0);
      };
    });
  }
  if ((modes[run] ?? modes[modes.length - 1]) === 'sync-link') {
    await ctx.addInitScript(() => {
      const proto = WebGL2RenderingContext.prototype;
      const link = proto.linkProgram;
      proto.linkProgram = function (program) { link.call(this, program); this.getProgramParameter(program, this.LINK_STATUS); };
    });
  }
  const page = await ctx.newPage();
  const lines = [];
  page.on('console', (m) => { if (/shader ready\] terrain|shader ready\] water/.test(m.text())) lines.push(m.text().replace(/\(.*?chars\)/g, '')); });
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:6075/');
  await page.waitForFunction(() => document.querySelector('canvas[data-boot-state]')?.dataset.bootState === 'ready', null, { timeout: 120000 });
  const ready = Date.now() - t0;
  await page.waitForTimeout(linger);
  await ctx.close();
  const caches = ['GPUCache', 'GrShaderCache', 'GraphiteDawnCache', 'ShaderCache'].map((n) => [n, dirSize(path.join(profile, n)), dirSize(path.join(profile, 'Default', n))]);
  console.log(`run ${run} [${modes[run] ?? modes[modes.length - 1]}] ready ${ready}ms`, lines.join(' | '), JSON.stringify(caches));
}
fs.rmSync(profile, { recursive: true, force: true });
spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']);
