import { Map } from 'lucide-react';
import CollapsibleGroup from './CollapsibleGroup.jsx';
import { ToggleRow, SelectRow } from '../controls.jsx';

const DEBUG_VIEW_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'noise', label: 'Noise Texture' },
  { value: 'height', label: 'Height Map' },
  { value: 'biome', label: 'Biome Map' },
];

const BIOME_LEGEND = [
  ['#d6b35a', 'Desert / sand'],
  ['#b05f32', 'Canyon / dry rock'],
  ['#2f9f67', 'Wetland / grass'],
  ['#8b8f98', 'Mountains / snow'],
];

function BiomeLegend() {
  return (
    <div className="biome-legend">
      {BIOME_LEGEND.map(([color, label]) => (
        <div className="biome-legend-row" key={label}>
          <span className="biome-legend-swatch" style={{ background: color }} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export default function TileMapDebugSection({ tileDebug, onTileDebug }) {
  const dbg = tileDebug ?? { view: 'off', showLegend: true, opacity: 1, showPreview: true };

  return (
    <CollapsibleGroup
      title="Map Overlays"
      icon={<Map size={15} strokeWidth={1.75} />}
      defaultOpen={dbg.view !== 'off'}
    >
      <p className="section-hint">
        Preview internal terrain maps on the Tile surface without changing saved terrain data.
      </p>
      <SelectRow
        label="Debug View"
        value={dbg.view}
        options={DEBUG_VIEW_OPTIONS}
        onChange={(v) => onTileDebug({ view: v })}
        info="Overlays noise, height or biome data directly on the terrain mesh."
      />
      <ToggleRow
        label="Show Legend"
        value={!!dbg.showLegend}
        onChange={(v) => onTileDebug({ showLegend: v })}
      />
      {dbg.view === 'biome' && dbg.showLegend && <BiomeLegend />}
    </CollapsibleGroup>
  );
}
