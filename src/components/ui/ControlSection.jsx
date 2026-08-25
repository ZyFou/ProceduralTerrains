import React, { useContext, useEffect, useState } from 'react';
import {
  Bookmark, Boxes, Bug, ChartNoAxesCombined, ChevronDown, CircleDot, Clock3,
  CloudSun, Droplets, Eye, FileOutput, Fish, Gauge, Globe2, Grid2X2, Image,
  Map, Orbit, Paintbrush, Palette, Scan, Shell, SlidersHorizontal,
  Sparkles, Sun, Waves, Wind, Wrench,
} from 'lucide-react';
import { FlatPanelContext } from '../panels/PanelContext.js';

const OPEN_SECTIONS_STORAGE_KEY = 'terrain-studio.control-section-open.v1';

// Sections that do not provide their own icon are resolved here so that the
// editor still communicates the type of setting at a glance. The keys are
// stable setting IDs, which keeps similarly named sections distinct.
const SECTION_ICONS = {
  'clouds.section.shape': CircleDot,
  'clouds.section.shell': Shell,
  'clouds.section.noise': Waves,
  'clouds.section.motion': Wind,
  'clouds.section.lighting': Sun,
  'clouds.section.performance': Gauge,
  'lighting.section.sun': Sun,
  'lighting.section.clouds': CloudSun,
  'lighting.section.atmosphere': Orbit,
  'lighting.section.waterLighting': Droplets,
  'water.section.mode': SlidersHorizontal,
  'water.section.shader': Scan,
  'water.section.material': Paintbrush,
  'water.section.waterColors': Palette,
  'water.section.depth': Gauge,
  'water.section.waves': Waves,
  'water.section.foam': Sparkles,
  'water.section.underwater': Fish,
  'water.section.caustics': Sun,
  'water.section.highExtras': Sparkles,
  'water.section.planet': Globe2,
  'water.section.performance': Gauge,
  'water.section.debug': Bug,
  'water.section.export': FileOutput,
  'planet.section.preset': Bookmark,
  'planet.section.palette': Palette,
  'erosion.section.advanced': Wrench,
  'props.section.distribution': ChartNoAxesCombined,
  'props.section.look': Eye,
  'props.section.performance': Gauge,
  'skybox.section.time': Clock3,
  'skybox.section.appearance': Sparkles,
  'export.section.productionPreset': Bookmark,
  'export.section.tileAssembly': Grid2X2,
  'export.section.format': FileOutput,
  'export.section.textures': Image,
  'export.section.assets': Boxes,
  'export.section.waterMaps': Map,
  'world.section.tiles': Grid2X2,
  'world.section.tilesAssembly': Boxes,
  'visuals-post': Eye,
  'visuals-sky': CloudSun,
  'visuals-terrain': Map,
  'visuals-shoreline': Waves,
  'visuals-pixelated': Grid2X2,
  'visuals-dithering': Sparkles,
  'visuals-crt': Scan,
  'visuals-chromatic': Palette,
};

const TITLE_ICONS = {
  shape: CircleDot,
  shell: Shell,
  noise: Waves,
  motion: Wind,
  lighting: Sun,
  performance: Gauge,
  preset: Bookmark,
  palette: Palette,
  advanced: Wrench,
  distribution: ChartNoAxesCombined,
  look: Eye,
  'time of day': Clock3,
  appearance: Sparkles,
  material: Paintbrush,
  depth: Gauge,
  waves: Waves,
  shoreline: Sparkles,
  underwater: Fish,
  caustics: Sun,
  debug: Bug,
  export: FileOutput,
  tiles: Grid2X2,
  assembly: Boxes,
};

function getDefaultSectionIcon(sectionKey, title) {
  const Icon = SECTION_ICONS[sectionKey] ?? TITLE_ICONS[String(title).toLowerCase()] ?? SlidersHorizontal;
  return <Icon size={15} strokeWidth={1.75} aria-hidden />;
}

function getStoredOpenState(sectionKey, fallback) {
  if (!sectionKey || typeof window === 'undefined') return fallback;
  try {
    const saved = JSON.parse(window.localStorage.getItem(OPEN_SECTIONS_STORAGE_KEY) || '{}');
    return typeof saved[sectionKey] === 'boolean' ? saved[sectionKey] : fallback;
  } catch {
    return fallback;
  }
}

function saveOpenState(sectionKey, open) {
  if (!sectionKey || typeof window === 'undefined') return;
  try {
    const saved = JSON.parse(window.localStorage.getItem(OPEN_SECTIONS_STORAGE_KEY) || '{}');
    window.localStorage.setItem(OPEN_SECTIONS_STORAGE_KEY, JSON.stringify({ ...saved, [sectionKey]: open }));
  } catch {
    // UI preferences are best effort only.
  }
}

export default function ControlSection({
  id,
  title,
  icon,
  defaultOpen = true,
  forceOpen = false,
  settingId,
  nested = false,
  children,
  onToggle,
  enabled,
  onEnabledChange,
}) {
  const flat = useContext(FlatPanelContext);
  const sectionKey = settingId ?? id ?? title;
  const [open, setOpen] = useState(() => getStoredOpenState(sectionKey, defaultOpen));
  const sectionIcon = icon ?? getDefaultSectionIcon(sectionKey, title);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    saveOpenState(sectionKey, next);
    onToggle?.(next);
  };

  const handleEnabledChange = (nextEnabled) => {
    if (nextEnabled && !open) {
      setOpen(true);
      saveOpenState(sectionKey, true);
    }
    onEnabledChange?.(nextEnabled);
  };

  if (flat) {
    const sectionKey = settingId ?? id;
    return (
      <section
        className={`panel-group collapsible-group${open ? ' open' : ''}${nested ? ' nested' : ''}`}
        id={id}
        data-section={id}
        data-setting-id={sectionKey}
      >
        <div className="panel-group-header panel-group-toggle">
          <button type="button" className="panel-group-header-button" onClick={toggle} aria-expanded={open}>
            <span className="panel-group-icon">{sectionIcon}</span>
            <span className="panel-group-title">{title}</span>
            <span className={`panel-group-chevron${open ? ' open' : ''}`} aria-hidden><ChevronDown size={14} strokeWidth={2} /></span>
          </button>
          {onEnabledChange && <button type="button" className={`toggle section-enable-toggle${enabled ? ' on' : ''}`} onClick={() => handleEnabledChange(!enabled)} aria-label={`${enabled ? 'Disable' : 'Enable'} ${title}`} aria-pressed={!!enabled} />}
        </div>
        {open && <div className="panel-group-body">{children}</div>}
      </section>
    );
  }

  return (
    <section className="control-section" id={id} data-section={id} data-setting-id={settingId ?? id}>
      <div className="control-section-header">
        <button type="button" className="control-section-header-button" onClick={toggle} aria-expanded={open}>
          <span className="control-section-left">
            <span className="control-section-icon">{sectionIcon}</span>
            <span className="control-section-title">{title}</span>
          </span>
          <span className={`control-section-chevron${open ? ' open' : ''}`} aria-hidden><ChevronDown size={14} strokeWidth={2} /></span>
        </button>
        {onEnabledChange && <button type="button" className={`toggle section-enable-toggle${enabled ? ' on' : ''}`} onClick={() => handleEnabledChange(!enabled)} aria-label={`${enabled ? 'Disable' : 'Enable'} ${title}`} aria-pressed={!!enabled} />}
      </div>
      <div className={`control-section-body${open ? '' : ' collapsed'}`}>{children}</div>
    </section>
  );
}
