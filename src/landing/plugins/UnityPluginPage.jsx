import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import { useState } from 'react';
import {
  Box,
  Check,
  CheckCircle2,
  CircleAlert,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileJson,
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
import { cn } from '@/lib/utils';
import { Button } from '@/components/shadcn/button.jsx';
import {
  CompatItem,
  CompatibilityStrip,
  DocSection,
  DownloadButton,
  ExportLayout,
  ExportTip,
  FaqItem,
  FaqSection,
  FinalCta,
  FolderTree,
  GeneratedGrid,
  MethodCard,
  Note,
  PluginHero,
  PreviewChecks,
  PreviewGenerate,
  PreviewWindow,
  QuickStart,
  ScopeCard,
  ScopeGrid,
  SecondaryButton,
  SectionHeading,
  StepCard,
  StepList,
  scrollToSection,
} from './PluginDoc.jsx';

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
  useLanguage();
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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-background py-1.5 pr-1.5 pl-3">
      <code className="truncate font-mono text-[12.5px] text-zinc-300">{value}</code>
      <Button variant="outline" size="sm" onClick={copy} aria-label={translateText("Copy Git package URL")} className="h-8 rounded-md">
        {copied ? <Check className="text-brand" aria-hidden /> : <Copy aria-hidden />}
        <span className="hidden sm:inline">{translateText(copied ? 'Copied' : 'Copy')}</span>
      </Button>
    </div>
  );
}

const windowTab = 'grid h-8 place-items-center rounded-md text-[13px] text-zinc-400';

