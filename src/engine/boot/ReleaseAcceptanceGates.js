const PASS = 'pass';
const FAIL = 'fail';
const PENDING = 'pending';
const NOT_APPLICABLE = 'not-applicable';

function check(id, label, status, detail, evidence = null) {
  return Object.freeze({ id, label, status, detail, evidence });
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * Convert live engine evidence into conservative release gates.
 *
 * A missing measurement is deliberately `pending`, never a pass. This makes
 * the panel useful as a release checklist without turning the diagnostics
 * themselves into another source of false confidence.
 */
export function evaluateReleaseAcceptance({
  nowMs = 0,
  boot = {},
  shader = {},
  context = {},
  mode = {},
  resources = {},
  cache = {},
  stability = {},
} = {}) {
  const checks = [];

  const frameFailed = Boolean(boot.error);
  const frameReady = boot.presented === true && boot.pending !== true;
  checks.push(check(
    'final-frame',
    'Final frame publication',
    frameFailed ? FAIL : (frameReady ? PASS : PENDING),
    frameFailed
      ? (boot.error?.message || 'Final-frame preparation failed')
      : (frameReady ? 'A validated final frame is live' : 'Waiting for final-frame publication'),
    { pipelineState: boot.pipelineState || null, mode: boot.mode || null },
  ));

  const shaderFailures = Math.max(0, Number(shader.failureCount) || 0);
  const lastCompileReady = shader.lastCompileReady;
  checks.push(check(
    'shader-link-health',
    'Shader link and first-use health',
    shaderFailures > 0 || lastCompileReady === false
      ? FAIL
      : (lastCompileReady === true ? PASS : PENDING),
    shaderFailures > 0
      ? `${shaderFailures} failed program${shaderFailures === 1 ? '' : 's'} in this publication cycle`
      : (lastCompileReady === true ? 'Every submitted final program linked and prepared' : 'No complete compile evidence yet'),
    { failureCount: shaderFailures, lastFailureCode: shader.lastFailureCode || null },
  ));

  checks.push(check(
    'shader-canary',
    'Exact offscreen shader canary',
    shader.canaryValidated === true ? PASS
      : (shader.canaryValidated === false ? FAIL : PENDING),
    shader.canaryValidated === true
      ? 'Exact topology/target canary draw succeeded'
      : (shader.canaryValidated === false
        ? 'Exact topology/target canary draw failed'
        : 'WebGL2 exact canary evidence is not recorded yet'),
  ));

  const activeSamplers = finite(shader.maxActiveFragmentSamplers);
  const samplerLimit = finite(shader.fragmentSamplerLimit);
  let samplerStatus = PENDING;
  let samplerDetail = 'Active sampler count or device limit is unavailable';
  if (activeSamplers != null && samplerLimit != null) {
    samplerStatus = activeSamplers <= samplerLimit ? PASS : FAIL;
    samplerDetail = `${activeSamplers} active fragment samplers / ${samplerLimit} available`;
  }
  checks.push(check(
    'sampler-budget',
    'Fragment sampler admission',
    samplerStatus,
    samplerDetail,
    { active: activeSamplers, limit: samplerLimit, minimumTarget: 16 },
  ));

  const losses = Math.max(0, Number(context.lossCount) || 0);
  const restores = Math.max(0, Number(context.restoreCount) || 0);
  const contextStatus = context.lost === true
    ? FAIL
    : (restores < losses ? PENDING : PASS);
  checks.push(check(
    'context-recovery',
    'Graphics context recovery',
    contextStatus,
    context.lost === true
      ? 'Graphics context is currently lost'
      : (restores < losses
        ? `${losses - restores} context-loss event${losses - restores === 1 ? '' : 's'} still awaiting recovery`
        : `${losses} loss / ${restores} restore events; context is healthy`),
    { losses, restores, circuitBreakerTrips: Number(context.circuitBreakerTrips) || 0 },
  ));

  const dependenciesComplete = mode.dependenciesComplete;
  checks.push(check(
    'launch-dependencies',
    'Visible mode dependencies',
    dependenciesComplete === true ? PASS
      : (dependenciesComplete === false && frameReady ? FAIL : PENDING),
    dependenciesComplete === true
      ? `${mode.name || 'Current mode'} launch dependencies are complete`
      : (mode.dependencyDetail || 'Waiting for visible chunks/cache/LOD dependencies'),
  ));

  const maxSyncMs = finite(shader.maxSyncCompileMs);
  checks.push(check(
    'main-thread-task',
    'Boot-owned main-thread compile task',
    maxSyncMs == null ? PENDING : (maxSyncMs <= 50 ? PASS : FAIL),
    maxSyncMs == null
      ? 'Synchronous compile time has not been measured'
      : `${maxSyncMs.toFixed(1)} ms maximum (50 ms budget)`,
    { measuredMs: maxSyncMs, budgetMs: 50 },
  ));

  const presentedAt = finite(boot.presentedAtMs);
  const elapsedSinceReveal = presentedAt == null ? null : Math.max(0, nowMs - presentedAt);
  const postRevealCompiles = Math.max(0, Number(shader.postRevealCompileCount) || 0);
  const observationComplete = elapsedSinceReveal != null && elapsedSinceReveal >= 5000;
  checks.push(check(
    'post-reveal-compile',
    'First five seconds after reveal',
    postRevealCompiles > 0 ? FAIL : (observationComplete ? PASS : PENDING),
    postRevealCompiles > 0
      ? `${postRevealCompiles} shader compile${postRevealCompiles === 1 ? '' : 's'} started after reveal`
      : (observationComplete ? 'No shader compile started during the five-second window' : 'Five-second observation window is still open'),
    { compileCount: postRevealCompiles, observedMs: elapsedSinceReveal },
  ));

  const measuredBytes = finite(resources.measuredBytes);
  const budgetBytes = finite(resources.budgetBytes);
  let resourceStatus = PENDING;
  if (measuredBytes != null && budgetBytes != null && measuredBytes > budgetBytes) resourceStatus = FAIL;
  else if (measuredBytes != null && budgetBytes != null && resources.complete === true) resourceStatus = PASS;
  checks.push(check(
    'resource-ledger',
    'Pixel and resource-byte ledger',
    resourceStatus,
    measuredBytes == null || budgetBytes == null
      ? 'Resource-byte measurement is unavailable'
      : `${Math.round(measuredBytes / 1048576)} MB measured / ${Math.round(budgetBytes / 1048576)} MB budget${resources.complete === true ? '' : ' (ledger incomplete)'}`,
    { measuredBytes, budgetBytes, complete: resources.complete === true },
  ));

  const cacheHit = cache.hit === true;
  const cacheProved = cacheHit
    && cache.identityReused === true
    && Number(cache.heavyweightConstructorCount || 0) === 0
    && Number(cache.shaderLinkCount || 0) === 0;
  checks.push(check(
    'cache-identity',
    'Prepared-mode cache identity',
    !cacheHit ? NOT_APPLICABLE : (cacheProved ? PASS : FAIL),
    !cacheHit
      ? 'Last publication was not a cache hit'
      : (cacheProved
        ? 'Stable bundle identity reused with zero constructors and links'
        : 'Cache hit did not prove zero-construction/zero-link identity reuse'),
  ));

  const mutations = Math.max(0, Number(stability.postRevealMutationCount) || 0);
  checks.push(check(
    'post-reveal-stability',
    'Published topology stability',
    mutations > 0 ? FAIL : (stability.observationComplete === true ? PASS : PENDING),
    mutations > 0
      ? `${mutations} visible topology/resource mutation${mutations === 1 ? '' : 's'} after reveal`
      : (stability.observationComplete === true
        ? 'No visible topology/resource mutation was recorded after reveal'
        : 'Post-reveal topology observation is incomplete'),
  ));

  const counts = checks.reduce((result, item) => {
    result[item.status] += 1;
    return result;
  }, { [PASS]: 0, [FAIL]: 0, [PENDING]: 0, [NOT_APPLICABLE]: 0 });
  const status = counts[FAIL] > 0 ? 'blocked' : (counts[PENDING] > 0 ? 'incomplete' : 'ready');

  return Object.freeze({
    status,
    ready: status === 'ready',
    counts: Object.freeze(counts),
    checks: Object.freeze(checks),
    blockers: Object.freeze(checks.filter((item) => item.status === FAIL)),
    pending: Object.freeze(checks.filter((item) => item.status === PENDING)),
  });
}

export const RELEASE_GATE_STATUS = Object.freeze({
  PASS,
  FAIL,
  PENDING,
  NOT_APPLICABLE,
});
