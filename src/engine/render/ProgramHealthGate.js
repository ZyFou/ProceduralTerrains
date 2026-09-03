const fnv1a = (text = '') => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const stableDefines = (defines = {}) => Object.fromEntries(
  Object.keys(defines).sort().map((key) => [key, defines[key]]),
);

const withoutBenchmarkDefine = (source = '') => source.replace(
  /^[\t ]*#define[\t ]+TERRAIN_BENCHMARK_RUN[\t ]+\S+[\t ]*(?:\r?\n|$)/gm,
  '',
);

const samplerTypes = (gl) => new Set([
  gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D, gl.SAMPLER_2D_SHADOW,
  gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_ARRAY_SHADOW, gl.SAMPLER_CUBE_SHADOW,
  gl.INT_SAMPLER_2D, gl.INT_SAMPLER_3D, gl.INT_SAMPLER_CUBE, gl.INT_SAMPLER_2D_ARRAY,
  gl.UNSIGNED_INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_3D,
  gl.UNSIGNED_INT_SAMPLER_CUBE, gl.UNSIGNED_INT_SAMPLER_2D_ARRAY,
].filter((value) => value != null));

export function materialProgramDescriptor(material, role = null) {
  const vertexShader = material?.vertexShader || '';
  const fragmentShader = material?.fragmentShader || '';
  const defines = material?.defines || {};
  const normalizedDefines = stableDefines(defines);
  const sourceKey = JSON.stringify({ vertexShader, fragmentShader, defines: normalizedDefines });
  const fragmentSamplerNames = [...fragmentShader.matchAll(
    /uniform\s+(?:[iu]?sampler\w+)\s+([A-Za-z_]\w*)\s*(?:\[\s*\d+\s*\])?\s*;/g,
  )].map((match) => match[1]);
  return {
    role: role || material?.name || material?.type || 'material',
    materialId: material?.id ?? null,
    sourceHash: fnv1a(sourceKey),
    definesHash: fnv1a(JSON.stringify(normalizedDefines)),
    vertexChars: vertexShader.length,
    fragmentChars: fragmentShader.length,
    defines: normalizedDefines,
    fragmentSamplerNames,
  };
}

export function inspectProgram(gl, programWrapper, descriptor = {}) {
  const program = programWrapper?.program || programWrapper;
  const checkedAt = performance.now();
  if (!gl || !program || typeof gl.getProgramParameter !== 'function') {
    return { ...descriptor, ok: false, code: 'PROGRAM_UNAVAILABLE', checkedAt };
  }

  // Three defers its own diagnostics until uniforms are requested. Trigger that
  // boundary before reading LINK_STATUS so a completed driver job cannot be
  // mistaken for a runnable program.
  try { programWrapper?.getUniforms?.(); } catch { /* link status below is authoritative */ }

  const linked = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
  let linkedVertexSource = '';
  let linkedFragmentSource = '';
  try {
    for (const shader of gl.getAttachedShaders?.(program) || []) {
      const source = gl.getShaderSource?.(shader) || '';
      const type = gl.getShaderParameter?.(shader, gl.SHADER_TYPE);
      if (type === gl.VERTEX_SHADER) linkedVertexSource = source;
      else if (type === gl.FRAGMENT_SHADER) linkedFragmentSource = source;
    }
  } catch { /* linked source introspection is optional */ }
  const linkedSource = `${linkedVertexSource}\n${linkedFragmentSource}`;
  const productionVertexSource = withoutBenchmarkDefine(linkedVertexSource);
  const productionFragmentSource = withoutBenchmarkDefine(linkedFragmentSource);
  const productionLinkedSource = `${productionVertexSource}\n${productionFragmentSource}`;
  const activeUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) || 0;
  const types = samplerTypes(gl);
  let activeSamplers = 0;
  const fragmentSamplerNames = new Set(descriptor.fragmentSamplerNames || []);
  const uniforms = [];
  for (let index = 0; index < activeUniforms; index += 1) {
    const info = gl.getActiveUniform(program, index);
    if (!info) continue;
    const baseName = info.name.replace(/\[0\]$/, '');
    if (types.has(info.type)
        && (!fragmentSamplerNames.size || fragmentSamplerNames.has(baseName))) {
      activeSamplers += Math.max(1, info.size || 1);
    }
    uniforms.push({ name: info.name, size: info.size, type: info.type });
  }
  return {
    ...descriptor,
    ok: linked,
    code: linked ? null : 'PROGRAM_LINK_FAILED',
    linked,
    linkedSourceHash: linkedVertexSource || linkedFragmentSource
      ? fnv1a(linkedSource)
      : null,
    productionLinkedSourceHash: linkedVertexSource || linkedFragmentSource
      ? fnv1a(productionLinkedSource)
      : null,
    linkedVertexChars: linkedVertexSource.length || descriptor.vertexChars || 0,
    linkedFragmentChars: linkedFragmentSource.length || descriptor.fragmentChars || 0,
    productionLinkedVertexChars: productionVertexSource.length || descriptor.vertexChars || 0,
    productionLinkedFragmentChars: productionFragmentSource.length || descriptor.fragmentChars || 0,
    activeUniforms,
    activeSamplers,
    programLog: gl.getProgramInfoLog(program) || '',
    vertexLog: programWrapper?.diagnostics?.vertexShader?.log || '',
    fragmentLog: programWrapper?.diagnostics?.fragmentShader?.log || '',
    uniforms,
    checkedAt,
  };
}

const drainErrors = (gl) => {
  const errors = [];
  if (!gl?.getError) return errors;
  for (let index = 0; index < 16; index += 1) {
    const error = gl.getError();
    if (error === gl.NO_ERROR) break;
    errors.push(error);
  }
  return errors;
};

export async function validatePrograms({
  renderer,
  materials,
  describe = (material) => materialProgramDescriptor(material),
  canary,
} = {}) {
  const gl = renderer?.getContext?.();
  const properties = renderer?.properties;
  const diagnostics = [];
  for (const material of new Set((materials || []).filter(Boolean))) {
    const wrapper = properties?.get?.(material)?.currentProgram;
    diagnostics.push(inspectProgram(gl, wrapper, describe(material)));
  }
  const linkOk = diagnostics.length > 0 && diagnostics.every((entry) => entry.ok);
  if (!linkOk) {
    return { ok: false, code: 'PROGRAM_LINK_FAILED', diagnostics, glErrors: drainErrors(gl) };
  }

  drainErrors(gl);
  let canaryError = null;
  try { await canary?.(); } catch (error) { canaryError = error; }
  const glErrors = drainErrors(gl);
  const contextLost = !!gl?.isContextLost?.();
  const ok = !canaryError && !contextLost && glErrors.length === 0;
  return {
    ok,
    code: ok ? null : contextLost ? 'CONTEXT_LOST' : 'PROGRAM_CANARY_FAILED',
    diagnostics,
    glErrors,
    canaryError: canaryError?.message || null,
    contextLost,
  };
}

export function programHealthError(result) {
  const first = result?.diagnostics?.find((entry) => !entry.ok);
  const message = first
    ? `${first.role || 'Shader'} could not be linked${first.programLog ? `: ${first.programLog}` : ''}`
    : 'The compiled graphics program failed its offscreen health check.';
  const error = new Error(message);
  error.code = result?.code || 'PROGRAM_HEALTH_FAILED';
  error.diagnostics = result;
  return error;
}
