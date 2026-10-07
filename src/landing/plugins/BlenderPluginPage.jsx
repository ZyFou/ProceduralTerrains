import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import {
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  ExternalLink,
  FileArchive,
  FileJson,
  FolderOpen,
  Grid3X3,
  Image,
  Layers3,
  MonitorDown,
  Mountain,
  PackageCheck,
  PackagePlus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Workflow,
  Zap,
} from 'lucide-react';
import { PLUGINS } from '../../config/plugins.js';

const BLENDER_PLUGIN = PLUGINS.blender;
const BLENDER_PACKAGE_VERSION = BLENDER_PLUGIN.currentVersion;
const BLENDER_VERSION = '5.2';

const quickSteps = [
  {
    icon: Download,
    label: '01',
    title: 'Install the extension',
    body: 'Install the downloaded ZIP directly from Blender Preferences.',
    target: 'blender-install',
  },
  {
    icon: Sparkles,
    label: '02',
    title: 'Create in Blender',
    body: 'Choose a seeded preset or edit the advanced Noise Stack in the Terrain sidebar.',
    target: 'blender-create',
  },
  {
    icon: Mountain,
    label: '03',
    title: 'Import existing worlds',
    body: 'Import a Blender Scene ZIP and create tiled meshes with baked materials.',
    target: 'blender-import',
  },
];

const generatedAssets = [
  ['Collection per project', Layers3],
  ['Mesh object per tile', Mountain],
  ['Editable vertex grids', Grid3X3],
  ['Baked Principled materials', Sparkles],
  ['Packed texture images', Image],
  ['Project custom properties', Settings2],
];

