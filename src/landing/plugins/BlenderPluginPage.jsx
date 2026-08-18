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
  return (
    <ol className="unity-numbered-steps">
      {steps.map((step, index) => (
        <li key={step.title}>
          <span>{index + 1}</span>
          <div>
            <strong>{step.title}</strong>
            <p>{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function BlenderPluginPage({ onOpenEditor, onDownload }) {
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
          <div className="unity-eyebrow"><Boxes size={14} aria-hidden /> Blender integration</div>
          <h1 id="blender-plugin-title">Your terrains, <em>native in Blender.</em></h1>
          <p>
            Generate editor-compatible terrain directly in Blender, or turn exports
            into editable meshes with aligned tiles, UVs, packed textures, and metadata.
          </p>
          <div className="unity-hero-actions">
            <button type="button" className="lp-primary" onClick={() => onDownload(BLENDER_PLUGIN)}>
              <Download size={16} aria-hidden /> Download plugin
            </button>
            <button type="button" className="lp-secondary" onClick={() => scrollToSection('blender-install')}>
              <MonitorDown size={16} aria-hidden /> Installation guide
            </button>
          </div>
          <div className="unity-download-meta">
            <span><PackageCheck size={13} aria-hidden /> v{BLENDER_PACKAGE_VERSION}</span>
            <span><ShieldCheck size={13} aria-hidden /> GPL-3.0-or-later</span>
            <span><RefreshCw size={13} aria-hidden /> Alpha release</span>
          </div>
        </div>

        <div className="unity-hero-panel" aria-label="Blender terrain creation preview">
          <div className="unity-window-bar">
            <span className="unity-window-icon"><Boxes size={16} aria-hidden /></span>
            <div><strong>Procedural Terrains</strong><small>3D View · Terrain</small></div>
            <span className="unity-alpha-badge">BLENDER 5.2</span>
          </div>
          <div className="unity-window-body blender-window-body">
            <div className="blender-field-preview">
              <span>Terrain preset</span>
              <strong>Highlands · Seed 1337</strong>
              <ChevronRight size={14} aria-hidden />
            </div>
            <div className="blender-field-preview">
              <span>Dimensions</span>
              <strong>1000 × 1000 × 560 m</strong>
              <Grid3X3 size={14} aria-hidden />
            </div>
            <div className="blender-option-preview">
              <span><Check size={11} /> 257 × 257 resolution</span>
              <span><Check size={11} /> Smooth shading</span>
              <span><Check size={11} /> Height/slope preview</span>
            </div>
            <div className="unity-preview-checks">
              <span><CheckCircle2 size={13} /> Deterministic Noise Stack</span>
              <span><CheckCircle2 size={13} /> Seamless tiled coordinates</span>
            </div>
            <div className="unity-preview-button"><Zap size={14} aria-hidden /> Generate Terrain</div>
          </div>
        </div>
      </section>

      <div className="unity-compatibility" aria-label="Plugin compatibility">
        <span><strong>Blender {BLENDER_VERSION}+</strong><small>Manifest-based extension</small></span>
        <span><strong>Eevee · Cycles</strong><small>Principled baked materials</small></span>
        <span><strong>Create + Import</strong><small>Noise Stack and validated packages</small></span>
      </div>

      <section className="unity-section unity-quickstart" aria-labelledby="blender-quickstart-title">
        <div className="unity-section-heading">
          <span>Quick start</span>
          <h2 id="blender-quickstart-title">Create terrain or continue an exported world</h2>
          <p>Native generation and package import both produce editable Blender geometry.</p>
        </div>
        <div className="unity-step-grid">
          {quickSteps.map(({ icon: Icon, ...step }) => (
            <button type="button" onClick={() => scrollToSection(step.target)} className="unity-step-card" key={step.label}>
              <div className="unity-step-top"><span>{step.label}</span><Icon size={20} aria-hidden /></div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <span className="unity-step-link">Read the guide <ArrowRight size={13} aria-hidden /></span>
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
              <h2 id="blender-install-title">Install the plugin</h2>
              <p>The download is a ready-to-install Blender extension. Keep the ZIP intact.</p>
            </div>
          </div>
        </div>
        <div className="unity-doc-content">
          <div className="unity-method-card recommended">
            <div className="unity-method-heading">
              <span><Download size={18} aria-hidden /></span>
              <div><strong>Install from Disk</strong><small>Blender 5.2</small></div>
            </div>
            <StepList steps={[
              { title: 'Download the extension ZIP', body: `Do not extract procedural-terrains-blender-${BLENDER_PACKAGE_VERSION}.zip.` },
              { title: 'Open Blender Preferences', body: 'Go to Edit > Preferences > Get Extensions.' },
              { title: 'Choose Install from Disk', body: 'Open the extensions menu, select Install from Disk, then choose the downloaded ZIP.' },
              { title: 'Enable Procedural Terrains', body: 'If needed, enable the extension. Its tools appear in File > Import and the 3D View Terrain sidebar.' },
            ]} />
            <button type="button" className="lp-primary unity-inline-download" onClick={() => onDownload(BLENDER_PLUGIN)}>
              <Download size={15} aria-hidden /> Download v{BLENDER_PACKAGE_VERSION}
            </button>
          </div>
          <div className="unity-note">
            <CircleAlert size={17} aria-hidden />
            <p><strong>Version requirement.</strong> This build targets Blender {BLENDER_VERSION} and uses the current extension manifest format. Earlier Blender releases are not supported by this package.</p>
          </div>
        </div>
      </section>

      <section className="unity-section unity-doc-section" id="blender-create" aria-labelledby="blender-create-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">02</span>
          <div className="unity-doc-heading">
            <Sparkles size={24} aria-hidden />
            <div>
              <h2 id="blender-create-title">Create native terrain</h2>
              <p>Build an editable tiled mesh directly from a deterministic recipe.</p>
            </div>
          </div>
        </div>
        <div className="unity-doc-content">
          <div className="unity-method-card recommended">
            <div className="unity-method-heading">
              <span><Mountain size={18} aria-hidden /></span>
              <div><strong>Create a new terrain</strong><small>Blender-native workflow</small></div>
            </div>
            <StepList steps={[
              { title: 'Open the Terrain sidebar', body: 'In the 3D View, press N to open the Sidebar, choose Terrain, then select the Create workflow.' },
              { title: 'Choose the quick setup', body: 'Select one of the eight Terrain presets, click Apply, and set the deterministic seed, width, depth, maximum height, tile grid, and mesh resolution.' },
              { title: 'Set placement and shading', body: 'Center the assembly at World Origin or the 3D Cursor, then choose smooth shading and the Blender-native height/slope preview material.' },
              { title: 'Customize the Noise Stack', body: 'Open Advanced Noise Stack to apply a stack preset or add, duplicate, reorder, and remove layers. Each layer exposes its blend, parameters, seed offset, and height, noise, slope, or biome masks.' },
              { title: 'Check density', body: 'Review Estimated vertices. Blender warns above one million vertices and blocks recipes above sixteen million.' },
              { title: 'Generate Terrain', body: 'The extension creates a collection of ordinary mesh tiles with UVs, smooth shading, preview material data, tile metadata, and the complete saved recipe.' },
            ]} />
          </div>
          <div className="unity-method-card">
            <div className="unity-method-heading">
              <span><RefreshCw size={18} aria-hidden /></span>
              <div><strong>Edit and regenerate</strong><small>Preserve the collection</small></div>
            </div>
            <StepList steps={[
              { title: 'Select a generated tile', body: 'Choose any tile inside a collection created by the extension.' },
              { title: 'Load Selected', body: 'Click Load Selected to restore the collection recipe into the Create controls.' },
              { title: 'Adjust the recipe', body: 'Change presets, seed, dimensions, resolution, layers, masks, placement, or preview options.' },
              { title: 'Regenerate Selected', body: 'The extension replaces generated tile geometry while keeping the collection and any unrelated objects inside it.' },
            ]} />
          </div>
          <div className="unity-note success">
            <CheckCircle2 size={17} aria-hidden />
            <p><strong>Unity parity.</strong> Blender and Unity use the same seeded CPU Noise Stack formulas and presets. Generated tile borders share global sample coordinates, so their edge vertices remain identical.</p>
          </div>
          <div className="unity-note">
            <CircleAlert size={17} aria-hidden />
            <p><strong>Work light, finish dense.</strong> Use 129 or 257 while shaping. Regenerate at 513 or 1025 only when the extra mesh density is useful.</p>
          </div>
        </div>
      </section>

      <section className="unity-section unity-doc-section" id="blender-export" aria-labelledby="blender-export-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">03</span>
          <div className="unity-doc-heading">
            <UploadCloud size={24} aria-hidden />
            <div>
              <h2 id="blender-export-title">Export for Blender</h2>
              <p>The Blender production preset creates authoritative heightfields and baked surface maps.</p>
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
              <div><FolderOpen size={15} /><strong>Blender/</strong></div>
              <span><FileJson size={14} /> project.ptrterrain</span>
              <span><FileArchive size={14} /> heightmap.raw</span>
              <span><Mountain size={14} /> tiles/</span>
              <span><Layers3 size={14} /> textures/</span>
              <span><Settings2 size={14} /> splatmaps/</span>
            </div>
            <div className="unity-export-tip">
              <CheckCircle2 size={18} aria-hidden />
              <div><strong>Source detail stays authoritative</strong><p>The importer can create a 129, 257, 513, 1025, or full-resolution mesh without changing the exported heightfield.</p></div>
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
              <h2 id="blender-import-title">Import and build</h2>
              <p>Create a clean collection of native meshes you can sculpt, shade, modify, and render.</p>
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
              <div key={label}><span><Icon size={16} aria-hidden /></span><strong>{label}</strong><Check size={14} aria-hidden /></div>
            ))}
          </div>
          <div className="unity-note success">
            <PackageCheck size={17} aria-hidden />
            <p><strong>Ready for Blender tools.</strong> The result is ordinary mesh geometry with standard UV and Principled material data—not a locked custom object type.</p>
          </div>
        </div>
      </section>

      <section className="unity-section unity-limitations" aria-labelledby="blender-limitations-title">
        <div className="unity-section-heading">
          <span>Alpha scope</span>
          <h2 id="blender-limitations-title">Built for reliable terrain handoff</h2>
          <p>Native generation and faithful baked reconstruction both remain fully editable.</p>
        </div>
        <div className="unity-scope-grid">
          <div>
            <span className="unity-scope-icon available"><CheckCircle2 size={20} aria-hidden /></span>
            <h3>Available now</h3>
            <ul>
              <li>Secure ZIP and .ptrterrain validation</li>
              <li>Native seeded Noise Stack terrain generation</li>
              <li>Custom dimensions and origin/cursor placement</li>
              <li>Tiled editable mesh reconstruction</li>
              <li>Aligned UVs and baked normal materials</li>
              <li>Packed images and source custom properties</li>
            </ul>
          </div>
          <div>
            <span className="unity-scope-icon upcoming"><Sparkles size={20} aria-hidden /></span>
            <h3>Planned next</h3>
            <ul>
              <li>Detailed biome shader reconstruction</li>
              <li>Water, props, and spline objects</li>
              <li>Non-destructive reimport workflows</li>
              <li>Node graph and erosion authoring</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="unity-section unity-faq" aria-labelledby="blender-faq-title">
        <div className="unity-section-heading">
          <span>Help</span>
          <h2 id="blender-faq-title">Common questions</h2>
        </div>
        <div className="unity-faq-list">
          <details>
            <summary>Can I sculpt or modify the imported terrain?<ChevronRight size={16} aria-hidden /></summary>
            <p>Yes. Every tile is a standard Blender mesh, so sculpting, modifiers, Geometry Nodes, material edits, and regular mesh operations remain available.</p>
          </details>
          <details>
            <summary>Can I create terrain without exporting first?<ChevronRight size={16} aria-hidden /></summary>
            <p>Yes. The Create workflow includes seeded presets and an advanced editable Noise Stack, tiled dimensions, regeneration, and a Blender-native height/slope preview material.</p>
          </details>
          <details>
            <summary>Why does Automatic use 513 × 513 vertices?<ChevronRight size={16} aria-hidden /></summary>
            <p>It keeps the mesh responsive while sampling the complete exported height range. You can choose 1025 or Full source resolution when you need denser geometry.</p>
          </details>
          <details>
            <summary>Are ZIP textures kept after import?<ChevronRight size={16} aria-hidden /></summary>
            <p>Yes. Texture images loaded from ZIP packages are packed into the current .blend before the temporary extraction folder is removed.</p>
          </details>
          <details>
            <summary>How are axes converted?<ChevronRight size={16} aria-hidden /></summary>
            <p>The right-handed mapping is source (X, Y, Z) to Blender (X, -Z, Y). This moves height to Blender Z while units remain meters.</p>
          </details>
        </div>
      </section>

      <section className="unity-final-cta">
        <div>
          <span><Boxes size={15} aria-hidden /> Blender extension v{BLENDER_PACKAGE_VERSION}</span>
          <h2>Bring your next world into Blender.</h2>
          <p>Install the extension, create or import a terrain, and continue with native Blender tools.</p>
        </div>
        <div>
          <button type="button" className="lp-primary" onClick={() => onDownload(BLENDER_PLUGIN)}><Download size={16} aria-hidden /> Download plugin</button>
          <button type="button" className="lp-secondary" onClick={onOpenEditor}>Open terrain editor <ExternalLink size={15} aria-hidden /></button>
        </div>
      </section>
    </article>
  );
}
