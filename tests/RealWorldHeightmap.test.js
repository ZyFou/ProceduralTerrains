import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compositeCellImagery,
  compositeCellPatches,
  fetchBboxElevation,
  formatCoordinateDisplay,
  parseCoordinateInput,
} from '../src/engine/terrain/RealWorldHeightmap.js';

afterEach(() => vi.unstubAllGlobals());

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

  it('parses degrees-minutes-seconds with N/E hemispheres', () => {
    const parsed = parseCoordinateInput('43° 20\' 39.239" N 3° 12\' 56.862" E');
    expect(parsed).not.toBeNull();
    expect(parsed.lat).toBeCloseTo(43 + 20 / 60 + 39.239 / 3600, 6);
    expect(parsed.lon).toBeCloseTo(3 + 12 / 60 + 56.862 / 3600, 6);
  });

  it('parses DMS with W hemisphere and fancy quotes', () => {
    const parsed = parseCoordinateInput('37° 12′ 41.76″ N, 112° 59′ 2.724″ W');
    expect(parsed).not.toBeNull();
    expect(parsed.lat).toBeCloseTo(37 + 12 / 60 + 41.76 / 3600, 6);
    expect(parsed.lon).toBeCloseTo(-(112 + 59 / 60 + 2.724 / 3600), 6);
  });

  it('rejects invalid or out-of-range values', () => {
    expect(parseCoordinateInput('')).toBeNull();
    expect(parseCoordinateInput('not coordinates')).toBeNull();
    expect(parseCoordinateInput('46N')).toBeNull();
    expect(parseCoordinateInput('91N, 0E')).toBeNull();
    expect(parseCoordinateInput('0N, 181E')).toBeNull();
    expect(parseCoordinateInput('46N, 6N')).toBeNull();
    expect(parseCoordinateInput('43° 70\' 0" N 3° 0\' 0" E')).toBeNull();
  });
});

describe('formatCoordinateDisplay', () => {
  it('formats positive and negative hemispheres', () => {
    expect(formatCoordinateDisplay({ lat: 46.07621, lon: 6.96224 })).toBe('46.07621°N, 6.96224°E');
    expect(formatCoordinateDisplay({ lat: 37.21160, lon: -112.98409 })).toBe('37.21160°N, 112.98409°W');
  });
});

describe('worker tile decoding', () => {
  it('uses fetch and ImageBitmap when the DOM Image constructor is unavailable', async () => {
    const close = vi.fn();
    const bitmap = { width: 256, height: 256, close };
    const drawImage = vi.fn();
    class FakeOffscreenCanvas {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return {
          drawImage,
          fillRect: vi.fn(),
          getImageData: (_x, _y, width, height) => {
            const data = new Uint8ClampedArray(width * height * 4);
            data[0] = 128;
            data[3] = 255;
            return { data, width, height };
          },
        };
      }
    }
    const blob = new Blob(['tile'], { type: 'image/png' });
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }));
    const createImageBitmapMock = vi.fn(async () => bitmap);
    vi.stubGlobal('Image', undefined);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const result = await fetchBboxElevation({
      minLat: 10,
      maxLat: 10.0001,
      minLon: 10,
      maxLon: 10.0001,
    }, 1);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(createImageBitmapMock).toHaveBeenCalledWith(blob);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(close).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ width: 1, height: 1 });
    expect(result.elev[0]).toBe(0);
  });

  it('creates height and imagery previews without canvas.toDataURL', () => {
    vi.stubGlobal('Image', undefined);
    vi.stubGlobal('document', undefined);
    const tiles = [{ cx: 0, cz: 0 }];
    const height = compositeCellPatches({
      '0,0': { elev: new Float32Array([0, 1, 2, 3]), width: 2, height: 2 },
    }, tiles);
    const imagery = compositeCellImagery({
      '0,0': {
        rgba: new Uint8ClampedArray([
          255, 0, 0, 255, 0, 255, 0, 255,
          0, 0, 255, 255, 255, 255, 255, 255,
        ]),
        width: 2,
        height: 2,
      },
    }, tiles);

    expect(height.preview).toMatch(/^data:image\/png;base64,/);
    expect(imagery.preview).toMatch(/^data:image\/png;base64,/);
    expect(atob(height.preview.split(',')[1]).slice(1, 4)).toBe('PNG');
    expect(atob(imagery.preview.split(',')[1]).slice(1, 4)).toBe('PNG');
  });
});
