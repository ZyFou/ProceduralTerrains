import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WorldModeBar from '../src/components/WorldModeBar.jsx';

describe('WorldModeBar terrain readiness gate', () => {
  it('keeps Tile enabled and disables Infinite World and Planet while loading', () => {
    const html = renderToStaticMarkup(
      <WorldModeBar
        worldMode="studio"
        onSetWorldMode={vi.fn()}
        modeLocked={false}
        terrainShaderReady={false}
      />,
    );

    expect(html).toContain('title="Tile"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html.match(/waiting-for-terrain/g)).toHaveLength(2);
  });

  it('fails closed when readiness has not been supplied', () => {
    const html = renderToStaticMarkup(
      <WorldModeBar worldMode="studio" onSetWorldMode={vi.fn()} modeLocked={false} />,
    );

    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it('enables every editor world mode after the final shader is ready', () => {
    const html = renderToStaticMarkup(
      <WorldModeBar
        worldMode="studio"
        onSetWorldMode={vi.fn()}
        modeLocked={false}
        terrainShaderReady
      />,
    );

    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('waiting-for-terrain');
  });
});
