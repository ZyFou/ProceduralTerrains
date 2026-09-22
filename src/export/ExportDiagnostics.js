export const LARGE_EXPORT_BYTES = 100_000_000;
export const EXPORT_DIAGNOSTICS_KEY = 'terrain-studio:last-export';
export const EXPORT_STALL_MS = 60_000;

export function exportError(value, fallback = 'Export failed without an error message') {
  if (value instanceof Error) return value;
  const error = new Error(value?.message || (value == null ? fallback : String(value)));
  if (value?.code) error.code = value.code;
  return error;
}

// Uncompressed asset budget, not a prediction of PNG/ZIP compression or a GPU
// allocation limit. Keep duplicate embedded/standalone textures in the estimate.
export function estimateExport(options = {}, context = {}) {
  const planet = context.worldMode === 'planet';
  const count = planet ? 6 : Math.max(1, context.tiles?.length || 1);
  const mesh = Math.max(1, Number(options.meshRes) || (planet ? 128 : 256));
  const texture = Math.max(1, Number(options.texRes) || 1024);
  const hasMesh = planet || options.includeMesh !== false;
  const gridBytes = (resolution) => (resolution + 1) ** 2 * 32 + resolution ** 2 * 6 * 4;
  let geometryBytes = hasMesh ? gridBytes(mesh) * count : 0;
  if (hasMesh && (options.includeSkirts || options.includeBase)) geometryBytes *= 1.1;
  if (!planet && options.exportCollision) geometryBytes += gridBytes(Number(options.collisionRes) || 128) * count;
  // OBJ represents vertices/faces as text rather than packed binary attributes.
  if (options.format === 'obj') geometryBytes *= 3;
  const separate = !planet && count > 1 && context.tileAssemblyShape !== 'circle' && options.exportTileMode === 'separate';
  const color = planet ? options.bakeColor !== false : !!options.bakeColor;
  const normals = !planet && !!options.bakeNormal;
  const materialMaps = Number(color) + Number(normals);
  const mapCount = planet ? Number(color) * 6
    : materialMaps * ((hasMesh ? count : 0) + (separate ? count + 1 : 1))
      + (options.exportHeightmap ? (1 + Number(!!options.exportSplat)) * (separate ? count + 1 : 1) : 0);
  const masks = ['exportWaterMask', 'exportDepthMap', 'exportShorelineMask', 'exportFoamMask'].filter((key) => options[key]).length;
  const maskResolution = Number(options.maskRes) || mesh;
  const textureBytes = mapCount * texture ** 2 * 4 + masks * maskResolution ** 2 * 4 * (separate ? count : 1);
  const rawBytes = !planet && options.exportHeightmap && options.heightmapRawPath
    ? (Number(options.heightRes) || texture) ** 2 * 2 * (separate ? count : 1) : 0;
  const assetBytes = Math.ceil(geometryBytes + textureBytes + rawBytes);
  return { assetBytes, estimatedWorkingBytes: assetBytes * 4, count,
    vertices: hasMesh ? count * (mesh + 1) ** 2 : 0,
    triangles: hasMesh ? count * mesh ** 2 * 2 : 0,
    large: assetBytes > LARGE_EXPORT_BYTES };
}

export function largeExportMessage(estimate) {
  return `Estimated uncompressed export data: ${(estimate.assetBytes / 1e6).toFixed(0)} MB (above 100 MB). `
    + 'The download size depends on compression; temporary CPU/GPU memory can be several times larger. '
    + 'High mesh density, 4K maps and multiple tiles can freeze or crash the browser. Reduce mesh/texture resolution or export fewer tiles.';
}

export class ExportDiagnostics {
  constructor({ storage, now = Date.now, logger = console, onChange = () => {} } = {}) {
    this.storage = storage;
    this.now = now;
    this.logger = logger;
    this.onChange = onChange;
    try { this.report = JSON.parse(storage?.getItem(EXPORT_DIAGNOSTICS_KEY) || 'null'); } catch { this.report = null; }
    if (this.report?.status === 'running') {
      this.report = { ...this.report, status: 'interrupted', stalled: false,
        message: 'The previous export did not finish before this page closed or reloaded. A browser crash is possible, but cannot be confirmed.' };
    }
  }
  publish() {
    try { this.storage?.setItem(EXPORT_DIAGNOSTICS_KEY, JSON.stringify(this.report)); } catch { /* storage may be disabled or full */ }
    this.onChange({ ...this.report });
  }
  start(context) {
    const now = this.now();
    this.report = { id: `export-${now}`, status: 'running', startedAt: now, lastStageAt: now,
      stage: 'Preparing export', context, events: [], stalled: false };
    this.record('start', this.report.stage, { context });
  }
  record(kind, message, extra = {}) {
    if (!this.report) return;
    const event = { at: this.now(), elapsedMs: this.now() - this.report.startedAt, kind, message, ...extra };
    this.report = { ...this.report, events: [...this.report.events.slice(-99), event] };
    this.logger[kind === 'error' ? 'error' : kind === 'warning' ? 'warn' : 'info']('[terrain-export]', this.report.id, event);
    this.publish();
  }
  stage(message) {
    if (this.report?.status !== 'running') return;
    const previousStageDurationMs = this.now() - this.report.lastStageAt;
    this.report = { ...this.report, stage: message, lastStageAt: this.now(), stalled: false };
    this.record('stage', message, { previousStageDurationMs });
  }
  checkStall() {
    if (this.report?.status !== 'running' || this.report.stalled || this.now() - this.report.lastStageAt < EXPORT_STALL_MS) return;
    this.report = { ...this.report, stalled: true };
    this.record('warning', 'No stage update for 60 seconds. Export may be slow or stalled; it is still running.');
  }
  finish(error) {
    const failure = error === undefined ? null : exportError(error);
    this.report = { ...this.report, status: failure ? 'failed' : 'complete', stalled: false,
      endedAt: this.now(), message: failure?.message, error: failure ? { message: failure.message, code: failure.code, stack: failure.stack } : null };
    this.record(failure ? 'error' : 'complete', failure?.message || 'Export generation finished; download/save requested.');
  }
}
