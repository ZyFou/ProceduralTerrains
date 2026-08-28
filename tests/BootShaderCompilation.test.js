import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine/Engine.js';
import { FinalFrameBootPipeline } from '../src/engine/boot/FinalFrameBootPipeline.js';

function engineHarness() {
  const engine = Object.create(Engine.prototype);
  engine._disposed = false;
  engine.camera = {};
  engine.scene = {};
  return engine;
}

function programHarness({ linked = true, contextLost = false, prepareError = null } = {}) {
  const raw = {};
  const vertexShader = {};
  const fragmentShader = {};
  const gl = {
    LINK_STATUS: 0x8B82,
    COMPILE_STATUS: 0x8B81,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
    isContextLost: vi.fn(() => contextLost),
    getProgramParameter: vi.fn((program, parameter) => (
      program === raw && parameter === 0x8B82 ? linked : null
    )),
    getProgramInfoLog: vi.fn(() => (linked ? '' : 'fragment sampler limit exceeded')),
    getShaderInfoLog: vi.fn((shader) => (
      shader === fragmentShader && !linked ? 'fragment link input rejected' : ''
    )),
    getShaderParameter: vi.fn(() => true),
    getShaderSource: vi.fn((shader) => (shader === fragmentShader
      ? 'uniform sampler2D uA; uniform sampler2D uB[2];'
      : 'uniform sampler2D uVertex;')),
    getParameter: vi.fn(() => 16),
    deleteShader: vi.fn(),
    validateProgram: vi.fn(),
  };
  const wrapper = {
    id: 7,
    cacheKey: 'phase-one-program',
    program: raw,
    vertexShader,
    fragmentShader,
    isReady: vi.fn(() => true),
    getUniforms: prepareError
      ? vi.fn(() => { throw prepareError; })
      : vi.fn(() => ({})),
    getAttributes: vi.fn(() => ({})),
  };
  return { raw, wrapper, gl };
}

function attachProgram(engine, material, programState, programs = [programState.wrapper]) {
  engine._disposed = false;
  engine._contextLost = false;
  engine.renderer = {
    properties: {
      get: () => ({
        currentProgram: programState.wrapper,
        programs: new Map(programs.map((program, index) => [String(index), program])),
      }),
    },
    getContext: () => programState.gl,
  };
  material.userData = {
    ...(material.userData || {}),
    renderRole: material.userData?.renderRole || 'terrain:studio:detail',
  };
}

