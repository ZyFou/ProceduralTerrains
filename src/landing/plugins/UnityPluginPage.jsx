import { useState } from 'react';
import {
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileJson,
  FolderOpen,
  Layers3,
  MonitorDown,
  Mountain,
  PackageCheck,
  PackagePlus,
  Puzzle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Workflow,
  Zap,
} from 'lucide-react';
import { GITHUB_REPO_URL } from '../../constants/app.js';
import { PLUGINS } from '../../config/plugins.js';

const UNITY_PLUGIN = PLUGINS.unity;
const UNITY_PACKAGE_VERSION = UNITY_PLUGIN.currentVersion;
const UNITY_VERSION = '6000.3';
const GIT_URL = `${GITHUB_REPO_URL}.git?path=/plugins/unity/Packages/com.zyfou.procedural-terrains`;

const quickSteps = [
  {
    icon: Download,
    label: '01',
    title: 'Install the package',
    body: 'Download the plugin, extract it, then add its package.json from Unity Package Manager.',
    target: 'unity-install',
  },
  {
    icon: Sparkles,
    label: '02',
    title: 'Create in Unity',
    body: 'Choose a seeded preset or build an advanced Noise Stack directly in the Unity Editor.',
    target: 'unity-create',
  },
  {
    icon: FileArchive,
    label: '03',
    title: 'Import existing worlds',
    body: 'Export a Unity Terrain ZIP and reconstruct its editable native Terrain hierarchy.',
    target: 'unity-import',
  },
];

const generatedAssets = [
  ['TerrainData per tile', Layers3],
  ['Terrain GameObjects', Mountain],
  ['Terrain colliders', ShieldCheck],
  ['Connected neighbors', Workflow],
  ['Native pipeline material', Sparkles],
  ['Baked TerrainLayer', Box],
];

