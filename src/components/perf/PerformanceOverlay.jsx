import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
// ============================================================================
// PerformanceOverlay — expanded engine diagnostics panel.
// Reads a merged snapshot from usePerfOverlay; purely presentational.
// ============================================================================

import React, { useState } from 'react';
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
  useLanguage();
  return (
    <div className="perf-row">
      <span className="perf-row-label">{translateText(label)}</span>
      <span className={`perf-row-value${warn ? ' warn' : ''}`}>{translateText(value)}</span>
    </div>
  );
}

function Section({ id, title, collapsed, onToggle, children }) {
  useLanguage();
  return (
    <div className="perf-section">
      <button type="button" className="perf-section-head" onClick={() => onToggle(id)}>
        <span className={`perf-caret${collapsed ? ' closed' : ''}`}>
          <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden><path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </span>
        {translateText(title)}
      </button>
      {!collapsed && <div className="perf-section-body">{children}</div>}
    </div>
  );
}

function GraphCard({ label, hint, children }) {
  useLanguage();
  return (
    <div className="perf-graph-card">
      <div className="perf-graph-card-head">
        <span className="perf-graph-card-label">{translateText(label)}</span>
        {hint && <span className="perf-graph-card-hint">{translateText(hint)}</span>}
      </div>
      {children}
    </div>
  );
}

