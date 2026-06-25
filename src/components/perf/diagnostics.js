// ============================================================================
// Diagnostics exporter — turns a merged snapshot into a copy-paste report
// (plain text or JSON) for debugging / sharing. No sensitive data is included
// (only browser UA string, renderer name, perf numbers, settings summary).
// ============================================================================

import { APP_VERSION } from '../../constants/app.js';
import { computeWarnings } from './warnings.js';

export function buildDiagnosticsObject(snap) {
  const warnings = computeWarnings(snap);
  return {
    app: { name: 'Procedural Terrains', version: APP_VERSION },
    browser: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    capturedAt: new Date().toISOString(),
    summary: {
      fps: snap?.fps,
      frameMs: snap?.frame ? round(snap.frame.avg) : null,
      mode: snap?.diag?.mode,
      state: snap?.diag?.state,
      qualityPreset: snap?.diag?.qualityPreset,
    },
    renderer: snap?.render,
    gpuTiming: snap?.gpu,
    memory: snap?.memory,
    timings: (snap?.sections || []).map((s) => ({ name: s.name, avg: round(s.avg), max: round(s.max) })),
    scene: snap?.diag,
    loading: (snap?.tasks || []).map((t) => ({ name: t.name, status: t.status, progress: t.progress, elapsedMs: round(t.elapsed) })),
    warnings,
  };
}

export function buildDiagnosticsText(snap) {
  const o = buildDiagnosticsObject(snap);
  const L = [];
  L.push(`${o.app.name} v${o.app.version} — diagnostics`);
  L.push(`Captured: ${o.capturedAt}`);
  L.push(`Browser: ${o.browser}`);
  L.push(`Device pixel ratio: ${o.devicePixelRatio}`);
  L.push('');
  L.push('[Summary]');
  L.push(`  FPS: ${o.summary.fps}   Frame: ${o.summary.frameMs} ms`);
  L.push(`  Mode: ${o.summary.mode}   State: ${o.summary.state}   Quality: ${o.summary.qualityPreset}`);
  if (o.renderer) {
    L.push('');
    L.push('[Rendering]');
    L.push(`  Draw calls: ${o.renderer.calls}   Triangles: ${o.renderer.triangles}`);
    L.push(`  Geometries: ${o.renderer.geometries}   Textures: ${o.renderer.textures}   Programs: ${o.renderer.programs}`);
  }
  if (o.gpuTiming) {
    L.push('');
    L.push('[GPU]');
    L.push(o.gpuTiming.supported ? `  Frame GPU: ${round(o.gpuTiming.frameMs)} ms` : '  GPU timing: unavailable');
  }
  if (o.memory) {
    L.push('');
    L.push('[Memory]');
    L.push(o.memory.supported
      ? `  JS heap: ${mb(o.memory.usedJSHeap)} / ${mb(o.memory.totalJSHeap)} (limit ${mb(o.memory.jsHeapLimit)})`
      : '  Memory API unavailable');
  }
  if (o.timings.length) {
    L.push('');
    L.push('[Frame timings (avg ms)]');
    for (const t of o.timings) L.push(`  ${t.name}: ${t.avg} (max ${t.max})`);
  }
  if (o.warnings.length) {
    L.push('');
    L.push('[Warnings]');
    for (const w of o.warnings) L.push(`  [${w.level}] ${w.label}`);
  }
  L.push('');
  L.push('[Scene JSON]');
  L.push(JSON.stringify(o.scene, null, 2));
  return L.join('\n');
}

function round(v) { return v == null ? null : Math.round(v * 100) / 100; }
function mb(bytes) { return bytes == null ? '?' : `${(bytes / 1048576).toFixed(0)} MB`; }