function StepList({ steps }) {
  useLanguage();
  return (
    <ol className="unity-numbered-steps">
      {steps.map((step, index) => (
        <li key={step.title}>
          <span>{translateText(index + 1)}</span>
          <div>
            <strong>{translateText(step.title)}</strong>
            <p>{translateText(step.body)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function BlenderPluginPage({ onOpenEditor, onDownload }) {
  useLanguage();
  const scrollToSection = (sectionId) => {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <article className="unity-page blender-page">
      <section className="unity-hero" aria-labelledby="blender-plugin-title">
        <div className="unity-hero-copy">
          <div className="unity-eyebrow"><Boxes size={14} aria-hidden />{translateText(" Blender integration")}</div>
          <h1 id="blender-plugin-title">{translateText("Your terrains, ")}<em>{translateText("native in Blender.")}</em></h1>
          <p>{translateText("Generate editor-compatible terrain directly in Blender, or turn exports into editable meshes with aligned tiles, UVs, packed textures, and metadata.")}</p>
          <div className="unity-hero-actions">
            <button type="button" className="lp-primary" onClick={() => onDownload(BLENDER_PLUGIN)}>
              <Download size={16} aria-hidden />{translateText(" Download plugin")}</button>
            <button type="button" className="lp-secondary" onClick={() => scrollToSection('blender-install')}>
              <MonitorDown size={16} aria-hidden />{translateText(" Installation guide")}</button>
          </div>
          <div className="unity-download-meta">
            <span><PackageCheck size={13} aria-hidden />{translateText(" v")}{translateText(BLENDER_PACKAGE_VERSION)}</span>
            <span><ShieldCheck size={13} aria-hidden />{translateText(" GPL-3.0-or-later")}</span>
            <span><RefreshCw size={13} aria-hidden />{translateText(" Alpha release")}</span>
          </div>
        </div>

        <div className="unity-hero-panel" aria-label={translateText("Blender terrain creation preview")}>
          <div className="unity-window-bar">
            <span className="unity-window-icon"><Boxes size={16} aria-hidden /></span>
            <div><strong>{translateText("Procedural Terrains")}</strong><small>{translateText("3D View · Terrain")}</small></div>
            <span className="unity-alpha-badge">{translateText("BLENDER 5.2")}</span>
          </div>
          <div className="unity-window-body blender-window-body">
            <div className="blender-field-preview">
              <span>{translateText("Terrain preset")}</span>
              <strong>{translateText("Highlands · Seed 1337")}</strong>
              <ChevronRight size={14} aria-hidden />
            </div>
            <div className="blender-field-preview">
              <span>{translateText("Dimensions")}</span>
              <strong>{translateText("1000 × 1000 × 560 m")}</strong>
              <Grid3X3 size={14} aria-hidden />
            </div>
            <div className="blender-option-preview">
              <span><Check size={11} />{translateText(" 513 × 513 resolution")}</span>
              <span><Check size={11} />{translateText(" Smooth shading")}</span>
              <span><Check size={11} />{translateText(" Procedural surfaces")}</span>
            </div>
            <div className="unity-preview-checks">
              <span><CheckCircle2 size={13} />{translateText(" Deterministic Noise Stack")}</span>
              <span><CheckCircle2 size={13} />{translateText(" Seamless tiled coordinates")}</span>
            </div>
            <div className="unity-preview-button"><Zap size={14} aria-hidden />{translateText(" Generate Terrain")}</div>
          </div>
        </div>
      </section>

      <div className="unity-compatibility" aria-label={translateText("Plugin compatibility")}>
        <span><strong>{translateText("Blender ")}{translateText(BLENDER_VERSION)}+</strong><small>{translateText("Manifest-based extension")}</small></span>
        <span><strong>{translateText("Eevee · Cycles")}</strong><small>{translateText("Principled baked materials")}</small></span>
        <span><strong>{translateText("Create + Import")}</strong><small>{translateText("Noise Stack and validated packages")}</small></span>
      </div>

      <section className="unity-section unity-quickstart" aria-labelledby="blender-quickstart-title">
        <div className="unity-section-heading">
          <span>{translateText("Quick start")}</span>
          <h2 id="blender-quickstart-title">{translateText("Create terrain or continue an exported world")}</h2>
          <p>{translateText("Native generation and package import both produce editable Blender geometry.")}</p>
        </div>
        <div className="unity-step-grid">
          {quickSteps.map(({ icon: Icon, ...step }) => (
            <button type="button" onClick={() => scrollToSection(step.target)} className="unity-step-card" key={step.label}>
              <div className="unity-step-top"><span>{translateText(step.label)}</span><Icon size={20} aria-hidden /></div>
              <h3>{translateText(step.title)}</h3>
              <p>{translateText(step.body)}</p>
              <span className="unity-step-link">{translateText("Read the guide ")}<ArrowRight size={13} aria-hidden /></span>
            </button>
          ))}
        </div>
      </section>

      <section className="unity-section unity-doc-section" id="blender-install" aria-labelledby="blender-install-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">01</span>
          <div className="unity-doc-heading">
            <PackagePlus size={24} aria-hidden />
            <div>
              <h2 id="blender-install-title">{translateText("Install the plugin")}</h2>
              <p>{translateText("The download is a ready-to-install Blender extension. Keep the ZIP intact.")}</p>
            </div>
          </div>
        </div>
        <div className="unity-doc-content">
          <div className="unity-method-card recommended">
            <div className="unity-method-heading">
              <span><Download size={18} aria-hidden /></span>
              <div><strong>{translateText("Install from Disk")}</strong><small>{translateText("Blender 5.2")}</small></div>
            </div>
            <StepList steps={[
              { title: 'Download the extension ZIP', body: `Do not extract procedural-terrains-blender-${BLENDER_PACKAGE_VERSION}.zip.` },
              { title: 'Open Blender Preferences', body: 'Go to Edit > Preferences > Get Extensions.' },
              { title: 'Choose Install from Disk', body: 'Open the extensions menu, select Install from Disk, then choose the downloaded ZIP.' },
              { title: 'Enable Procedural Terrains', body: 'If needed, enable the extension. Its tools appear in File > Import and the 3D View Terrain sidebar.' },
            ]} />
            <button type="button" className="lp-primary unity-inline-download" onClick={() => onDownload(BLENDER_PLUGIN)}>
              <Download size={15} aria-hidden />{translateText(" Download v")}{translateText(BLENDER_PACKAGE_VERSION)}
            </button>
          </div>
          <div className="unity-note">
            <CircleAlert size={17} aria-hidden />
            <p><strong>{translateText("Version requirement.")}</strong>{translateText(" This build targets Blender ")}{translateText(BLENDER_VERSION)}{translateText(" and uses the current extension manifest format. Earlier Blender releases are not supported by this package.")}</p>
          </div>
        </div>
      </section>

      <section className="unity-section unity-doc-section" id="blender-create" aria-labelledby="blender-create-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">02</span>
          <div className="unity-doc-heading">
            <Sparkles size={24} aria-hidden />
            <div>
              <h2 id="blender-create-title">{translateText("Create native terrain")}</h2>
              <p>{translateText("Build an editable tiled mesh directly from a deterministic recipe.")}</p>
            </div>
          </div>
        </div>
        <div className="unity-doc-content">
          <div className="unity-method-card recommended">
            <div className="unity-method-heading">
              <span><Mountain size={18} aria-hidden /></span>
              <div><strong>{translateText("Create a new terrain")}</strong><small>{translateText("Blender-native workflow")}</small></div>
            </div>
            <StepList steps={[
              { title: 'Open the Terrain sidebar', body: 'In the 3D View, press N to open the Sidebar, choose Terrain, then select the Create workflow.' },
              { title: 'Choose the quick setup', body: 'Select one of the eight Terrain presets, click Apply, and set the deterministic seed, width, depth, maximum height, tile grid, and mesh resolution.' },
              { title: 'Set placement and shading', body: 'Center the assembly at World Origin or the 3D Cursor, then choose smooth shading and the editable procedural sand, grass, rock and snow material.' },
              { title: 'Customize the Noise Stack', body: 'Open Advanced Noise Stack to apply a stack preset or add, duplicate, reorder, and remove layers. Each layer exposes its blend, parameters, seed offset, and height, noise, slope, or biome masks.' },
              { title: 'Check density', body: 'Review Estimated vertices. Blender warns above one million vertices and blocks recipes above sixteen million.' },
              { title: 'Generate Terrain', body: 'The extension creates a collection of ordinary mesh tiles with UVs, smooth shading, procedural surface nodes, placeholder water, tile metadata, and the complete saved recipe.' },
            ]} />
          </div>
          <div className="unity-method-card">
            <div className="unity-method-heading">
              <span><RefreshCw size={18} aria-hidden /></span>
              <div><strong>{translateText("Edit and regenerate")}</strong><small>{translateText("Preserve the collection")}</small></div>
            </div>
            <StepList steps={[
              { title: 'Select a generated tile', body: 'Choose any tile inside a collection created by the extension.' },
              { title: 'Load Selected', body: 'Click Load Selected to restore the collection recipe into the Create controls.' },
              { title: 'Adjust the recipe', body: 'Change presets, seed, dimensions, resolution, layers, masks, placement, fine detail, thermal erosion, surface settings, or water.' },
              { title: 'Regenerate Selected', body: 'The extension replaces generated tile geometry while keeping the collection and any unrelated objects inside it.' },
            ]} />
          </div>
          <div className="unity-note success">
            <CheckCircle2 size={17} aria-hidden />
            <p><strong>{translateText("Unity parity.")}</strong>{translateText(" Blender and Unity use the same seeded CPU Noise Stack formulas and presets. Generated tile borders share global sample coordinates, so their edge vertices remain identical.")}</p>
          </div>
          <div className="unity-note">
            <CircleAlert size={17} aria-hidden />
            <p><strong>{translateText("Work light, finish dense.")}</strong>{translateText(" Use 129 or 257 while shaping. Regenerate at 513 or 1025 only when the extra mesh density is useful.")}</p>
          </div>
        </div>
      </section>

      <section className="unity-section unity-doc-section" id="blender-export" aria-labelledby="blender-export-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">03</span>
          <div className="unity-doc-heading">
            <UploadCloud size={24} aria-hidden />
            <div>
              <h2 id="blender-export-title">{translateText("Export for Blender")}</h2>
              <p>{translateText("The Blender production preset creates authoritative heightfields and baked surface maps.")}</p>
            </div>
          </div>
        </div>
        <div className="unity-doc-content">
          <StepList steps={[
            { title: 'Finish your terrain in Tile mode', body: 'Runtime document v1 supports studio terrain with square tile assemblies.' },
            { title: 'Open the Export panel', body: 'Select Export in the editor toolbar, then open Production Preset.' },
            { title: 'Choose Blender Scene', body: 'The preset enables vertex-grid RAW heightfields, separate tiles, color and normal maps, and biome splat data.' },
            { title: 'Choose a height grid', body: '1025 × 1025 preserves high source detail; the Blender importer can build a lighter editable mesh from it.' },
            { title: 'Export Terrain', body: 'Save the generated Blender terrain ZIP without changing its internal structure.' },
          ]} />
          <div className="unity-export-layout">
            <div className="unity-folder-tree">
              <div><FolderOpen size={15} /><strong>{translateText("Blender/")}</strong></div>
              <span><FileJson size={14} />{translateText(" project.ptrterrain")}</span>
              <span><FileArchive size={14} />{translateText(" heightmap.raw")}</span>
              <span><Mountain size={14} />{translateText(" tiles/")}</span>
              <span><Layers3 size={14} />{translateText(" textures/")}</span>
              <span><Settings2 size={14} />{translateText(" splatmaps/")}</span>
            </div>
            <div className="unity-export-tip">
              <CheckCircle2 size={18} aria-hidden />
              <div><strong>{translateText("Source detail stays authoritative")}</strong><p>{translateText("The importer can create a 129, 257, 513, 1025, or full-resolution mesh without changing the exported heightfield.")}</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="unity-section unity-doc-section" id="blender-import" aria-labelledby="blender-import-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">04</span>
          <div className="unity-doc-heading">
            <Workflow size={24} aria-hidden />
            <div>
              <h2 id="blender-import-title">{translateText("Import and build")}</h2>
              <p>{translateText("Create a clean collection of native meshes you can sculpt, shade, modify, and render.")}</p>
            </div>
          </div>
        </div>
        <div className="unity-doc-content">
          <StepList steps={[
            { title: 'Open the importer', body: 'Choose File > Import > Procedural Terrains, or open 3D View > Sidebar > Terrain.' },
            { title: 'Select the export ZIP', body: 'The extension validates the archive, runtime document, artifact paths, and heightfield sizes before creating scene data.' },
            { title: 'Choose Mesh detail', body: 'Automatic uses up to 513 × 513 vertices per tile. Full source resolution is available for intentional high-density workflows.' },
            { title: 'Choose dimensions', body: 'Keep Source Dimensions for a faithful handoff, or choose Custom Dimensions and enter a new total width and depth. Vertical Scale controls elevation independently.' },
            { title: 'Choose placement', body: 'Center the complete assembly at World Origin or the 3D Cursor. The source minimum elevation maps to the selected placement height.' },
            { title: 'Choose materials and selection', body: 'Enable baked materials, smooth shading, packed images, and automatic tile selection as needed. ZIP textures are packed before temporary extraction is removed.' },
            { title: 'Import and Build', body: 'Blender creates positioned mesh tiles, UVs, baked materials, packed images, and source metadata in one undoable operation.' },
          ]} />
          <div className="unity-generated-grid">
            {generatedAssets.map(([label, Icon]) => (
              <div key={label}><span><Icon size={16} aria-hidden /></span><strong>{translateText(label)}</strong><Check size={14} aria-hidden /></div>
            ))}
          </div>
          <div className="unity-note success">
            <PackageCheck size={17} aria-hidden />
            <p><strong>{translateText("Ready for Blender tools.")}</strong>{translateText(" The result is ordinary mesh geometry with standard UV and Principled material data—not a locked custom object type.")}</p>
          </div>
        </div>
      </section>

      <section className="unity-section unity-limitations" aria-labelledby="blender-limitations-title">
        <div className="unity-section-heading">
          <span>{translateText("Alpha scope")}</span>
          <h2 id="blender-limitations-title">{translateText("Built for reliable terrain handoff")}</h2>
          <p>{translateText("Native generation and faithful baked reconstruction both remain fully editable.")}</p>
        </div>
        <div className="unity-scope-grid">
          <div>
            <span className="unity-scope-icon available"><CheckCircle2 size={20} aria-hidden /></span>
            <h3>{translateText("Available now")}</h3>
            <ul>
              <li>{translateText("Secure ZIP and .ptrterrain validation")}</li>
              <li>{translateText("Native seeded Noise Stack terrain generation")}</li>
              <li>{translateText("Fine detail and assembly-wide thermal erosion")}</li>
              <li>{translateText("Procedural sand, grass, rock and snow surfaces")}</li>
              <li>{translateText("Live placeholder water in creation and import")}</li>
              <li>{translateText("Custom dimensions and origin/cursor placement")}</li>
              <li>{translateText("Tiled editable mesh reconstruction")}</li>
              <li>{translateText("Aligned UVs and baked normal materials")}</li>
              <li>{translateText("Packed images and source custom properties")}</li>
            </ul>
          </div>
          <div>
            <span className="unity-scope-icon upcoming"><Sparkles size={20} aria-hidden /></span>
            <h3>{translateText("Planned next")}</h3>
            <ul>
              <li>{translateText("Detailed biome shader reconstruction")}</li>
              <li>{translateText("Advanced water shaders and splines")}</li>
              <li>{translateText("Non-destructive reimport workflows")}</li>
              <li>{translateText("Node graph and hydraulic erosion authoring")}</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="unity-section unity-faq" aria-labelledby="blender-faq-title">
        <div className="unity-section-heading">
          <span>{translateText("Help")}</span>
          <h2 id="blender-faq-title">{translateText("Common questions")}</h2>
        </div>
        <div className="unity-faq-list">
          <details>
            <summary>{translateText("Can I sculpt or modify the imported terrain?")}<ChevronRight size={16} aria-hidden /></summary>
            <p>{translateText("Yes. Every tile is a standard Blender mesh, so sculpting, modifiers, Geometry Nodes, material edits, and regular mesh operations remain available.")}</p>
          </details>
          <details>
            <summary>{translateText("Can I create terrain without exporting first?")}<ChevronRight size={16} aria-hidden /></summary>
            <p>{translateText("Yes. The Create workflow includes seeded presets and an advanced editable Noise Stack, tiled dimensions, regeneration, and an editable procedural sand, grass, rock and snow material.")}</p>
          </details>
          <details>
            <summary>{translateText("Why does Automatic use 513 × 513 vertices?")}<ChevronRight size={16} aria-hidden /></summary>
            <p>{translateText("It keeps the mesh responsive while sampling the complete exported height range. You can choose 1025 or Full source resolution when you need denser geometry.")}</p>
          </details>
          <details>
            <summary>{translateText("Are ZIP textures kept after import?")}<ChevronRight size={16} aria-hidden /></summary>
            <p>{translateText("Yes. Texture images loaded from ZIP packages are packed into the current .blend before the temporary extraction folder is removed.")}</p>
          </details>
          <details>
            <summary>{translateText("How are axes converted?")}<ChevronRight size={16} aria-hidden /></summary>
            <p>{translateText("The right-handed mapping is source (X, Y, Z) to Blender (X, -Z, Y). This moves height to Blender Z while units remain meters.")}</p>
          </details>
        </div>
      </section>

      <section className="unity-final-cta">
        <div>
          <span><Boxes size={15} aria-hidden />{translateText(" Blender extension v")}{translateText(BLENDER_PACKAGE_VERSION)}</span>
          <h2>{translateText("Bring your next world into Blender.")}</h2>
          <p>{translateText("Install the extension, create or import a terrain, and continue with native Blender tools.")}</p>
        </div>
        <div>
          <button type="button" className="lp-primary" onClick={() => onDownload(BLENDER_PLUGIN)}><Download size={16} aria-hidden />{translateText(" Download plugin")}</button>
          <button type="button" className="lp-secondary" onClick={onOpenEditor}>{translateText("Open terrain editor ")}<ExternalLink size={15} aria-hidden /></button>
        </div>
      </section>
    </article>
  );
}
