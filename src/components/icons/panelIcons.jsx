import {
  Activity,
  Bug,
  Cloud,
  Download,
  Droplets,
  Globe,
  Layers,
  LayoutGrid,
  Mountain,
  Palette,
  Sprout,
  Sun,
  SunMedium,
} from 'lucide-react';

const SIZE = 19;
const STROKE = 1.75;

function panelIcon(Icon) {
  return <Icon size={SIZE} strokeWidth={STROKE} aria-hidden />;
}

export const PANEL_ICONS = {
  terrain: panelIcon(Mountain),
  noiseLayers: panelIcon(Layers),
  world: panelIcon(LayoutGrid),
  planet: panelIcon(Globe),
  biomes: panelIcon(Palette),
  water: panelIcon(Droplets),
  props: panelIcon(Sprout),
  clouds: panelIcon(Cloud),
  skybox: panelIcon(Sun),
  lighting: panelIcon(SunMedium),
  export: panelIcon(Download),
  performance: panelIcon(Activity),
  debug: panelIcon(Bug),
};