function CopyField({ value }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="unity-copy-field">
      <code>{value}</code>
      <button type="button" onClick={copy} aria-label="Copy Git package URL">
        {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

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

export default function UnityPluginPage({ onOpenEditor, onDownload }) {
  const scrollToSection = (sectionId) => {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <article className="unity-page">
      <section className="unity-hero" aria-labelledby="unity-plugin-title">
        <div className="unity-hero-copy">
          <div className="unity-eyebrow"><Puzzle size={14} aria-hidden /> Unity integration</div>
          <h1 id="unity-plugin-title">Create terrain, <em>inside Unity.</em></h1>
          <p>
            Generate deterministic native TerrainData from seeded presets and editable
            Noise Stacks, or import an existing Procedural Terrains world.
          </p>
          <div className="unity-hero-actions">
            <button type="button" className="lp-primary" onClick={() => onDownload(UNITY_PLUGIN)}>
              <Download size={16} aria-hidden /> Download plugin
            </button>
            <button type="button" className="lp-secondary" onClick={() => scrollToSection('unity-install')}>
              <MonitorDown size={16} aria-hidden /> Installation guide
            </button>
          </div>
          <div className="unity-download-meta">
            <span><PackageCheck size={13} aria-hidden /> v{UNITY_PACKAGE_VERSION}</span>
            <span><ShieldCheck size={13} aria-hidden /> MIT licensed</span>
            <span><RefreshCw size={13} aria-hidden /> Alpha release</span>
          </div>
        </div>

        <div className="unity-hero-panel" aria-label="Unity terrain creation preview">
          <div className="unity-window-bar">
            <span className="unity-window-icon"><Puzzle size={16} aria-hidden /></span>
            <div><strong>Procedural Terrains</strong><small>Terrain Creator</small></div>
            <span className="unity-alpha-badge">ALPHA</span>
          </div>
          <div className="unity-window-body">
            <div className="unity-window-tabs"><span>Import</span><span className="active">Create</span></div>
            <div className="unity-drop-preview">
              <Mountain size={28} aria-hidden />
              <strong>Highlands · Seed 1337</strong>
              <small>1000 × 1000 m · 257² · 4 tiles</small>
            </div>
            <div className="unity-preview-checks">
              <span><CheckCircle2 size={13} /> Deterministic Noise Stack</span>
              <span><CheckCircle2 size={13} /> Shared tile borders</span>
              <span><CheckCircle2 size={13} /> Native TerrainData output</span>
            </div>
            <div className="unity-preview-button"><Zap size={14} aria-hidden /> Generate Terrain</div>
          </div>
        </div>
      </section>

      <div className="unity-compatibility" aria-label="Plugin compatibility">
        <span><strong>Unity {UNITY_VERSION}+</strong><small>Editor package</small></span>
        <span><strong>Built-in · URP · HDRP</strong><small>Native Terrain shaders</small></span>
        <span><strong>Create + Import</strong><small>Native TerrainData</small></span>
      </div>

      <section className="unity-section unity-quickstart" aria-labelledby="unity-quickstart-title">
        <div className="unity-section-heading">
          <span>Quick start</span>
          <h2 id="unity-quickstart-title">From seed to playable terrain</h2>
          <p>Create natively or import baked worlds without manual tile stitching.</p>
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

      <section className="unity-section unity-doc-section" id="unity-install" aria-labelledby="unity-install-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">01</span>
          <div className="unity-doc-heading">
            <PackagePlus size={24} aria-hidden />
            <div>
              <h2 id="unity-install-title">Install the plugin</h2>
              <p>The downloaded ZIP contains a standard Unity Package Manager package.</p>
            </div>
          </div>
        </div>
        <div className="unity-doc-content">
          <div className="unity-method-card recommended">
            <div className="unity-method-heading">
              <span><Download size={18} aria-hidden /></span>
              <div><strong>Install from the download</strong><small>Recommended</small></div>
            </div>
            <StepList steps={[
              { title: 'Download and extract the ZIP', body: 'Keep the com.zyfou.procedural-terrains folder intact.' },
              { title: 'Open Package Manager', body: 'In Unity, go to Window > Package Management > Package Manager.' },
              { title: 'Add package from disk', body: 'Click the + menu, choose Add package from disk, then select package.json in the extracted folder.' },
              { title: 'Wait for compilation', body: 'Unity adds Procedural Terrains to In Project and compiles the Editor tools.' },
            ]} />
            <button type="button" className="lp-primary unity-inline-download" onClick={() => onDownload(UNITY_PLUGIN)}>
              <Download size={15} aria-hidden /> Download v{UNITY_PACKAGE_VERSION}
            </button>
          </div>

          <div className="unity-method-card">
            <div className="unity-method-heading">
              <span><Clipboard size={18} aria-hidden /></span>
              <div><strong>Install from Git</strong><small>Best for easy updates</small></div>
            </div>
            <p className="unity-method-copy">
              In Package Manager, open the <strong>+</strong> menu, select
              <strong> Add package from git URL</strong>, and paste this address.
            </p>
            <CopyField value={GIT_URL} />
          </div>

          <div className="unity-note">
            <CircleAlert size={17} aria-hidden />
            <p><strong>Alpha requirement.</strong> The package currently targets Unity {UNITY_VERSION}. Keep the package in source control so your team uses the same plugin version.</p>
          </div>
        </div>
      </section>

      <section className="unity-section unity-doc-section" id="unity-create" aria-labelledby="unity-create-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">02</span>
          <div className="unity-doc-heading">
            <Sparkles size={24} aria-hidden />
            <div>
              <h2 id="unity-create-title">Create native terrain</h2>
              <p>Generate editable TerrainData without leaving the Unity Editor.</p>
            </div>
          </div>
        </div>
        <div className="unity-doc-content">
          <div className="unity-method-card recommended">
            <div className="unity-method-heading">
              <span><Mountain size={18} aria-hidden /></span>
              <div><strong>Create a new terrain</strong><small>Native Unity workflow</small></div>
            </div>
            <StepList steps={[
              { title: 'Open the Create tab', body: 'Go to Window > Procedural Terrains > Terrain Importer, then choose Create.' },
              { title: 'Name and seed the recipe', body: 'Enter a project name, choose one of the eight Terrain presets, click Apply, and set the deterministic seed.' },
              { title: 'Set the assembly', body: 'Choose total width, depth, height scale, Tiles X/Z, and a 65, 129, 257, 513, or 1025 heightmap resolution per tile.' },
              { title: 'Choose placement and preview', body: 'Center the assembly at World Origin or the current Scene View Pivot, then optionally enable height/slope preview TerrainLayers.' },
              { title: 'Customize the Noise Stack', body: 'Open Advanced Noise Stack to apply a stack preset or add, duplicate, reorder, and remove layers. Every layer exposes its blend, parameters, seed offset, and optional height, noise, slope, or biome masks.' },
              { title: 'Generate Terrain', body: 'Unity creates TerrainData assets, Terrain GameObjects, colliders, connected neighbors, preview assets, and a saved generation recipe.' },
            ]} />
          </div>
          <div className="unity-method-card">
            <div className="unity-method-heading">
              <span><RefreshCw size={18} aria-hidden /></span>
              <div><strong>Edit and regenerate</strong><small>Keep the saved recipe</small></div>
            </div>
            <StepList steps={[
              { title: 'Select generated terrain', body: 'Select the Procedural Terrain root or any generated Terrain tile in the Hierarchy.' },
              { title: 'Load Selected', body: 'Click Load Selected to copy the referenced TerrainGenerationRecipe back into the Create controls.' },
              { title: 'Adjust the recipe', body: 'Change the seed, dimensions, resolution, presets, layers, masks, or preview option.' },
              { title: 'Regenerate Selected', body: 'Unity replaces only marked generated tiles and assets, reconnects neighbors, and preserves unrelated child GameObjects under the root.' },
            ]} />
          </div>
          <div className="unity-note success">
            <CheckCircle2 size={17} aria-hidden />
            <p><strong>Blender parity.</strong> Unity uses the same deterministic CPU formulas and presets, with shared world coordinates for seamless tile borders.</p>
          </div>
          <div className="unity-note">
            <CircleAlert size={17} aria-hidden />
            <p><strong>Choose resolution deliberately.</strong> The window warns above one million samples and blocks recipes above sixteen million. Use 129 or 257 while shaping, then regenerate at 513 or 1025 for final detail.</p>
          </div>
        </div>
      </section>

      <section className="unity-section unity-doc-section" id="unity-export" aria-labelledby="unity-export-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">03</span>
          <div className="unity-doc-heading">
            <UploadCloud size={24} aria-hidden />
            <div>
              <h2 id="unity-export-title">Export for Unity</h2>
              <p>Use the production preset so every required runtime file is packaged correctly.</p>
            </div>
          </div>
        </div>
        <div className="unity-doc-content">
          <StepList steps={[
            { title: 'Finish your terrain in Tile mode', body: 'The current Unity runtime document supports Tile mode and square tile assemblies.' },
            { title: 'Open the Export panel', body: 'Select Export in the editor toolbar, then open Production Preset.' },
            { title: 'Choose Unity Terrain', body: 'The preset enables separate tiles, RAW heightfields, baked color and normal maps, splat data, colliders and water metadata.' },
            { title: 'Review Production Check', body: 'Resolve any red validation message. Unity height grids must use a supported vertex resolution such as 1025 × 1025.' },
            { title: 'Click Export Terrain', body: 'Save the generated ZIP without changing its internal Terrain folder structure.' },
          ]} />

          <div className="unity-export-layout">
            <div className="unity-folder-tree">
              <div><FolderOpen size={15} /><strong>Terrain/</strong></div>
              <span><FileJson size={14} /> project.ptrterrain</span>
              <span><FileArchive size={14} /> heightmap.raw</span>
              <span><Mountain size={14} /> tiles/</span>
              <span><Layers3 size={14} /> textures/</span>
              <span><Settings2 size={14} /> splatmaps/</span>
            </div>
            <div className="unity-export-tip">
              <CheckCircle2 size={18} aria-hidden />
              <div><strong>Keep the ZIP untouched</strong><p>The Unity importer safely extracts it into a unique folder below Assets/ProceduralTerrains/Imports.</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="unity-section unity-doc-section" id="unity-import" aria-labelledby="unity-import-title">
        <div className="unity-doc-aside">
          <span className="unity-doc-index">04</span>
          <div className="unity-doc-heading">
            <Mountain size={24} aria-hidden />
            <div>
              <h2 id="unity-import-title">Import and build</h2>
              <p>The importer creates a native Unity Terrain hierarchy you can continue editing.</p>
            </div>
          </div>
        </div>
        <div className="unity-doc-content">
          <StepList steps={[
            { title: 'Open the Terrain Importer', body: 'Go to Window > Procedural Terrains > Terrain Importer.' },
            { title: 'Select your export', body: 'Choose the ZIP produced by Procedural Terrains. The importer validates the document and its artifacts before building.' },
            { title: 'Choose build options', body: 'Keep Create Terrain objects enabled, then choose whether to create pipeline-compatible Terrain Materials and baked TerrainLayers.' },
            { title: 'Import ZIP and Build Scene', body: 'The ZIP is extracted below Assets/ProceduralTerrains/Imports and a Terrain GameObject is created for every exported tile.' },
            { title: 'Rebuild an imported project', body: 'Drag an existing project.ptrterrain TerrainProjectAsset into Already imported, then click Build Terrains in Current Scene.' },
            { title: 'Save the scene', body: 'Review the generated hierarchy, position it in your project, then save your Unity scene.' },
          ]} />

          <div className="unity-generated-grid">
            {generatedAssets.map(([label, Icon]) => (
              <div key={label}><span><Icon size={16} aria-hidden /></span><strong>{label}</strong><Check size={14} aria-hidden /></div>
            ))}
          </div>

          <div className="unity-note success">
            <PackageCheck size={17} aria-hidden />
            <p><strong>Rebuild at any time.</strong> You can also select an imported TerrainProjectAsset in the importer window and rebuild its Terrain hierarchy.</p>
          </div>
        </div>
      </section>

      <section className="unity-section unity-limitations" aria-labelledby="unity-limitations-title">
        <div className="unity-section-heading">
          <span>Alpha scope</span>
          <h2 id="unity-limitations-title">What is available today</h2>
          <p>A clear view of what the current editor plugin handles—and what comes next.</p>
        </div>
        <div className="unity-scope-grid">
          <div>
            <span className="unity-scope-icon available"><CheckCircle2 size={20} aria-hidden /></span>
            <h3>Available now</h3>
            <ul>
              <li>ZIP and .ptrterrain validation</li>
              <li>TerrainData, colliders and tile neighbors</li>
              <li>Seeded presets and editable Noise Stacks</li>
              <li>Saved recipes, load selected and regeneration</li>
              <li>Baked color and normal TerrainLayer</li>
              <li>Built-in, URP and HDRP Terrain materials</li>
            </ul>
          </div>
          <div>
            <span className="unity-scope-icon upcoming"><Sparkles size={20} aria-hidden /></span>
            <h3>Planned next</h3>
            <ul>
              <li>Runtime terrain generation</li>
              <li>Detailed biome materials and props</li>
              <li>Splines and richer water reconstruction</li>
              <li>Expanded runtime generation tools</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="unity-section unity-faq" aria-labelledby="unity-faq-title">
        <div className="unity-section-heading">
          <span>Help</span>
          <h2 id="unity-faq-title">Common questions</h2>
        </div>
        <div className="unity-faq-list">
          <details>
            <summary>Does it work with URP and HDRP?<ChevronRight size={16} aria-hidden /></summary>
            <p>Yes. Generated materials use Unity's native Terrain shader for the active Built-in, URP or HDRP render pipeline, while baked textures are assigned through a TerrainLayer.</p>
          </details>
          <details>
            <summary>Can I edit the terrain after import?<ChevronRight size={16} aria-hidden /></summary>
            <p>Yes. The importer builds regular Unity Terrain objects and TerrainData assets, so you can use Unity's standard terrain tools afterward.</p>
          </details>
          <details>
            <summary>Can Unity match Blender-generated terrain?<ChevronRight size={16} aria-hidden /></summary>
            <p>Yes. Both plugins use the same seeded CPU Noise Stack formulas and presets. Unity adapts the result to native TerrainData and reverses the horizontal generator axis consistently.</p>
          </details>
          <details>
            <summary>Where are imported files stored?<ChevronRight size={16} aria-hidden /></summary>
            <p>Each ZIP is extracted into its own folder below Assets/ProceduralTerrains/Imports, avoiding accidental overwrites between imports.</p>
          </details>
        </div>
      </section>

      <section className="unity-final-cta">
        <div>
          <span><Puzzle size={15} aria-hidden /> Unity package v{UNITY_PACKAGE_VERSION}</span>
          <h2>Bring your next world into Unity.</h2>
          <p>Install the alpha package, create or import a terrain, and keep building with native Unity tools.</p>
        </div>
        <div>
          <button type="button" className="lp-primary" onClick={() => onDownload(UNITY_PLUGIN)}><Download size={16} aria-hidden /> Download plugin</button>
          <button type="button" className="lp-secondary" onClick={onOpenEditor}>Open terrain editor <ExternalLink size={15} aria-hidden /></button>
        </div>
      </section>
    </article>
  );
}