describe('boot shader compilation', () => {
  it('forces a distinct shader source key only when a cold-run token is active', () => {
    const engine = engineHarness();
    const material = { defines: { EXISTING_DEFINE: 1 }, needsUpdate: false };
    engine._shaderColdRun = { token: 'benchmark-1', defineValue: 123456 };
    engine._shaderColdRunLogged = true;

    expect(engine._applyShaderColdRun([material, material])).toBe(true);
    expect(material.defines).toEqual({
      EXISTING_DEFINE: 1,
      TERRAIN_COLD_SHADER_RUN: 123456,
    });
    expect(material.needsUpdate).toBe(true);

    material.needsUpdate = false;
    expect(engine._applyShaderColdRun([material])).toBe(false);
    expect(material.needsUpdate).toBe(false);

    engine._shaderColdRun = null;
    expect(engine._applyShaderColdRun([material])).toBe(false);
  });

  it('collects only materials whose complete parent chain is visible', () => {
    const engine = engineHarness();
    const visibleMaterial = { id: 'visible' };
    const hiddenMaterial = { id: 'hidden-child' };
    const hiddenParent = { visible: false, parent: null };
    const objects = [
      { material: visibleMaterial, visible: true, parent: null },
      { material: hiddenMaterial, visible: true, parent: hiddenParent },
    ];
    engine.scene = { traverse: (visit) => objects.forEach(visit) };
    engine.visualPost = {
      _lookMaterial: { id: 'look' },
      _cameraMaterial: { id: 'camera' },
    };
    engine.underwater = { active: false, _material: { id: 'underwater' } };

    const materials = engine._finalBootMaterials([], {
      lookEnabled: true,
      needsFinalPass: false,
    });

    expect(materials).toContain(visibleMaterial);
    expect(materials).toContain(engine.visualPost._lookMaterial);
    expect(materials).not.toContain(hiddenMaterial);
    expect(materials).not.toContain(engine.visualPost._cameraMaterial);
    expect(materials).not.toContain(engine.underwater._material);
  });

  it('does not treat parallel completion as successful shader linking', async () => {
    const engine = engineHarness();
    const material = { id: 42, type: 'ShaderMaterial', vertexShader: 'v', fragmentShader: 'f' };
    const program = programHarness({ linked: false });
    attachProgram(engine, material, program);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await engine._waitForMaterialsReady(new Set([material]), { timeoutMs: 100 });

    expect(result).toMatchObject({
      ready: false,
      failed: true,
      timedOut: false,
      code: 'SHADER_LINK_FAILED',
      failureCount: 1,
    });
    expect(result.failures[0]).toMatchObject({
      role: 'terrain:studio:detail',
      id: 42,
      programId: 7,
      linked: false,
      programLog: 'fragment sampler limit exceeded',
      fragmentLog: 'fragment link input rejected',
      samplerDeclarations: { vertex: 1, fragment: 3 },
      samplerLimits: { vertex: 16, fragment: 16, combined: 16 },
    });
    expect(program.gl.getProgramParameter).toHaveBeenCalledWith(program.raw, program.gl.LINK_STATUS);
    expect(program.gl.validateProgram).not.toHaveBeenCalled();
    expect(program.wrapper.getUniforms).not.toHaveBeenCalled();
    expect(program.gl.deleteShader).toHaveBeenCalledTimes(2);
    engine._inspectCompiledProgram(material, program.wrapper, engine.renderer, program.gl);
    expect(program.gl.deleteShader).toHaveBeenCalledTimes(2);
    errorLog.mockRestore();
  });

  it('prepares uniforms and attributes only after a successful link', async () => {
    const engine = engineHarness();
    const material = { id: 8, type: 'ShaderMaterial' };
    const program = programHarness({ linked: true });
    attachProgram(engine, material, program);

    const result = await engine._waitForMaterialsReady(new Set([material]), { timeoutMs: 100 });

    expect(result).toMatchObject({ ready: true, failed: false, pendingCount: 0 });
    expect(program.wrapper.getUniforms).toHaveBeenCalledTimes(1);
    expect(program.wrapper.getAttributes).toHaveBeenCalledTimes(1);
    expect(program.gl.getProgramParameter).toHaveBeenCalledWith(program.raw, program.gl.LINK_STATUS);
    expect(program.gl.validateProgram).not.toHaveBeenCalled();
  });

  it('observes a current program that appears after an empty compile capture', async () => {
    const engine = engineHarness();
    const material = { id: 20, type: 'ShaderMaterial' };
    const program = programHarness({ linked: true });
    let propertyPoll = 0;
    engine._disposed = false;
    engine._contextLost = false;
    engine.renderer = {
      properties: {
        get: () => ({
          currentProgram: propertyPoll++ === 0 ? undefined : program.wrapper,
        }),
      },
      getContext: () => program.gl,
    };

    const result = await engine._waitForMaterialsReady(new Set([material]), {
      timeoutMs: 100,
      programsByMaterial: new Map([[material, []]]),
    });

    expect(result).toMatchObject({ ready: true, pendingCount: 0 });
    expect(propertyPoll).toBeGreaterThan(1);
  });

  it('rejects a linked program when Three lazy first-use preparation throws', async () => {
    const engine = engineHarness();
    const material = { id: 9, type: 'ShaderMaterial' };
    const program = programHarness({ linked: true, prepareError: new Error('uniform reflection failed') });
    attachProgram(engine, material, program);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await engine._waitForMaterialsReady(new Set([material]), { timeoutMs: 100 });

    expect(result).toMatchObject({
      ready: false,
      failed: true,
      code: 'SHADER_PROGRAM_PREPARE_FAILED',
    });
    expect(result.failures[0].cause).toBe('uniform reflection failed');
    errorLog.mockRestore();
  });

  it('fails closed when a completed wrapper has lost its raw WebGL program', async () => {
    const engine = engineHarness();
    const material = { id: 17, type: 'ShaderMaterial' };
    const program = programHarness({ linked: true });
    program.wrapper.program = undefined;
    attachProgram(engine, material, program);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await engine._waitForMaterialsReady(new Set([material]), { timeoutMs: 100 });

    expect(result).toMatchObject({
      ready: false,
      failed: true,
      code: 'SHADER_PROGRAM_MISSING',
    });
    errorLog.mockRestore();
  });

  it('attributes a shared failed program to the material currently being checked', () => {
    const engine = engineHarness();
    const first = { id: 18, type: 'ShaderMaterial', userData: { renderRole: 'terrain:first' } };
    const second = { id: 19, type: 'ShaderMaterial', userData: { renderRole: 'terrain:second' } };
    const program = programHarness({ linked: false });
    attachProgram(engine, first, program);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const firstHealth = engine._inspectCompiledProgram(first, program.wrapper, engine.renderer, program.gl);
    const secondHealth = engine._inspectCompiledProgram(second, program.wrapper, engine.renderer, program.gl);

    expect(firstHealth.failure).toMatchObject({ role: 'terrain:first', id: 18 });
    expect(secondHealth.failure).toMatchObject({ role: 'terrain:second', id: 19 });
    errorLog.mockRestore();
  });

  it('checks every exact program variant captured for the compile pass', async () => {
    const engine = engineHarness();
    const material = { id: 10, type: 'ShaderMaterial' };
    const valid = programHarness({ linked: true });
    const invalid = programHarness({ linked: false });
    invalid.wrapper.id = 8;
    invalid.gl = valid.gl;
    valid.gl.getProgramParameter.mockImplementation((raw, parameter) => (
      parameter === valid.gl.LINK_STATUS && raw === valid.raw ? true
        : parameter === valid.gl.LINK_STATUS && raw === invalid.raw ? false
          : null
    ));
    valid.gl.getProgramInfoLog.mockImplementation((raw) => (
      raw === invalid.raw ? 'double-sided back pass failed' : ''
    ));
    attachProgram(engine, material, valid, [valid.wrapper, invalid.wrapper]);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await engine._waitForMaterialsReady(new Set([material]), {
      timeoutMs: 100,
      programsByMaterial: new Map([[material, [valid.wrapper, invalid.wrapper]]]),
    });

    expect(result).toMatchObject({ ready: false, failed: true, code: 'SHADER_LINK_FAILED' });
    expect(result.failures[0]).toMatchObject({ programId: 8, programLog: 'double-sided back pass failed' });
    errorLog.mockRestore();
  });

  it('does not let an obsolete failed variant poison a corrected compile', async () => {
    const engine = engineHarness();
    const material = { id: 14, type: 'ShaderMaterial' };
    const current = programHarness({ linked: true });
    const obsolete = programHarness({ linked: false });
    obsolete.wrapper.id = 6;
    obsolete.gl = current.gl;
    const properties = {
      programs: new Map([
        ['old', obsolete.wrapper],
        ['current', current.wrapper],
      ]),
      currentProgram: current.wrapper,
    };
    engine._disposed = false;
    engine._contextLost = false;
    engine.renderer = {
      properties: { get: () => properties },
      getContext: () => current.gl,
    };
    const before = new Map([[material, new Set([obsolete.wrapper])]]);
    const exact = engine._captureCompiledPrograms([material], before, engine.renderer.properties);

    expect(exact.get(material)).toEqual([current.wrapper]);
    await expect(engine._waitForMaterialsReady(new Set([material]), {
      timeoutMs: 100,
      programsByMaterial: exact,
    })).resolves.toMatchObject({ ready: true, failed: false });
    const linkQueries = current.gl.getProgramParameter.mock.calls
      .filter(([, parameter]) => parameter === current.gl.LINK_STATUS);
    expect(linkQueries).toHaveLength(1);
    expect(linkQueries[0][0]).toBe(current.raw);
  });

  it('reports context loss without querying a dead shader program', async () => {
    const engine = engineHarness();
    const material = { id: 11, type: 'ShaderMaterial' };
    const program = programHarness({ linked: true, contextLost: true });
    attachProgram(engine, material, program);

    const result = await engine._waitForMaterialsReady(new Set([material]), { timeoutMs: 100 });

    expect(result).toMatchObject({ ready: false, aborted: true, contextLost: true });
    expect(program.gl.getProgramParameter).not.toHaveBeenCalled();
    expect(program.gl.getProgramInfoLog).not.toHaveBeenCalled();
  });

  it('classifies context loss during the completion query as an abort', async () => {
    const engine = engineHarness();
    const material = { id: 15, type: 'ShaderMaterial' };
    const program = programHarness({ linked: true });
    let lost = false;
    program.gl.isContextLost.mockImplementation(() => lost);
    program.wrapper.isReady.mockImplementation(() => {
      lost = true;
      throw new Error('context dropped');
    });
    attachProgram(engine, material, program);

    const result = await engine._waitForMaterialsReady(new Set([material]), { timeoutMs: 100 });

    expect(result).toMatchObject({ ready: false, aborted: true, contextLost: true });
    expect(program.gl.getProgramParameter).not.toHaveBeenCalled();
  });

  it('counts active sampler arrays before Three deletes shader handles', async () => {
    const engine = engineHarness();
    const material = { id: 16, type: 'ShaderMaterial' };
    const program = programHarness({ linked: true });
    program.gl.ACTIVE_UNIFORMS = 0x8B86;
    program.gl.SAMPLER_2D = 0x8B5E;
    program.gl.FLOAT = 0x1406;
    program.gl.getProgramParameter.mockImplementation((raw, parameter) => (
      raw === program.raw && parameter === program.gl.LINK_STATUS ? true
        : raw === program.raw && parameter === program.gl.ACTIVE_UNIFORMS ? 2
          : null
    ));
    program.gl.getActiveUniform = vi.fn((raw, index) => (index === 0
      ? { name: 'uTextures[0]', type: program.gl.SAMPLER_2D, size: 3 }
      : { name: 'uTime', type: program.gl.FLOAT, size: 1 }));
    attachProgram(engine, material, program);

    const result = await engine._waitForMaterialsReady(new Set([material]), { timeoutMs: 100 });

    expect(result.readyTimeline[0]).toMatchObject({ activeSamplers: 3 });
    expect(result.readyTimeline[0].programs[0].activeSamplers).toMatchObject({ count: 3 });
  });

  it('keeps a failed final shader out of the presentation stage', async () => {
    const engine = engineHarness();
    const material = { id: 12, type: 'ShaderMaterial', userData: { renderRole: 'water:studio:legacy' } };
    const present = vi.fn();
    const pipeline = new FinalFrameBootPipeline({
      hooks: {
        compile: (context) => engine._compileFinalBootGraph(Object.assign(context, {
          compileTarget: { renderTarget: null },
          compileMaterials: [material],
          compilePromise: Promise.resolve({
            ready: false,
            failed: true,
            code: 'SHADER_LINK_FAILED',
            failures: [{ code: 'SHADER_LINK_FAILED', role: 'water:studio:legacy' }],
          }),
          waterRequired: false,
        })),
        present,
      },
    });

    await expect(pipeline.start()).rejects.toMatchObject({ code: 'SHADER_LINK_FAILED' });
    expect(pipeline.state).toBe('failed');
    expect(present).not.toHaveBeenCalled();
  });

  it('stops after a failed no-KHR canvas pass instead of compiling underwater', async () => {
    const engine = engineHarness();
    const material = new THREE.ShaderMaterial();
    const program = programHarness({ linked: false });
    let target = null;
    const ensureTarget = vi.fn();
    Object.assign(engine, {
      _warmGeo: new THREE.PlaneGeometry(1, 1),
      _contextLost: false,
      underwater: { _ensureTarget: ensureTarget, _rt: {} },
      renderer: {
        properties: {
          get: () => ({ currentProgram: program.wrapper }),
        },
        getContext: () => ({
          ...program.gl,
          getExtension: vi.fn(() => null),
        }),
        getRenderTarget: vi.fn(() => target),
        setRenderTarget: vi.fn((next) => { target = next; }),
        compile: vi.fn(() => new Set([material])),
      },
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await engine._compileMaterialVariants([material], { canvasOnly: false });

    expect(result).toMatchObject({ ready: false, failed: true, code: 'SHADER_LINK_FAILED' });
    expect(engine.renderer.compile).toHaveBeenCalledTimes(1);
    expect(ensureTarget).not.toHaveBeenCalled();
    errorLog.mockRestore();
    material.dispose();
    engine._warmGeo.dispose();
  });

  it('accepts a healthy linked program when parallel shader compilation is unavailable', async () => {
    const engine = engineHarness();
    const material = new THREE.ShaderMaterial();
    const program = programHarness({ linked: true });
    let target = null;
    Object.assign(engine, {
      _warmGeo: new THREE.PlaneGeometry(1, 1),
      _contextLost: false,
      renderer: {
        properties: {
          get: () => ({ currentProgram: program.wrapper }),
        },
        getContext: () => ({
          ...program.gl,
          getExtension: vi.fn(() => null),
        }),
        getRenderTarget: vi.fn(() => target),
        setRenderTarget: vi.fn((next) => { target = next; }),
        compile: vi.fn(() => new Set([material])),
      },
    });

    const result = await engine._compileMaterialVariants([material], { canvasOnly: true });

    expect(result).toMatchObject({ ready: true, failed: false, pendingCount: 0 });
    expect(engine.renderer.compile).toHaveBeenCalledTimes(1);
    expect(program.gl.getProgramParameter).toHaveBeenCalledWith(program.raw, program.gl.LINK_STATUS);
    material.dispose();
    engine._warmGeo.dispose();
  });
});
