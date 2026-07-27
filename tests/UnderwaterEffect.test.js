import { describe, expect, it } from 'vitest';
import { UnderwaterEffect } from '../src/engine/render/UnderwaterEffect.js';

describe('UnderwaterEffect color balance', () => {
  it('reduces full-screen blue saturation while retaining palette identity', () => {
    const effect = new UnderwaterEffect();
    const shader = effect._material.fragmentShader;

    expect(shader).toContain('float waterLuma = dot(waterCol');
    expect(shader).toContain('high ? 0.52 : 0.66');
    expect(shader).toContain('waterCol.b *= high ? 0.78 : 0.86');
    expect(shader).toContain('vec3 absorb = vec3(0.32, 0.17, 0.10)');
    expect(shader).not.toContain('waterCol * 2.2');
    effect.dispose();
  });
});
