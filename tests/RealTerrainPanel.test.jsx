import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { renderPanel } from '../src/components/panels/index.jsx';
import { normalizeMarkers } from '../src/engine/terrain/RealWorldMarkers.js';

it('keeps height and noise scale available in the Real Terrain tool', () => {
  const html = renderToStaticMarkup(renderPanel('terrain', {
    realTerrainMode: true, worldMode: 'studio', params: { heightScale: 300, noiseScale: 48 }, perf: {},
  }));
  expect(html).toContain('Height Scale');
  expect(html).toContain('terrain.heightScale');
  expect(html).toContain('Noise Scale');
  expect(html).toContain('terrain.noiseScale');
  expect(html).toContain('Select Area on Map');
  expect(html).not.toContain('Close map picker');
});

it('shows the city fetch action before automatic markers are enabled', () => {
  const html = renderToStaticMarkup(renderPanel('markers', { realWorldMarkers: normalizeMarkers() }));
  expect(html).toContain('Fetch city names and show markers');
});
