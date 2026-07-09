import {
  Activity,
  Bug,
  Cloud,
  Download,
  Droplets,
  Eye,
  Globe,
  Grid2x2,
  Layers,
  LayoutGrid,
  Mountain,
  Palette,
  Sprout,
  Sun,
  SunMedium,
  History,
  Route,
  ScanLine,
} from 'lucide-react';

const SIZE = 19;
const STROKE = 1.75;

function panelIcon(Icon) {
  return <Icon size={SIZE} strokeWidth={STROKE} aria-hidden />;
}

export const PANEL_ICONS = {
  terrain: panelIcon(Mountain),
  tiles: panelIcon(Grid2x2),
  noiseLayers: panelIcon(Layers),
  world: panelIcon(LayoutGrid),
  planet: panelIcon(Globe),
  biomes: panelIcon(Palette),
  water: panelIcon(Droplets),
  props: panelIcon(Sprout),
  clouds: panelIcon(Cloud),
  skybox: panelIcon(Sun),
  lighting: panelIcon(SunMedium),
  visuals: panelIcon(Eye),
  export: panelIcon(Download),
  performance: panelIcon(Activity),
  debug: panelIcon(Bug),
  splines: panelIcon(Route),
  analysis: panelIcon(ScanLine),
  history: panelIcon(History),
};
