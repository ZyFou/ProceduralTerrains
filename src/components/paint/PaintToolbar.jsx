import { Mountain, Waves, Minus, Droplet, Palette, Sprout, Eraser, SlidersHorizontal } from 'lucide-react';

const ICON_SIZE = 19;
const ICON_STROKE = 1.75;

export const PAINT_TOOLS = [
  { id: 'sculpt', label: 'Sculpt', icon: Mountain, title: 'Sculpt', description: 'Raise or lower the terrain height directly.' },
  { id: 'smooth', label: 'Smooth', icon: Waves, title: 'Smooth', description: 'Blend height toward neighboring terrain to soften detail.' },
  { id: 'flatten', label: 'Flatten', icon: Minus, title: 'Flatten', description: 'Blend height toward a fixed target elevation.' },
  { id: 'river', label: 'River', icon: Droplet, title: 'River Carve', description: 'Carve a river bed with soft banks.' },
  { id: 'biome', label: 'Biome', icon: Palette, title: 'Biome', description: 'Paint biome influence onto the terrain.' },
  { id: 'mask', label: 'Mask', icon: Sprout, title: 'Mask', description: 'Paint grass and flower density.' },
  { id: 'erase', label: 'Erase', icon: Eraser, title: 'Erase / Reset', description: 'Erase paint back to the procedural terrain, or start over.' },
  { id: 'brush', label: 'Brush', icon: SlidersHorizontal, title: 'Brush Settings', description: 'Shape, size and application settings shared by every tool.' },
];

// Vertical icon rail for Paint Mode — mirrors the app's main LeftToolbar/
// toolbar-btn visual language, but drives the paint-specific tool tabs
// instead of the global panel registry.
export default function PaintToolbar({ activeTool, onSelect }) {
  return (
    <nav className="paint-toolbar" aria-label="Paint Tools">
      {PAINT_TOOLS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={`toolbar-btn${activeTool === id ? ' active' : ''}`}
          title={label}
          aria-label={label}
          aria-pressed={activeTool === id}
          onClick={() => onSelect(id)}
        >
          <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
          <span className="toolbar-btn-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
import React from 'react';

