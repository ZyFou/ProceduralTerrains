// ============================================================================
// PerformanceOverlay — the expanded "engine diagnostics" panel.
//
// Reads a single merged snapshot (profiler + engine diagnostics + loading
// tasks) provided by usePerfOverlay. Renders grouped, collapsible sections.
// Purely presentational + a copy-diagnostics action; no per-frame work.
// ============================================================================

import { useState } from 'react';
import { computeWarnings } from './warnings.js';
import { buildDiagnosticsText, buildDiagnosticsObject } from './diagnostics.js';

function fmtNum(n) {
  if (n == null) return '–';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
const fmtMs = (v) => (v == null ? '–' : `${v.toFixed(1)} ms`);
const mb = (b) => (b == null ? '–' : `${(b / 1048576).toFixed(0)} MB`);

function Row({ label, value, warn }) {
  return (
    <div className="perf-row">
      <span className="perf-row-label">{label}</span>
      <span className={`perf-row-value${warn ? ' warn' : ''}`}>{value}</span>
    </div>
  );
}

function Section({ id, title, collapsed, onToggle, children }) {
  return (
    <div className="perf-section">
      <button type="button" className="perf-section-head" onClick={() => onToggle(id)}>
        <span className={`perf-caret${collapsed ? ' closed' : ''}`}>▾</span>
        {title}
      </button>
      {!collapsed && <div className="perf-section-body">{children}</div>}
    </div>
  );
}

export default function PerformanceOverlay({
  snapshot, settings, onClose, onToggleSection, onSetBadge, onSetCompact, onSetShowWarnings,
}) {
  const [copied, setCopied] = useState('');
  if (!snapshot) return null;

  const { fps, frame, render, gpu, memory, sections, tasks, diag } = snapshot;
  const collapsed = settings.collapsed || {};
  const warnings = computeWarnings(snapshot);

  const copy = async (kind) => {
    const text = kind === 'json'
      ? JSON.stringify(buildDiagnosticsObject(snapshot), null, 2)
      : buildDiagnosticsText(snapshot);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(''), 1500);
    } catch { setCopied('err'); setTimeout(() => setCopied(''), 1500); }
  };

  const cam = diag?.camera;
  const cull = diag?.culling || {};
  const lod = diag?.lod?.counts || [];

  return (
    <div className={`perf-overlay${settings.compact ? ' compact' : ''}`} role="dialog" aria-label="Performance overlay">
      <div className="perf-overlay-head">
        <span className="perf-title">Performance</span>
        <div className="perf-head-actions">
          <button type="button" className={`perf-chip${copied === 'text' ? ' ok' : ''}`} onClick={() => copy('text')}>
            {copied === 'text' ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className={`perf-chip${copied === 'json' ? ' ok' : ''}`} onClick={() => copy('json')}>
            {copied === 'json' ? 'Copied' : 'JSON'}
          </button>
          <button type="button" className="perf-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      <div className="perf-overlay-body">
        {/* ---------------- Summary ---------------- */}
        <Section id="summary" title="Summary" collapsed={collapsed.summary} onToggle={onToggleSection}>
          <Row label="FPS" value={fps} warn={fps > 0 && fps < 45} />
          <Row label="Avg FPS" value={snapshot.fpsAvg} />
          <Row label="Frame" value={fmtMs(frame?.avg)} warn={frame?.avg > 22} />
          <Row label="Frame min/max" value={`${fmtMs(frame?.min)} / ${fmtMs(frame?.max)}`} />
          <Row label="Mode" value={diag?.mode || '–'} />
          <Row label="State" value={diag?.state || '–'} />
          <Row label="Quality" value={diag?.qualityPreset || '–'} />
          <Row label="Pixel ratio" value={diag?.pixelRatio?.toFixed(2) ?? '–'} warn={diag?.pixelRatio > 2.5} />
          <Row label="Render size" value={diag?.drawingBuffer ? `${diag.drawingBuffer.w}×${diag.drawingBuffer.h}` : '–'} />
          <Row label="Camera" value={cam ? `${cam.x.toFixed(0)}, ${cam.y.toFixed(0)}, ${cam.z.toFixed(0)}` : '–'} />
        </Section>

        {/* ---------------- Rendering ---------------- */}
        <Section id="rendering" title="Rendering" collapsed={collapsed.rendering} onToggle={onToggleSection}>
          {render ? (
            <>
              <Row label="Draw calls" value={render.calls} warn={render.calls > 1500} />
              <Row label="Triangles" value={fmtNum(render.triangles)} warn={render.triangles > 3e6} />
              <Row label="Points" value={render.points} />
              <Row label="Lines" value={render.lines} />
              <Row label="Geometries" value={render.geometries} />
              <Row label="Textures" value={render.textures} warn={render.textures > 120} />
              <Row label="Programs" value={render.programs} />
              <Row label="Shadows" value={diag?.shadowsEnabled ? 'on' : 'off'} />
              <Row label="Underwater pass" value={diag?.postProcessing?.underwater ? 'active' : 'inactive'} />
            </>
          ) : <Row label="Renderer" value="open overlay to collect" />}
        </Section>

        {/* ---------------- Frame timing ---------------- */}
        <Section id="timing" title="Frame timing (CPU)" collapsed={collapsed.timing} onToggle={onToggleSection}>
          {sections && sections.length ? sections.map((s) => (
            <Row key={s.name} label={s.name} value={`${s.avg.toFixed(2)} ms (max ${s.max.toFixed(1)})`} warn={s.avg > 8} />
          )) : <Row label="No section data yet" value="…" />}
        </Section>

        {/* ---------------- GPU ---------------- */}
        <Section id="gpu" title="GPU timing" collapsed={collapsed.gpu} onToggle={onToggleSection}>
          {gpu && gpu.supported ? (
            <>
              <Row label="Frame GPU" value={fmtMs(gpu.frameMs)} />
              <Row label="Per-pass" value="not separated (whole-frame only)" />
              {gpu.disjoint && <Row label="Note" value="disjoint — result unreliable" warn />}
            </>
          ) : <Row label="GPU timing" value="unavailable on this browser/device" />}
        </Section>

        {/* ---------------- Memory ---------------- */}
        <Section id="memory" title="Memory" collapsed={collapsed.memory} onToggle={onToggleSection}>
          {memory && memory.supported ? (
            <>
              <Row label="JS heap used" value={mb(memory.usedJSHeap)} warn={memory.usedJSHeap / memory.jsHeapLimit > 0.85} />
              <Row label="JS heap total" value={mb(memory.totalJSHeap)} />
              <Row label="JS heap limit" value={mb(memory.jsHeapLimit)} />
            </>
          ) : <Row label="Memory API" value="unavailable" />}
          <Row label="Textures" value={render?.textures ?? '–'} />
          <Row label="Geometries" value={render?.geometries ?? '–'} />
        </Section>

        {/* ---------------- Loading ---------------- */}
        <Section id="loading" title="Loading" collapsed={collapsed.loading} onToggle={onToggleSection}>
          {tasks && tasks.length ? tasks.map((t) => (
            <Row
              key={t.id}
              label={t.name}
              value={`${t.status}${t.progress != null ? ` ${Math.round(t.progress * 100)}%` : ''}${t.elapsed ? ` · ${(t.elapsed / 1000).toFixed(1)}s` : ''}`}
              warn={t.status === 'failed'}
            />
          )) : <Row label="No active tasks" value="idle" />}
        </Section>

        {/* ---------------- Terrain ---------------- */}
        <Section id="terrain" title="Terrain" collapsed={collapsed.terrain} onToggle={onToggleSection}>
          {diag && renderTerrain(diag)}
        </Section>

        {/* ---------------- Culling / LOD ---------------- */}
        <Section id="culling" title="Culling & LOD" collapsed={collapsed.culling} onToggle={onToggleSection}>
          <Row label="Total chunks" value={cull.total ?? '–'} />
          <Row label="Visible" value={cull.visible ?? '–'} />
          <Row label="Culled" value={cull.culled ?? '–'} />
          {lod.map((c, i) => <Row key={i} label={`LOD${i}`} value={c} />)}
        </Section>

        {/* ---------------- Clouds ---------------- */}
        <Section id="clouds" title="Clouds" collapsed={collapsed.clouds} onToggle={onToggleSection}>
          {diag?.clouds && (
            <>
              <Row label="Enabled" value={diag.clouds.enabled ? 'yes' : 'no'} />
              <Row label="Mode" value={diag.clouds.mode} />
              <Row label="Layers" value={diag.clouds.layers} />
              <Row label="Raymarch steps" value={diag.clouds.steps} warn={diag.clouds.steps > 64} />
              <Row label="Light steps" value={diag.clouds.lightSteps} />
              <Row label="Octaves" value={`${diag.clouds.octaves} + ${diag.clouds.detailOctaves} detail`} />
              <Row label="Coverage" value={fmtMaybe(diag.clouds.coverage)} />
              <Row label="Density" value={fmtMaybe(diag.clouds.density)} />
              <Row label="Wind / evolve" value={`${fmtMaybe(diag.clouds.windSpeed)} / ${fmtMaybe(diag.clouds.evolveSpeed)}`} />
              <Row label="Culling" value={diag.clouds.cullingMode} />
              <Row label="LOD" value={diag.clouds.lod} />
              <Row label="Update time" value={fmtMs(diag.clouds.time)} />
            </>
          )}
        </Section>

        {/* ---------------- Water ---------------- */}
        <Section id="water" title="Water" collapsed={collapsed.water} onToggle={onToggleSection}>
          {diag?.water && (
            <>
              <Row label="Enabled" value={diag.water.enabled ? 'yes' : 'no'} />
              <Row label="Mode" value={diag.water.mode} />
              <Row label="Quality" value={diag.water.quality} />
              <Row label="Reflection" value={fmtMaybe(diag.water.reflection)} />
              <Row label="Detail" value={fmtMaybe(diag.water.detail)} />
              <Row label="Waves" value={fmtMaybe(diag.water.waves)} />
              <Row label="Sea level" value={fmtMaybe(diag.water.seaLevel)} />
              <Row label="Underwater" value={diag.water.underwater ? 'active' : 'inactive'} />
            </>
          )}
        </Section>

        {/* ---------------- Warnings ---------------- */}
        {settings.showWarnings && (
          <Section id="warnings" title={`Warnings (${warnings.length})`} collapsed={collapsed.warnings} onToggle={onToggleSection}>
            {warnings.length ? warnings.map((w, i) => (
              <div key={i} className={`perf-warn perf-warn-${w.level}`}>
                <span className="perf-warn-level">{w.level}</span>
                <span className="perf-warn-label">{w.label}</span>
              </div>
            )) : <Row label="No warnings" value="all clear" />}
          </Section>
        )}

        {/* ---------------- Overlay preferences ---------------- */}
        <div className="perf-prefs">
          <label><input type="checkbox" checked={!!settings.badge} onChange={(e) => onSetBadge(e.target.checked)} /> FPS badge</label>
          <label><input type="checkbox" checked={!!settings.compact} onChange={(e) => onSetCompact(e.target.checked)} /> Compact</label>
          <label><input type="checkbox" checked={!!settings.showWarnings} onChange={(e) => onSetShowWarnings(e.target.checked)} /> Warnings</label>
        </div>
      </div>
    </div>
  );
}

