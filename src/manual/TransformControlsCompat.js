/**
 * TransformControls changed from being its own scene object to exposing a
 * separate helper object. Accept both shapes so a cached Three.js runtime can
 * still initialize while a new application bundle is being activated.
 */
export function resolveTransformControlsHelper(transform) {
  if (!transform) throw new TypeError('TransformControls instance is required');
  if (typeof transform.getHelper !== 'function') return transform;

  try {
    return transform.getHelper() || transform;
  } catch {
    return transform;
  }
}
