// ============================================================================
// PerformanceOverlay — expanded engine diagnostics panel.
// Reads a merged snapshot from usePerfOverlay; purely presentational.
// ============================================================================

import { useState } from 'react';
import { computeWarnings } from './warnings.js';
import { buildDiagnosticsText, buildDiagnosticsObject } from './diagnostics.js';
import PerfSparkline from './PerfSparkline.jsx';

function fmtNum(n) {
  if (n == null) return '–';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
const fmtMs = (v) => (v == null ? '–' : `${v.toFixed(1)} ms`);
const mb = (b) => (b == null ? '–' : `${(b / 1048576).toFixed(0)} MB`);

function fpsTone(fps) {
  if (fps > 0 && fps < 30) return 'crit';
  if (fps > 0 && fps < 45) return 'warn';
  return 'good';
}

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
        <span className={`perf-caret${collapsed ? ' closed' : ''}`}>
          <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden><path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </span>
        {title}
      </button>
      {!collapsed && <div className="perf-section-body">{children}</div>}
    </div>
  );
}

function GraphCard({ label, hint, children }) {
  return (
    <div className="perf-graph-card">
      <div className="perf-graph-card-head">
        <span className="perf-graph-card-label">{label}</span>
        {hint && <span className="perf-graph-card-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function PerformanceOverlay({
  snapshot, history, settings, onClose, onToggleSection, onSetShowWarnings,
}) {
  const [copied, setCopied] = useState('');
  if (!snapshot) {
    return (
      <div className="perf-overlay perf-overlay-loading" role="dialog" aria-label="Performance overlay">
        <div className="perf-overlay-head">
          <span className="perf-title">Performance</span>
          <button type="button" className="perf-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="perf-loading-body">
          <span className="perf-loading-dot" />
          Collecting metrics…
        </div>
      </div>
    );
  }

  const { fps, frame, render, gpu, memory, sections, tasks, diag } = snapshot;
  const collapsed = settings.collapsed || {};
  const warnings = computeWarnings(snapshot);
  const tone = fpsTone(fps);

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
    <div className="perf-overlay" role="dialog" aria-label="Performance overlay">
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
        {/* Hero + live graphs */}
        <div className="perf-hero">
          <div className="perf-hero-metrics">
            <div className={`perf-hero-fps perf-hero-${tone}`}>
              <span className="perf-hero-value">{fps}</span>
              <span className="perf-hero-unit">fps</span>
            </div>
            <div className="perf-hero-secondary">
              <div className="perf-hero-stat">
                <span className="perf-hero-stat-label">Frame</span>
                <span className={`perf-hero-stat-value${frame?.avg > 22 ? ' warn' : ''}`}>{fmtMs(frame?.avg)}</span>
              </div>
              <div className="perf-hero-stat">
                <span className="perf-hero-stat-label">Draws</span>
                <span className="perf-hero-stat-value">{render?.calls ?? '–'}</span>
              </div>
              <div className="perf-hero-stat">
                <span className="perf-hero-stat-label">Tris</span>
                <span className="perf-hero-stat-value">{fmtNum(render?.triangles)}</span>
              </div>
            </div>
          </div>

          <GraphCard label="Frame rate" hint="~24 s">
            <PerfSparkline
              data={history?.fps}
              color="var(--success)"
              fill="rgba(34, 197, 94, 0.12)"
              minY={0}
              maxY={Math.max(60, ...(history?.fps || []))}
              reference={60}
              referenceLabel="60 fps"
              unit=" fps"
            />
          </GraphCard>

          <GraphCard label="Frame time" hint="CPU ms">
            <PerfSparkline
              data={history?.frameMs}
              color="var(--accent)"
              fill="var(--accent-bg)"
              minY={0}
              maxY={Math.max(33, ...(history?.frameMs || []))}
              reference={16.67}
              referenceLabel="16.7 ms"
              unit=" ms"
            />
          </GraphCard>

          <div className="perf-graph-duo">
            <GraphCard label="Draw calls">
              <PerfSparkline
                data={history?.drawCalls}
                color="var(--accent)"
                fill="var(--accent-bg)"
                minY={0}
              />
            </GraphCard>
            <GraphCard label="Triangles" hint="×1000">
              <PerfSparkline
                data={history?.triangles}
                color="var(--text-muted)"
                fill="rgba(163, 163, 163, 0.1)"
                minY={0}
                unit="K"
              />
            </GraphCard>
          </div>
        </div>

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
          ) : <Row label="Renderer" value="collecting…" />}
        </Section>

        <Section id="timing" title="Frame timing (CPU)" collapsed={collapsed.timing} onToggle={onToggleSection}>
          {sections && sections.length ? sections.map((s) => (
            <Row key={s.name} label={s.name} value={`${s.avg.toFixed(2)} ms (max ${s.max.toFixed(1)})`} warn={s.avg > 8} />
          )) : <Row label="No section data yet" value="…" />}
        </Section>

        <Section id="gpu" title="GPU / Renderer" collapsed={collapsed.gpu} onToggle={onToggleSection}>
          <Row label="Renderer backend" value={diag?.renderer?.requestedBackendLabel || 'â€“'} />
          <Row label="Active renderer" value={diag?.renderer?.activeBackendLabel || 'â€“'} warn={diag?.renderer?.reloadRequired} />
          <Row label="GPU preference" value={diag?.renderer?.requestedGpuPreferenceLabel || 'â€“'} />
          <Row label="Applied preference" value={diag?.renderer?.activeGpuPreferenceLabel || 'â€“'} warn={diag?.renderer?.reloadRequired} />
          <Row label="Detected GPU" value={diag?.renderer?.capabilities?.detectedGpu || diag?.gpuName || 'â€“'} warn={diag?.renderer?.capabilities?.gpuInfoAvailable === false} />
          <Row label="WebGPU support" value={diag?.renderer?.capabilities?.webgpu?.supported ? 'available' : 'unavailable'} />
          {gpu && gpu.supported ? (
            <>
              <Row label="Frame GPU" value={fmtMs(gpu.frameMs)} />
              <Row label="Per-pass" value="whole-frame only" />
              {gpu.disjoint && <Row label="Note" value="disjoint — result unreliable" warn />}
            </>
          ) : <Row label="GPU timing" value="unavailable on this browser/device" />}
          {diag?.renderer?.reloadRequired && <Row label="Apply required" value="reload renderer" warn />}
        </Section>

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

        <Section id="terrain" title="Terrain" collapsed={collapsed.terrain} onToggle={onToggleSection}>
          {diag && renderTerrain(diag)}
        </Section>

        <Section id="culling" title="Culling & LOD" collapsed={collapsed.culling} onToggle={onToggleSection}>
          <Row label="Total chunks" value={cull.total ?? '–'} />
          <Row label="Visible" value={cull.visible ?? '–'} />
          <Row label="Culled" value={cull.culled ?? '–'} />
          {lod.map((c, i) => <Row key={i} label={`LOD${i}`} value={c} />)}
        </Section>

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

        <div className="perf-prefs">
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
