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

const BLENDER_PACKAGE_VERSION = '0.2.0';
const BLENDER_VERSION = '5.2';
const DOWNLOAD_URL = `/downloads/plugins/procedural-terrains-blender-${BLENDER_PACKAGE_VERSION}.zip`;

const quickSteps = [
  {
    icon: Download,
    label: '01',
    title: 'Install the extension',
    body: 'Install the downloaded ZIP directly from Blender Preferences.',
    target: 'blender-install',
  },
  {
    icon: FileArchive,
    label: '02',
    title: 'Export your terrain',
    body: 'Choose the Blender Scene production preset and export the terrain ZIP.',
    target: 'blender-export',
  },
  {
    icon: Mountain,
    label: '03',
    title: 'Build editable meshes',
    body: 'Import the ZIP and create tiled Blender meshes with baked materials.',
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

export default function BlenderPluginPage({ onOpenEditor }) {
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
            Turn Procedural Terrains exports into editable, production-friendly
            Blender meshes with aligned tiles, UVs, packed textures, and project metadata.
          </p>
          <div className="unity-hero-actions">
            <a className="lp-primary" href={DOWNLOAD_URL} download>
              <Download size={16} aria-hidden /> Download plugin
            </a>
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

        <div className="unity-hero-panel" aria-label="Blender import workflow preview">
          <div className="unity-window-bar">
            <span className="unity-window-icon"><Boxes size={16} aria-hidden /></span>
            <div><strong>Procedural Terrains</strong><small>3D View · Terrain</small></div>
            <span className="unity-alpha-badge">BLENDER 5.2</span>
          </div>
          <div className="unity-window-body blender-window-body">
            <div className="blender-field-preview">
              <span>Terrain package</span>
              <strong>Alpine_World.zip</strong>
              <FolderOpen size={14} aria-hidden />
            </div>
            <div className="blender-field-preview">
              <span>Mesh detail</span>
              <strong>Automatic · 513 × 513</strong>
              <ChevronRight size={14} aria-hidden />
            </div>
            <div className="blender-option-preview">
              <span><Check size={11} /> Create baked materials</span>
              <span><Check size={11} /> Smooth shading</span>
              <span><Check size={11} /> Pack texture images</span>
            </div>
            <div className="unity-preview-checks">
              <span><CheckCircle2 size={13} /> Runtime document valid</span>
              <span><CheckCircle2 size={13} /> 4 heightfields ready</span>
            </div>
            <div className="unity-preview-button"><Zap size={14} aria-hidden /> Import and Build</div>
          </div>
        </div>
      </section>

      <div className="unity-compatibility" aria-label="Plugin compatibility">
        <span><strong>Blender {BLENDER_VERSION}+</strong><small>Manifest-based extension</small></span>
        <span><strong>Eevee · Cycles</strong><small>Principled baked materials</small></span>
        <span><strong>ZIP + .ptrterrain</strong><small>Validated native imports</small></span>
      </div>

      <section className="unity-section unity-quickstart" aria-labelledby="blender-quickstart-title">
        <div className="unity-section-heading">
          <span>Quick start</span>
          <h2 id="blender-quickstart-title">From terrain editor to editable geometry</h2>
          <p>Three steps, with tile placement, UV alignment, and material setup handled for you.</p>
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
              { title: 'Download the extension ZIP', body: 'Do not extract procedural-terrains-blender-0.2.0.zip.' },
              { title: 'Open Blender Preferences', body: 'Go to Edit > Preferences > Get Extensions.' },
              { title: 'Choose Install from Disk', body: 'Open the extensions menu, select Install from Disk, then choose the downloaded ZIP.' },
              { title: 'Enable Procedural Terrains', body: 'If needed, enable the extension. Its tools appear in File > Import and the 3D View Terrain sidebar.' },
            ]} />
            <a className="lp-primary unity-inline-download" href={DOWNLOAD_URL} download>
              <Download size={15} aria-hidden /> Download v{BLENDER_PACKAGE_VERSION}
            </a>
          </div>
          <div className="unity-note">
            <CircleAlert size={17} aria-hidden />
            <p><strong>Version requirement.</strong> This build targets Blender {BLENDER_VERSION} and uses the current extension manifest format. Earlier Blender releases are not supported by this package.</p>
          </div>
        </div>
      </section>

      <section className="unity-section unity-doc-section" id="blender-export" aria-labelledby="blender-export-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">02</span>
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
          <span className="unity-doc-index">03</span>
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
          <p>The first release focuses on faithful baked terrain reconstruction and editability.</p>
        </div>
        <div className="unity-scope-grid">
          <div>
            <span className="unity-scope-icon available"><CheckCircle2 size={20} aria-hidden /></span>
            <h3>Available now</h3>
            <ul>
              <li>Secure ZIP and .ptrterrain validation</li>
              <li>Tiled editable mesh reconstruction</li>
              <li>Aligned UVs and baked normal materials</li>
              <li>Packed images and source custom properties</li>
            </ul>
          </div>
          <div>
            <span className="unity-scope-icon upcoming"><Sparkles size={20} aria-hidden /></span>
            <h3>Planned next</h3>
            <ul>
              <li>Procedural generation inside Blender</li>
              <li>Detailed biome shader reconstruction</li>
              <li>Water, props, and spline objects</li>
              <li>Non-destructive reimport workflows</li>
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
          <p>Install the importer, export a terrain, and continue with native Blender tools.</p>
        </div>
        <div>
          <a className="lp-primary" href={DOWNLOAD_URL} download><Download size={16} aria-hidden /> Download plugin</a>
          <button type="button" className="lp-secondary" onClick={onOpenEditor}>Open terrain editor <ExternalLink size={15} aria-hidden /></button>
        </div>
      </section>
    </article>
  );
}