export default function PerformanceOverlay({
  snapshot, history, settings, onClose, onToggleSection, onSetShowWarnings,
}) {
  useLanguage();
  const [copied, setCopied] = useState('');
  if (!snapshot) {
    return (
      <div className="perf-overlay perf-overlay-loading" role="dialog" aria-label={translateText("Performance overlay")}>
        <div className="perf-overlay-head">
          <span className="perf-title">{translateText("Performance")}</span>
          <button type="button" className="perf-x" onClick={onClose} aria-label={translateText("Close")}>✕</button>
        </div>
        <div className="perf-loading-body">
          <span className="perf-loading-dot" />{translateText("Collecting metrics…")}</div>
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
    <div className="perf-overlay" role="dialog" aria-label={translateText("Performance overlay")}>
      <div className="perf-overlay-head">
        <span className="perf-title">{translateText("Performance")}</span>
        <div className="perf-head-actions">
          <button type="button" className={`perf-chip${copied === 'text' ? ' ok' : ''}`} onClick={() => copy('text')}>
            {translateText(copied === 'text' ? 'Copied' : 'Copy')}
          </button>
          <button type="button" className={`perf-chip${copied === 'json' ? ' ok' : ''}`} onClick={() => copy('json')}>
            {translateText(copied === 'json' ? 'Copied' : 'JSON')}
          </button>
          <button type="button" className="perf-x" onClick={onClose} aria-label={translateText("Close")}>✕</button>
        </div>
      </div>

      <div className="perf-overlay-body">
        {/* Hero + live graphs */}
        <div className="perf-hero">
          <div className="perf-hero-metrics">
            <div className={`perf-hero-fps perf-hero-${tone}`}>
              <span className="perf-hero-value">{translateText(fps)}</span>
              <span className="perf-hero-unit">{translateText("fps")}</span>
            </div>
            <div className="perf-hero-secondary">
              <div className="perf-hero-stat">
                <span className="perf-hero-stat-label">{translateText("Frame")}</span>
                <span className={`perf-hero-stat-value${frame?.avg > 22 ? ' warn' : ''}`}>{translateText(fmtMs(frame?.avg))}</span>
              </div>
              <div className="perf-hero-stat">
                <span className="perf-hero-stat-label">{translateText("Draws")}</span>
                <span className="perf-hero-stat-value">{translateText(render?.calls ?? '–')}</span>
              </div>
              <div className="perf-hero-stat">
                <span className="perf-hero-stat-label">{translateText("Tris")}</span>
                <span className="perf-hero-stat-value">{translateText(fmtNum(render?.triangles))}</span>
              </div>
            </div>
          </div>

          <GraphCard label={translateText("Frame rate")} hint={translateText("~24 s")}>
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

          <GraphCard label={translateText("Frame time")} hint={translateText("CPU ms")}>
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
            <GraphCard label={translateText("Draw calls")}>
              <PerfSparkline
                data={history?.drawCalls}
                color="var(--accent)"
                fill="var(--accent-bg)"
                minY={0}
              />
            </GraphCard>
            <GraphCard label={translateText("Triangles")} hint="×1000">
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

        <Section id="summary" title={translateText("Summary")} collapsed={collapsed.summary} onToggle={onToggleSection}>
          <Row label={translateText("FPS")} value={fps} warn={fps > 0 && fps < 45} />
          <Row label={translateText("Avg FPS")} value={snapshot.fpsAvg} />
          <Row label={translateText("Frame")} value={fmtMs(frame?.avg)} warn={frame?.avg > 22} />
          <Row label={translateText("Frame min/max")} value={`${fmtMs(frame?.min)} / ${fmtMs(frame?.max)}`} />
          <Row label={translateText("Mode")} value={diag?.mode || '–'} />
          <Row label={translateText("State")} value={diag?.state || '–'} />
          <Row label={translateText("Quality")} value={diag?.qualityPreset || '–'} />
          <Row label={translateText("Pixel ratio")} value={diag?.pixelRatio?.toFixed(2) ?? '–'} warn={diag?.pixelRatio > 2.5} />
          <Row label={translateText("Render size")} value={diag?.drawingBuffer ? `${diag.drawingBuffer.w}×${diag.drawingBuffer.h}` : '–'} />
          <Row label={translateText("Camera")} value={cam ? `${cam.x.toFixed(0)}, ${cam.y.toFixed(0)}, ${cam.z.toFixed(0)}` : '–'} />
        </Section>

        <Section id="rendering" title={translateText("Rendering")} collapsed={collapsed.rendering} onToggle={onToggleSection}>
          {render ? (
            <>
              <Row label={translateText("Draw calls")} value={render.calls} warn={render.calls > 1500} />
              <Row label={translateText("Triangles")} value={fmtNum(render.triangles)} warn={render.triangles > 3e6} />
              <Row label={translateText("Points")} value={render.points} />
              <Row label={translateText("Lines")} value={render.lines} />
              <Row label={translateText("Geometries")} value={render.geometries} />
              <Row label={translateText("Textures")} value={render.textures} warn={render.textures > 120} />
              <Row label={translateText("Programs")} value={render.programs} />
              <Row label={translateText("Shadows")} value={diag?.shadowsEnabled ? 'on' : 'off'} />
              <Row label={translateText("Underwater pass")} value={diag?.postProcessing?.underwater ? 'active' : 'inactive'} />
            </>
          ) : <Row label={translateText("Renderer")} value="collecting…" />}
        </Section>

        <Section id="timing" title={translateText("Frame timing (CPU)")} collapsed={collapsed.timing} onToggle={onToggleSection}>
          {sections && sections.length ? sections.map((s) => (
            <Row key={s.name} label={translateText(s.name)} value={`${s.avg.toFixed(2)} ms (max ${s.max.toFixed(1)})`} warn={s.avg > 8} />
          )) : <Row label={translateText("No section data yet")} value="…" />}
        </Section>

        <Section id="gpu" title={translateText("GPU / Renderer")} collapsed={collapsed.gpu} onToggle={onToggleSection}>
          <Row label={translateText("Renderer backend")} value={diag?.renderer?.requestedBackendLabel || 'â€“'} />
          <Row label={translateText("Active renderer")} value={diag?.renderer?.activeBackendLabel || 'â€“'} warn={diag?.renderer?.reloadRequired} />
          <Row label={translateText("GPU preference")} value={diag?.renderer?.requestedGpuPreferenceLabel || 'â€“'} />
          <Row label={translateText("Applied preference")} value={diag?.renderer?.activeGpuPreferenceLabel || 'â€“'} warn={diag?.renderer?.reloadRequired} />
          <Row label={translateText("Detected GPU")} value={diag?.renderer?.capabilities?.detectedGpu || diag?.gpuName || 'â€“'} warn={diag?.renderer?.capabilities?.gpuInfoAvailable === false} />
          <Row label={translateText("WebGPU support")} value={diag?.renderer?.capabilities?.webgpu?.supported ? 'available' : 'unavailable'} />
          {gpu && gpu.supported ? (
            <>
              <Row label={translateText("Frame GPU")} value={fmtMs(gpu.frameMs)} />
              <Row label={translateText("Per-pass")} value="whole-frame only" />
              {gpu.disjoint && <Row label={translateText("Note")} value="disjoint — result unreliable" warn />}
            </>
          ) : <Row label={translateText("GPU timing")} value="unavailable on this browser/device" />}
          {diag?.renderer?.reloadRequired && <Row label={translateText("Apply required")} value="reload renderer" warn />}
        </Section>

        <Section id="memory" title={translateText("Memory")} collapsed={collapsed.memory} onToggle={onToggleSection}>
          {memory && memory.supported ? (
            <>
              <Row label={translateText("JS heap used")} value={mb(memory.usedJSHeap)} warn={memory.usedJSHeap / memory.jsHeapLimit > 0.85} />
              <Row label={translateText("JS heap total")} value={mb(memory.totalJSHeap)} />
              <Row label={translateText("JS heap limit")} value={mb(memory.jsHeapLimit)} />
            </>
          ) : <Row label={translateText("Memory API")} value="unavailable" />}
          <Row label={translateText("Textures")} value={render?.textures ?? '–'} />
          <Row label={translateText("Geometries")} value={render?.geometries ?? '–'} />
        </Section>

        <Section id="loading" title={translateText("Loading")} collapsed={collapsed.loading} onToggle={onToggleSection}>
          {tasks && tasks.length ? tasks.map((t) => (
            <Row
              key={t.id}
              label={translateText(t.name)}
              value={`${t.status}${t.progress != null ? ` ${Math.round(t.progress * 100)}%` : ''}${t.elapsed ? ` · ${(t.elapsed / 1000).toFixed(1)}s` : ''}`}
              warn={t.status === 'failed'}
            />
          )) : <Row label={translateText("No active tasks")} value="idle" />}
        </Section>

        <Section id="terrain" title={translateText("Terrain")} collapsed={collapsed.terrain} onToggle={onToggleSection}>
          {translateText(diag && renderTerrain(diag))}
        </Section>

        <Section id="culling" title={translateText("Culling & LOD")} collapsed={collapsed.culling} onToggle={onToggleSection}>
          <Row label={translateText("Total chunks")} value={cull.total ?? '–'} />
          <Row label={translateText("Visible")} value={cull.visible ?? '–'} />
          <Row label={translateText("Culled")} value={cull.culled ?? '–'} />
          {lod.map((c, i) => <Row key={i} label={translateText(`LOD${i}`)} value={c} />)}
        </Section>

        <Section id="props" title={translateText("Terrain Props")} collapsed={collapsed.props} onToggle={onToggleSection}>
          {diag?.props ? (
            <>
              <Row label={translateText("Quality tier")} value={diag.props.quality ?? '–'} />
              <Row label={translateText("Grass / flowers")} value={`${fmtNum(diag.props.instances?.grass || 0)} / ${fmtNum(diag.props.instances?.flowers || 0)}`} />
              <Row label={translateText("Rocks / trees")} value={`${fmtNum(diag.props.instances?.rocks || 0)} / ${fmtNum(diag.props.instances?.trees || 0)}`} />
              <Row label={translateText("Draw calls")} value={diag.props.drawCalls ?? 0} warn={diag.props.drawCalls > 9} />
              <Row label={translateText("Triangles")} value={fmtNum(diag.props.triangles || 0)} warn={diag.props.triangles > 65000} />
              <Row label={translateText("Sectors / queued")} value={`${diag.props.sectors || 0} / ${diag.props.queuedSectors || 0}`} />
              <Row label={translateText("Last update")} value={fmtMs(diag.props.buildMs)} warn={diag.props.buildMs > 8} />
              <Row label={translateText("Surface readbacks")} value={diag.props.surfaceReadbacks || 0} />
            </>
          ) : <Row label={translateText("Props")} value="unavailable" />}
        </Section>

        <Section id="clouds" title={translateText("Clouds")} collapsed={collapsed.clouds} onToggle={onToggleSection}>
          {diag?.clouds && (
            <>
              <Row label={translateText("Enabled")} value={diag.clouds.enabled ? 'yes' : 'no'} />
              <Row label={translateText("Mode")} value={diag.clouds.mode} />
              <Row label={translateText("Layers")} value={diag.clouds.layers} />
              <Row label={translateText("Raymarch steps")} value={diag.clouds.steps} warn={diag.clouds.steps > 64} />
              <Row label={translateText("Light steps")} value={diag.clouds.lightSteps} />
              <Row label={translateText("Octaves")} value={`${diag.clouds.octaves} + ${diag.clouds.detailOctaves} detail`} />
              <Row label={translateText("Coverage")} value={fmtMaybe(diag.clouds.coverage)} />
              <Row label={translateText("Density")} value={fmtMaybe(diag.clouds.density)} />
              <Row label={translateText("Wind / evolve")} value={`${fmtMaybe(diag.clouds.windSpeed)} / ${fmtMaybe(diag.clouds.evolveSpeed)}`} />
              <Row label={translateText("Culling")} value={diag.clouds.cullingMode} />
              <Row label={translateText("LOD")} value={diag.clouds.lod} />
              <Row label={translateText("Update time")} value={fmtMs(diag.clouds.time)} />
            </>
          )}
        </Section>

        <Section id="water" title={translateText("Water")} collapsed={collapsed.water} onToggle={onToggleSection}>
          {diag?.water && (
            <>
              <Row label={translateText("Enabled")} value={diag.water.enabled ? 'yes' : 'no'} />
              <Row label={translateText("Mode")} value={diag.water.mode} />
              <Row label={translateText("Quality")} value={diag.water.quality} />
              <Row label={translateText("Reflection")} value={fmtMaybe(diag.water.reflection)} />
              <Row label={translateText("Detail")} value={fmtMaybe(diag.water.detail)} />
              <Row label={translateText("Waves")} value={fmtMaybe(diag.water.waves)} />
              <Row label={translateText("Sea level")} value={fmtMaybe(diag.water.seaLevel)} />
              <Row label={translateText("Underwater")} value={diag.water.underwater ? 'active' : 'inactive'} />
              {diag.water.performanceCost && (() => {
                const cost = diag.water.performanceCost;
                const surface = cost.surface || {};
                const refraction = cost.refraction || {};
                const reflectionPass = cost.reflection || {};
                return (
                  <>
                    <Row
                      label={translateText("Surface geometry")}
                      value={`${surface.mode || '–'} · ${fmtNum(surface.vertices || 0)} verts · ${fmtNum(surface.triangles || 0)} tris`}
                    />
                    <Row
                      label={translateText("Surface CPU submit")}
                      value={fmtMs(surface.surfaceSubmitAvgMs)}
                    />
                    <Row
                      label={translateText("Surface GPU")}
                      value={gpu?.supported
                        ? `${fmtMs(gpu.frameMs)} whole frame`
                        : 'whole-frame timer unavailable'}
                    />
                    <Row
                      label={translateText("Opaque refraction")}
                      value={`${fmtMs(refraction.captureMs)} · ${fmtPassResolution(refraction)}`}
                    />
                    <Row
                      label={translateText("Planar reflection")}
                      value={`${fmtMs(reflectionPass.captureMs)} · ${fmtPassResolution(reflectionPass)}`}
                    />
                    <Row
                      label={translateText("Water target memory")}
                      value={mb(cost.renderTargetMemoryBytes || 0)}
                    />
                    <Row
                      label={translateText("Extra scene renders")}
                      value={cost.additionalSceneRenders ?? 0}
                    />
                  </>
                );
              })()}
            </>
          )}
        </Section>

        <Section id="underwater" title={translateText("Underwater")} collapsed={collapsed.underwater} onToggle={onToggleSection}>
          {diag?.underwater && (
            <>
              <Row label={translateText("Active")} value={diag.underwater.active ? 'yes' : 'no'} />
              <Row label={translateText("Mode")} value={diag.underwater.mode} />
              {diag.underwater.fellBackToLite && (
                <Row label={translateText("Requested")} value={`${diag.underwater.requestedMode} → lite`} />
              )}
              <Row label={translateText("Blend")} value={fmtMaybe(diag.underwater.blend, 2)} />
              <Row label={translateText("Depth below")} value={fmtMaybe(diag.underwater.depth, 1)} />
              <Row label={translateText("Caustics")} value={diag.underwater.causticsEnabled ? 'on' : 'off'} />
              <Row label={translateText("Light shafts")} value={diag.underwater.lightShaftsEnabled ? 'on' : 'off'} />
              <Row label={translateText("Particles")} value={diag.underwater.particlesEnabled ? 'on' : 'off'} />
              <Row label={translateText("Cost estimate")} value={diag.underwater.costEstimate} />
              {diag.underwater.postProcessApplies === false && (
                <Row label={translateText("Post-process")} value="n/a (planet)" />
              )}
              {diag.underwater.depthTextureAvailable === false && (
                <Row label={translateText("Depth texture")} value="unavailable" />
              )}
            </>
          )}
        </Section>

        {settings.showWarnings && (
          <Section id="warnings" title={translateText(`Warnings (${warnings.length})`)} collapsed={collapsed.warnings} onToggle={onToggleSection}>
            {warnings.length ? warnings.map((w, i) => (
              <div key={i} className={`perf-warn perf-warn-${w.level}`}>
                <span className="perf-warn-level">{translateText(w.level)}</span>
                <span className="perf-warn-label">{translateText(w.label)}</span>
              </div>
            )) : <Row label={translateText("No warnings")} value="all clear" />}
          </Section>
        )}

        <div className="perf-prefs">
          <label><input type="checkbox" checked={!!settings.showWarnings} onChange={(e) => onSetShowWarnings(e.target.checked)} />{translateText(" Warnings")}</label>
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

function fmtPassResolution(pass) {
  return pass?.resolution
    ? `${pass.resolution.width}×${pass.resolution.height}`
    : 'not allocated';
}

function renderTerrain(diag) {
  const t = diag.terrain || {};
  if (diag.mode === 'infinite') {
    return (
      <>
        <Row label={translateText("Chunk size")} value={fmtMaybe(t.chunkSize)} />
        <Row label={translateText("View radius")} value={fmtMaybe(t.viewRadius)} />
        <Row label={translateText("Render distance")} value={fmtMaybe(t.renderDistance)} />
        <Row label={translateText("LOD thresholds")} value={(t.lodThresholds || []).map((x) => x.toFixed(0)).join(', ') || '–'} />
        <Row label={translateText("Last chunk gen")} value={t.lastChunkGenMs != null ? `${t.lastChunkGenMs.toFixed(1)} ms` : '–'} />
      </>
    );
  }
  if (diag.mode === 'planet') {
    return (
      <>
        <Row label={translateText("Planet radius")} value={fmtMaybe(t.planetRadius)} />
        <Row label={translateText("Face grid")} value={fmtMaybe(t.faceGrid)} />
        <Row label={translateText("Baked height tex")} value={t.bakedHeightTex ? 'yes' : 'no'} />
        <Row label={translateText("Last rebuild")} value={t.lastRebuildMs != null ? `${t.lastRebuildMs.toFixed(1)} ms` : '–'} />
      </>
    );
  }
  return (
    <>
      <Row label={translateText("Resolution")} value={fmtMaybe(t.resolution)} />
      <Row label={translateText("Board size")} value={fmtMaybe(t.boardSize)} />
      <Row label={translateText("Tiles")} value={fmtMaybe(t.tiles)} />
      <Row label={translateText("Height scale")} value={fmtMaybe(t.heightScale)} />
      <Row label={translateText("Octaves")} value={fmtMaybe(t.octaves)} />
      <Row label={translateText("Noise layers")} value={fmtMaybe(t.noiseLayers)} />
      <Row label={translateText("Baked height tex")} value={t.bakedHeightTex ? 'yes' : 'no'} />
      <Row label={translateText("Last bake")} value={t.lastBakeMs != null ? `${t.lastBakeMs.toFixed(1)} ms` : '–'} />
    </>
  );
}