export default function UnityPluginPage({ onOpenEditor, onDownload }) {
  useLanguage();

  return (
    <article className="w-full text-foreground">
      <PluginHero
        titleId="unity-plugin-title"
        eyebrow={translateText(" Unity integration")}
        title={translateText("Create terrain, ")}
        subtitle={translateText("inside Unity.")}
        description={translateText("Generate deterministic native TerrainData from seeded presets and editable Noise Stacks, or import an existing Procedural Terrains world.")}
        actions={(
          <>
            <DownloadButton block plugin={UNITY_PLUGIN} onDownload={onDownload}>
              <Download aria-hidden />{translateText(" Download plugin")}</DownloadButton>
            <SecondaryButton onClick={() => scrollToSection('unity-install')}>
              <MonitorDown aria-hidden />{translateText(" Installation guide")}</SecondaryButton>
          </>
        )}
        meta={(
          <>
            <span><PackageCheck aria-hidden />{translateText(" v")}{translateText(UNITY_PACKAGE_VERSION)}</span>
            <span><ShieldCheck aria-hidden />{translateText(" MIT licensed")}</span>
            <span><RefreshCw aria-hidden />{translateText(" Alpha release")}</span>
          </>
        )}
        preview={(
          <PreviewWindow
            label={translateText("Unity terrain creation preview")}
            icon={Puzzle}
            title={translateText("Procedural Terrains")}
            subtitle={translateText("Terrain Creator")}
            badge={translateText("ALPHA")}
          >
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background/70 p-1">
              <span className={windowTab}>{translateText("Import")}</span>
              <span className={cn(windowTab, 'bg-accent text-foreground shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]')}>{translateText("Create")}</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-background/70 px-3 py-7 text-center">
              <Mountain className="mb-1 size-7 text-brand" aria-hidden />
              <strong className="text-sm font-medium text-foreground">{translateText("Highlands · Seed 1337")}</strong>
              <small className="text-xs text-zinc-400">{translateText("1000 × 1000 m · 513² · 4 tiles")}</small>
            </div>
            <PreviewChecks>
              <span><CheckCircle2 />{translateText(" Deterministic Noise Stack")}</span>
              <span><CheckCircle2 />{translateText(" Shared tile borders")}</span>
              <span><CheckCircle2 />{translateText(" Native TerrainData output")}</span>
            </PreviewChecks>
            <PreviewGenerate icon={Zap}>{translateText(" Generate Terrain")}</PreviewGenerate>
          </PreviewWindow>
        )}
      />

      <CompatibilityStrip label={translateText("Plugin compatibility")}>
        <CompatItem title={<>{translateText("Unity ")}{translateText(UNITY_VERSION)}+</>} caption={translateText("Editor package")} />
        <CompatItem title={translateText("Built-in · URP · HDRP")} caption={translateText("Native Terrain shaders")} />
        <CompatItem title={translateText("Create + Import")} caption={translateText("Native TerrainData")} />
      </CompatibilityStrip>

      <QuickStart
        titleId="unity-quickstart-title"
        label={translateText("Quick start")}
        title={translateText("From seed to playable terrain")}
        description={translateText("Create natively or import baked worlds without manual tile stitching.")}
        steps={quickSteps}
      />

      <DocSection
        id="unity-install"
        titleId="unity-install-title"
        index="01"
        icon={PackagePlus}
        title={translateText("Install the plugin")}
        description={translateText("The downloaded ZIP contains a standard Unity Package Manager package.")}
      >
        <MethodCard recommended icon={Download} title={translateText("Install from the download")} caption={translateText("Recommended")}>
          <StepList steps={[
            { title: 'Download and extract the ZIP', body: 'Keep the com.zyfou.procedural-terrains folder intact.' },
            { title: 'Open Package Manager', body: 'In Unity, go to Window > Package Management > Package Manager.' },
            { title: 'Add package from disk', body: 'Click the + menu, choose Add package from disk, then select package.json in the extracted folder.' },
            { title: 'Wait for compilation', body: 'Unity adds Procedural Terrains to In Project and compiles the Editor tools.' },
          ]} />
          <div className="mt-6">
            <DownloadButton plugin={UNITY_PLUGIN} onDownload={onDownload}>
              <Download aria-hidden />{translateText(" Download v")}{translateText(UNITY_PACKAGE_VERSION)}
            </DownloadButton>
          </div>
        </MethodCard>

        <MethodCard icon={Clipboard} title={translateText("Install from Git")} caption={translateText("Best for easy updates")}>
          <p className="mt-5 mb-4 text-[13.5px] leading-relaxed text-zinc-400 [&_strong]:font-medium [&_strong]:text-zinc-100">{translateText("In Package Manager, open the ")}<strong>+</strong>{translateText(" menu, select")}<strong>{translateText(" Add package from git URL")}</strong>{translateText(", and paste this address.")}</p>
          <CopyField value={GIT_URL} />
        </MethodCard>

        <Note icon={CircleAlert}>
          <strong>{translateText("Alpha requirement.")}</strong>{translateText(" The package currently targets Unity ")}{translateText(UNITY_VERSION)}{translateText(". Keep the package in source control so your team uses the same plugin version.")}
        </Note>
      </DocSection>

      <DocSection
        id="unity-create"
        titleId="unity-create-title"
        index="02"
        icon={Sparkles}
        title={translateText("Create native terrain")}
        description={translateText("Generate editable TerrainData without leaving the Unity Editor.")}
      >
        <MethodCard recommended icon={Mountain} title={translateText("Create a new terrain")} caption={translateText("Native Unity workflow")}>
          <StepList steps={[
            { title: 'Open the Create tab', body: 'Go to Window > Procedural Terrains > Terrain Importer, then choose Create.' },
            { title: 'Name and seed the recipe', body: 'Enter a project name, choose one of the eight Terrain presets, click Apply, and set the deterministic seed.' },
            { title: 'Set the assembly', body: 'Choose total width, depth, height scale, Tiles X/Z, and a 65, 129, 257, 513, or 1025 heightmap resolution per tile.' },
            { title: 'Choose placement and preview', body: 'Center the assembly at World Origin or the current Scene View Pivot, then optionally enable procedural sand, grass, rock and snow TerrainLayers.' },
            { title: 'Customize the Noise Stack', body: 'Open Advanced Noise Stack to apply a stack preset or add, duplicate, reorder, and remove layers. Every layer exposes its blend, parameters, seed offset, and optional height, noise, slope, or biome masks.' },
            { title: 'Generate Terrain', body: 'Unity creates TerrainData assets, Terrain GameObjects, colliders, connected neighbors, procedural surface assets, placeholder water, and a saved generation recipe.' },
          ]} />
        </MethodCard>
        <MethodCard icon={RefreshCw} title={translateText("Edit and regenerate")} caption={translateText("Keep the saved recipe")}>
          <StepList steps={[
            { title: 'Select generated terrain', body: 'Select the Procedural Terrain root or any generated Terrain tile in the Hierarchy.' },
            { title: 'Load Selected', body: 'Click Load Selected to copy the referenced TerrainGenerationRecipe back into the Create controls.' },
            { title: 'Adjust the recipe', body: 'Change the seed, dimensions, resolution, presets, layers, masks, fine detail, thermal erosion, surface settings, or water.' },
            { title: 'Regenerate Selected', body: 'Unity replaces only marked generated tiles and assets, reconnects neighbors, and preserves unrelated child GameObjects under the root.' },
          ]} />
        </MethodCard>
        <Note tone="success" icon={CheckCircle2}>
          <strong>{translateText("Blender parity.")}</strong>{translateText(" Unity uses the same deterministic CPU formulas and presets, with shared world coordinates for seamless tile borders.")}
        </Note>
        <Note icon={CircleAlert}>
          <strong>{translateText("Choose resolution deliberately.")}</strong>{translateText(" The window warns above one million samples and blocks recipes above sixteen million. Use 129 or 257 while shaping, then regenerate at 513 or 1025 for final detail.")}
        </Note>
      </DocSection>

      <DocSection
        id="unity-export"
        titleId="unity-export-title"
        index="03"
        icon={UploadCloud}
        title={translateText("Export for Unity")}
        description={translateText("Use the production preset so every required runtime file is packaged correctly.")}
      >
        <StepCard steps={[
          { title: 'Finish your terrain in Tile mode', body: 'The current Unity runtime document supports Tile mode and square tile assemblies.' },
          { title: 'Open the Export panel', body: 'Select Export in the editor toolbar, then open Production Preset.' },
          { title: 'Choose Unity Terrain', body: 'The preset enables separate tiles, RAW heightfields, baked color and normal maps, splat data, colliders and water metadata.' },
          { title: 'Review Production Check', body: 'Resolve any red validation message. Unity height grids must use a supported vertex resolution such as 1025 × 1025.' },
          { title: 'Click Export Terrain', body: 'Save the generated ZIP without changing its internal Terrain folder structure.' },
        ]} />

        <ExportLayout>
          <FolderTree root={translateText("Terrain/")}>
            <span><FileJson aria-hidden />{translateText(" project.ptrterrain")}</span>
            <span><FileArchive aria-hidden />{translateText(" heightmap.raw")}</span>
            <span><Mountain aria-hidden />{translateText(" tiles/")}</span>
            <span><Layers3 aria-hidden />{translateText(" textures/")}</span>
            <span><Settings2 aria-hidden />{translateText(" splatmaps/")}</span>
          </FolderTree>
          <ExportTip icon={CheckCircle2} title={translateText("Keep the ZIP untouched")}>
            {translateText("The Unity importer safely extracts it into a unique folder below Assets/ProceduralTerrains/Imports.")}
          </ExportTip>
        </ExportLayout>
      </DocSection>

      <DocSection
        id="unity-import"
        titleId="unity-import-title"
        index="04"
        icon={Mountain}
        title={translateText("Import and build")}
        description={translateText("The importer creates a native Unity Terrain hierarchy you can continue editing.")}
      >
        <StepCard steps={[
          { title: 'Open the Terrain Importer', body: 'Go to Window > Procedural Terrains > Terrain Importer.' },
          { title: 'Select your export', body: 'Choose the ZIP produced by Procedural Terrains. The importer validates the document and its artifacts before building.' },
          { title: 'Choose build options', body: 'Keep Create Terrain objects enabled, then choose whether to create pipeline-compatible Terrain Materials and baked TerrainLayers.' },
          { title: 'Import ZIP and Build Scene', body: 'The ZIP is extracted below Assets/ProceduralTerrains/Imports and a Terrain GameObject is created for every exported tile.' },
          { title: 'Rebuild an imported project', body: 'Drag an existing project.ptrterrain TerrainProjectAsset into Already imported, then click Build Terrains in Current Scene.' },
          { title: 'Save the scene', body: 'Review the generated hierarchy, position it in your project, then save your Unity scene.' },
        ]} />

        <GeneratedGrid items={generatedAssets} />

        <Note tone="success" icon={PackageCheck}>
          <strong>{translateText("Rebuild at any time.")}</strong>{translateText(" You can also select an imported TerrainProjectAsset in the importer window and rebuild its Terrain hierarchy.")}
        </Note>
      </DocSection>

      <section aria-labelledby="unity-limitations-title" className="scroll-mt-[88px] border-b border-border py-14 sm:py-16 lg:py-20">
        <SectionHeading
          label={translateText("Alpha scope")}
          titleId="unity-limitations-title"
          title={translateText("What is available today")}
          description={translateText("A clear view of what the current editor plugin handles—and what comes next.")}
        />
        <ScopeGrid>
          <ScopeCard icon={CheckCircle2} title={translateText("Available now")}>
            <li>{translateText("ZIP and .ptrterrain validation")}</li>
            <li>{translateText("TerrainData, colliders and tile neighbors")}</li>
            <li>{translateText("Seeded presets and editable Noise Stacks")}</li>
            <li>{translateText("Fine detail and thermal erosion across tile seams")}</li>
            <li>{translateText("Procedural sand, grass, rock and snow surfaces")}</li>
            <li>{translateText("Live placeholder water in creation and import")}</li>
            <li>{translateText("Saved recipes, load selected and regeneration")}</li>
            <li>{translateText("Baked color and normal TerrainLayer")}</li>
            <li>{translateText("Built-in, URP and HDRP Terrain materials")}</li>
          </ScopeCard>
          <ScopeCard planned icon={Sparkles} title={translateText("Planned next")}>
            <li>{translateText("Runtime terrain generation")}</li>
            <li>{translateText("Full studio biome shader reconstruction")}</li>
            <li>{translateText("Splines and richer water reconstruction")}</li>
            <li>{translateText("Expanded runtime generation tools")}</li>
          </ScopeCard>
        </ScopeGrid>
      </section>

      <FaqSection titleId="unity-faq-title" label={translateText("Help")} title={translateText("Common questions")}>
        <FaqItem question={translateText("Does it work with URP and HDRP?")}>
          {translateText("Yes. Generated materials use Unity's native Terrain shader for the active Built-in, URP or HDRP render pipeline, while baked textures are assigned through a TerrainLayer.")}
        </FaqItem>
        <FaqItem question={translateText("Can I edit the terrain after import?")}>
          {translateText("Yes. The importer builds regular Unity Terrain objects and TerrainData assets, so you can use Unity's standard terrain tools afterward.")}
        </FaqItem>
        <FaqItem question={translateText("Can Unity match Blender-generated terrain?")}>
          {translateText("Yes. Both plugins use the same seeded CPU Noise Stack formulas and presets. Unity adapts the result to native TerrainData and reverses the horizontal generator axis consistently.")}
        </FaqItem>
        <FaqItem question={translateText("Where are imported files stored?")}>
          {translateText("Each ZIP is extracted into its own folder below Assets/ProceduralTerrains/Imports, avoiding accidental overwrites between imports.")}
        </FaqItem>
      </FaqSection>

      <FinalCta
        label={<>{translateText(" Unity package v")}{translateText(UNITY_PACKAGE_VERSION)}</>}
        title={translateText("Bring your next world into Unity.")}
        body={translateText("Install the alpha package, create or import a terrain, and keep building with native Unity tools.")}
        actions={(
          <>
            <DownloadButton block plugin={UNITY_PLUGIN} onDownload={onDownload}><Download aria-hidden />{translateText(" Download plugin")}</DownloadButton>
            <SecondaryButton onClick={onOpenEditor}>{translateText("Open terrain editor ")}<ExternalLink aria-hidden /></SecondaryButton>
          </>
        )}
      />
    </article>
  );
}
