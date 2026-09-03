const graphProgramDescriptor = (program) => (program ? {
  kind: program.kind,
  sig: program.sig,
  heightSig: program.heightSig,
  slotCount: program.slotCount,
  colorSlotCount: program.colorSlotCount,
} : null);

/**
 * Convert engine return values that contain worker-local state into their
 * public, structured-cloneable representation.
 */
export async function prepareWorkerResult(method, result) {
  if (method !== 'setTerrainGraph' || !result || typeof result !== 'object') return result;

  const { program, ready, ...status } = result;
  return {
    ...status,
    program: graphProgramDescriptor(program),
    ready: await ready,
  };
}
