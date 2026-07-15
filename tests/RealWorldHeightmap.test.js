import { describe, expect, it } from 'vitest';
import {
  formatCoordinateDisplay,
  parseCoordinateInput,
} from '../src/engine/terrain/RealWorldHeightmap.js';

describe('parseCoordinateInput', () => {
  it('parses decimal degrees with N/E hemispheres', () => {
    expect(parseCoordinateInput('46.07621°N, 6.96224°E')).toEqual({ lat: 46.07621, lon: 6.96224 });
  });

  it('parses decimal degrees with N/W hemispheres', () => {
    expect(parseCoordinateInput('37.21160°N, 112.98409°W')).toEqual({ lat: 37.21160, lon: -112.98409 });
  });

  it('parses signed decimal degrees without hemispheres', () => {
    expect(parseCoordinateInput('46.07621, 6.96224')).toEqual({ lat: 46.07621, lon: 6.96224 });
    expect(parseCoordinateInput('-33.8688, 151.2093')).toEqual({ lat: -33.8688, lon: 151.2093 });
  });

  it('accepts hemisphere letters without the degree symbol', () => {
    expect(parseCoordinateInput('46.07621N, 6.96224E')).toEqual({ lat: 46.07621, lon: 6.96224 });
    expect(parseCoordinateInput('37.21160 N, 112.98409 W')).toEqual({ lat: 37.21160, lon: -112.98409 });
  });

  it('rejects invalid or out-of-range values', () => {
    expect(parseCoordinateInput('')).toBeNull();
    expect(parseCoordinateInput('not coordinates')).toBeNull();
    expect(parseCoordinateInput('46N')).toBeNull();
    expect(parseCoordinateInput('91N, 0E')).toBeNull();
    expect(parseCoordinateInput('0N, 181E')).toBeNull();
    expect(parseCoordinateInput('46N, 6N')).toBeNull();
  });
});

describe('formatCoordinateDisplay', () => {
  it('formats positive and negative hemispheres', () => {
    expect(formatCoordinateDisplay({ lat: 46.07621, lon: 6.96224 })).toBe('46.07621°N, 6.96224°E');
    expect(formatCoordinateDisplay({ lat: 37.21160, lon: -112.98409 })).toBe('37.21160°N, 112.98409°W');
  });
});
