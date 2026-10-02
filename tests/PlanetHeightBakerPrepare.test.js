import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PlanetHeightBaker } from '../src/engine/terrain/PlanetHeightBaker.js';

const stack = (sig) => ({ sig, heightSig: sig, body3d: 'return 0.0;' });

function makeBaker() {
  return new PlanetHeightBaker({
    renderer: { coordinateSystem: THREE.WebGLCoordinateSystem },
    uniforms: {},
    size: 32,
    previewSize: 16,
    requirePrepared: true,
  });
}

describe('PlanetHeightBaker program preparation', () => {
  it('lets concurrent requests for the same program both publish', () => {
    const baker = makeBaker();
    const warmup = baker.prepareProgram(8, stack('a'));
    const rebuild = baker.prepareProgram(8, stack('a'));
    expect(rebuild.material).toBe(warmup.material);

    expect(baker.publishPrepared(warmup)).toBe(true);
    baker.discardPrepared(warmup);
    expect(baker.publishPrepared(rebuild)).toBe(true);
    baker.discardPrepared(rebuild);
    expect(baker.material).toBe(warmup.material);
    expect(baker.begin(8, stack('a'))).not.toBe(false);
  });

  it('keeps the shared material alive while another request still holds it', () => {
    const baker = makeBaker();
    const first = baker.prepareProgram(8, stack('a'));
    const second = baker.prepareProgram(8, stack('a'));
    let disposed = 0;
    first.material.addEventListener('dispose', () => { disposed++; });
    baker.discardPrepared(first);
    expect(disposed).toBe(0);
    expect(baker.publishPrepared(second)).toBe(true);
    baker.discardPrepared(second);
    expect(disposed).toBe(0);
  });

  it('still lets a different program supersede a pending one', () => {
    const baker = makeBaker();
    const stale = baker.prepareProgram(8, stack('a'));
    const fresh = baker.prepareProgram(9, stack('a'));
    expect(baker.publishPrepared(stale)).toBe(false);
    expect(baker.publishPrepared(fresh)).toBe(true);
  });

  it('a request matching the published program does not invalidate a sibling', () => {
    const baker = makeBaker();
    const initial = baker.prepareProgram(8, stack('a'));
    baker.publishPrepared(initial);
    baker.discardPrepared(initial);
    const a = baker.prepareProgram(8, stack('a'));
    const b = baker.prepareProgram(8, stack('a'));
    expect(a.current && b.current).toBe(true);
    expect(baker.publishPrepared(a)).toBe(true);
    expect(baker.publishPrepared(b)).toBe(true);
  });
});
