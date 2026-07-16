import { describe, expect, it } from 'vitest';
import {
  normalizeDrawerLayout,
  normalizeToolsRailLayout,
  resolveNearestEdge,
  TOOLS_RAIL_EDGES,
  DRAWER_EDGES,
} from '../src/components/ui/toolsRailLayout.js';

describe('toolsRailLayout', () => {
  it('normalizes edges and migrates legacy side payloads', () => {
    expect(normalizeToolsRailLayout(null)).toEqual({ edge: 'left' });
    expect(normalizeToolsRailLayout({ edge: 'bottom' })).toEqual({ edge: 'bottom' });
    expect(normalizeToolsRailLayout({ side: 'right', mode: 'float' })).toEqual({ edge: 'right' });
  });

  it('snaps tools rail to the nearest of four edges', () => {
    const shell = { left: 0, top: 0, width: 1000, height: 800 };
    expect(resolveNearestEdge(20, 400, shell, TOOLS_RAIL_EDGES)).toBe('left');
    expect(resolveNearestEdge(980, 400, shell, TOOLS_RAIL_EDGES)).toBe('right');
    expect(resolveNearestEdge(500, 10, shell, TOOLS_RAIL_EDGES)).toBe('top');
    expect(resolveNearestEdge(500, 790, shell, TOOLS_RAIL_EDGES)).toBe('bottom');
  });

  it('snaps drawer to left or right only', () => {
    const shell = { left: 0, top: 0, width: 1000, height: 800 };
    expect(normalizeDrawerLayout({ side: 'left' })).toEqual({ side: 'left' });
    expect(normalizeDrawerLayout({})).toEqual({ side: 'right' });
    expect(resolveNearestEdge(10, 10, shell, DRAWER_EDGES)).toBe('left');
    expect(resolveNearestEdge(900, 10, shell, DRAWER_EDGES)).toBe('right');
  });
});
