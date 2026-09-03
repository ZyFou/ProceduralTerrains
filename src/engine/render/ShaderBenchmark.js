export const SHADER_BENCHMARK_SCHEMA_VERSION = 1;
export const SHADER_BENCHMARK_FAMILIES = Object.freeze([
  'terrain',
  'water',
  'cloud',
  'post',
  'scene',
]);

const VALID_TARGETS = new Set([...SHADER_BENCHMARK_FAMILIES, 'all']);

function fnv1aNumber(text = '') {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) || 1;
}

function fallbackToken() {
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}`;
}

export function sanitizeShaderBenchmarkToken(value) {
  const clean = String(value || '')
    .trim()
    .slice(0, 64)
    .replace(/[^A-Za-z0-9._:-]/g, '-');
  return clean || null;
}

export function parseShaderBenchmarkOptions(search = '', {
  randomToken = () => globalThis.crypto?.randomUUID?.() || fallbackToken(),
} = {}) {
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const requestedFamily = String(params.get('shaderBenchmark') || '').trim().toLowerCase();
  if (!VALID_TARGETS.has(requestedFamily)) return null;
  const explicitToken = sanitizeShaderBenchmarkToken(params.get('shaderBenchmarkToken'));
  const token = explicitToken || sanitizeShaderBenchmarkToken(randomToken()) || fallbackToken();
  return Object.freeze({
    enabled: true,
    schemaVersion: SHADER_BENCHMARK_SCHEMA_VERSION,
    mode: requestedFamily === 'all' ? 'suite' : 'isolated',
    requestedFamily,
    token,
    explicitToken: !!explicitToken,
    defineValue: fnv1aNumber(token),
    coldShaderRunIgnored: params.has('coldShaderRun'),
  });
}

export function classifyShaderBenchmarkRole(role = '') {
  const normalized = String(role).toLowerCase();
  if (normalized.startsWith('terrain:')
      || normalized.startsWith('infinite-terrain:')
      || normalized === 'planet-terrain') return 'terrain';
  if (normalized.startsWith('water:') || normalized.includes('water-program')) return 'water';
  if (normalized.startsWith('cloud:') || normalized.includes('cloud')) return 'cloud';
  if (normalized.startsWith('post:')) return 'post';
  return 'scene';
}

function candidateKey(candidate) {
  return candidate.key || [
    candidate.material?.id ?? candidate.materialId ?? 'material',
    candidate.topology || 'mesh',
    candidate.targetKey || 'canvas',
  ].join(':');
}

export function selectShaderBenchmarkCandidates(candidates = [], options) {
  const unique = new Map();
  for (const candidate of candidates) {
    if (!candidate?.material) continue;
    const family = candidate.family || classifyShaderBenchmarkRole(candidate.role);
    const normalized = { ...candidate, family, key: candidateKey(candidate) };
    if (!unique.has(normalized.key)) unique.set(normalized.key, normalized);
  }
  const selectedFamilies = options?.mode === 'suite'
    ? SHADER_BENCHMARK_FAMILIES
    : [options?.requestedFamily];
  const familyRank = new Map(SHADER_BENCHMARK_FAMILIES.map((family, index) => [family, index]));
  return [...unique.values()]
    .filter((candidate) => selectedFamilies.includes(candidate.family))
    .sort((a, b) => (familyRank.get(a.family) - familyRank.get(b.family))
      || String(a.role).localeCompare(String(b.role))
      || String(a.key).localeCompare(String(b.key)));
}

const round = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;

export class ShaderBenchmarkRunner {
  constructor({
    compileCase,
    now = () => performance.now(),
    wallNow = () => new Date().toISOString(),
    logger = console,
    onProgress = null,
  } = {}) {
    this.compileCase = compileCase;
    this.now = now;
    this.wallNow = wallNow;
    this.logger = logger;
    this.onProgress = onProgress;
  }

  async run({ options, candidates = [], metadata = {} } = {}) {
    const startedAt = this.wallNow();
    const startedMs = this.now();
    const selected = selectShaderBenchmarkCandidates(candidates, options);
    const requestedFamilies = options.mode === 'suite'
      ? SHADER_BENCHMARK_FAMILIES
      : [options.requestedFamily];
    const cases = [];
    let failed = false;
    let contextLost = false;

    this.logger.info?.(
      `[shader benchmark] start mode=${options.mode}`
      + ` target=${options.requestedFamily} token=${options.token}`,
    );

    for (const family of requestedFamilies) {
      const familyCandidates = selected.filter((candidate) => candidate.family === family);
      if (!familyCandidates.length) {
        cases.push({
          family,
          role: null,
          status: 'skipped',
          reason: 'no-active-candidates',
        });
        continue;
      }
      for (let index = 0; index < familyCandidates.length; index += 1) {
        const candidate = familyCandidates[index];
        const caseStartedAt = this.wallNow();
        const caseStartedMs = this.now();
        this.onProgress?.({
          family,
          role: candidate.role,
          completed: cases.filter((entry) => entry.status !== 'skipped').length,
          total: selected.length,
        });
        const result = await this.compileCase(candidate, options);
        cases.push({
          family,
          role: candidate.role,
          startedAt: caseStartedAt,
          completedAt: this.wallNow(),
          elapsedMs: round(this.now() - caseStartedMs),
          ...result,
        });
        this.logger.info?.(
          `[shader benchmark] ${family}/${candidate.role}`
          + ` status=${result.status}`
          + ` submit=${round(result.submitMs)}ms`
          + ` driver=${round(result.driverWaitMs)}ms`
          + ` validation=${round(result.validationMs)}ms`,
        );
        if (result.status !== 'passed') {
          failed = true;
          contextLost = !!result.contextLost;
          break;
        }
      }
      if (failed) break;
    }

    const measured = cases.filter((entry) => entry.status !== 'skipped');
    const aggregate = {
      measuredPrograms: measured.length,
      skippedFamilies: cases.filter((entry) => entry.status === 'skipped').length,
      submitMs: round(measured.reduce((sum, entry) => sum + (entry.submitMs || 0), 0)),
      driverWaitMs: round(measured.reduce((sum, entry) => sum + (entry.driverWaitMs || 0), 0)),
      validationMs: round(measured.reduce((sum, entry) => sum + (entry.validationMs || 0), 0)),
      totalCaseMs: round(measured.reduce((sum, entry) => sum + (entry.totalMs || 0), 0)),
      wallMs: round(this.now() - startedMs),
    };
    const result = {
      schemaVersion: SHADER_BENCHMARK_SCHEMA_VERSION,
      status: failed ? 'failed' : 'passed',
      mode: options.mode,
      requestedFamily: options.requestedFamily,
      runId: metadata.runId ?? null,
      token: options.token,
      explicitToken: options.explicitToken,
      defineValue: options.defineValue,
      coldShaderRunIgnored: options.coldShaderRunIgnored,
      startedAt,
      completedAt: this.wallNow(),
      contextLost,
      ...metadata,
      cases,
      aggregate,
      warning: options.mode === 'suite'
        ? 'Sequential suite totals do not predict production parallel boot wall time.'
        : null,
    };
    this.logger.table?.(cases.map((entry) => ({
      family: entry.family,
      role: entry.role || '-',
      status: entry.status,
      submitMs: round(entry.submitMs),
      driverMs: round(entry.driverWaitMs),
      validationMs: round(entry.validationMs),
      totalMs: round(entry.totalMs),
    })));
    this.logger.info?.('[shader benchmark] complete', result);
    return result;
  }
}