function fmtMaybe(v) {
  if (v == null) return '–';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

function renderTerrain(diag) {
  const t = diag.terrain || {};
  if (diag.mode === 'infinite') {
    return (
      <>
        <Row label="Chunk size" value={fmtMaybe(t.chunkSize)} />
        <Row label="View radius" value={fmtMaybe(t.viewRadius)} />
        <Row label="Render distance" value={fmtMaybe(t.renderDistance)} />
        <Row label="LOD thresholds" value={(t.lodThresholds || []).map((x) => x.toFixed(0)).join(', ') || '–'} />
        <Row label="Last chunk gen" value={t.lastChunkGenMs != null ? `${t.lastChunkGenMs.toFixed(1)} ms` : '–'} />
      </>
    );
  }
  if (diag.mode === 'planet') {
    return (
      <>
        <Row label="Planet radius" value={fmtMaybe(t.planetRadius)} />
        <Row label="Face grid" value={fmtMaybe(t.faceGrid)} />
        <Row label="Baked height tex" value={t.bakedHeightTex ? 'yes' : 'no'} />
        <Row label="Last rebuild" value={t.lastRebuildMs != null ? `${t.lastRebuildMs.toFixed(1)} ms` : '–'} />
      </>
    );
  }
  return (
    <>
      <Row label="Resolution" value={fmtMaybe(t.resolution)} />
      <Row label="Board size" value={fmtMaybe(t.boardSize)} />
      <Row label="Tiles" value={fmtMaybe(t.tiles)} />
      <Row label="Height scale" value={fmtMaybe(t.heightScale)} />
      <Row label="Octaves" value={fmtMaybe(t.octaves)} />
      <Row label="Noise layers" value={fmtMaybe(t.noiseLayers)} />
      <Row label="Baked height tex" value={t.bakedHeightTex ? 'yes' : 'no'} />
      <Row label="Last bake" value={t.lastBakeMs != null ? `${t.lastBakeMs.toFixed(1)} ms` : '–'} />
    </>
  );
}
