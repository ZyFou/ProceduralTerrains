import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import {
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  ExternalLink,
  FileArchive,
  FileJson,
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

const fieldRow = 'grid min-h-10 grid-cols-[minmax(84px,auto)_minmax(0,1fr)_16px] items-center gap-3 rounded-lg border border-border bg-background/70 px-3 py-2';

export default function BlenderPluginPage({ onOpenEditor, onDownload }) {
  useLanguage();

  return (
    <article className="w-full text-foreground">
      <PluginHero
        titleId="blender-plugin-title"
        eyebrow={translateText(" Blender integration")}
        title={translateText("Your terrains, ")}
        subtitle={translateText("native in Blender.")}
        description={translateText("Generate editor-compatible terrain directly in Blender, or turn exports into editable meshes with aligned tiles, UVs, packed textures, and metadata.")}
        actions={(
          <>
            <DownloadButton block plugin={BLENDER_PLUGIN} onDownload={onDownload}>
              <Download aria-hidden />{translateText(" Download plugin")}</DownloadButton>
            <SecondaryButton onClick={() => scrollToSection('blender-install')}>
              <MonitorDown aria-hidden />{translateText(" Installation guide")}</SecondaryButton>
          </>
        )}
        meta={(
          <>
            <span><PackageCheck aria-hidden />{translateText(" v")}{translateText(BLENDER_PACKAGE_VERSION)}</span>
            <span><ShieldCheck aria-hidden />{translateText(" GPL-3.0-or-later")}</span>
            <span><RefreshCw aria-hidden />{translateText(" Alpha release")}</span>
          </>
        )}
        preview={(
          <PreviewWindow
            label={translateText("Blender terrain creation preview")}
            icon={Boxes}
            title={translateText("Procedural Terrains")}
            subtitle={translateText("3D View · Terrain")}
            badge={translateText("BLENDER 5.2")}
          >
            <div className={fieldRow}>
              <span className="text-xs text-zinc-400">{translateText("Terrain preset")}</span>
              <strong className="truncate text-[13px] font-medium text-zinc-100">{translateText("Highlands · Seed 1337")}</strong>
              <ChevronRight className="size-3.5 text-zinc-400" aria-hidden />
            </div>
            <div className={fieldRow}>
              <span className="text-xs text-zinc-400">{translateText("Dimensions")}</span>
              <strong className="truncate text-[13px] font-medium text-zinc-100">{translateText("1000 × 1000 × 560 m")}</strong>
              <Grid3X3 className="size-3.5 text-zinc-400" aria-hidden />
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/70 p-3 [&>span]:flex [&>span]:items-center [&>span]:gap-2 [&>span]:text-[12.5px] [&>span]:text-zinc-300 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:rounded [&_svg]:bg-zinc-200 [&_svg]:p-0.5 [&_svg]:text-zinc-900">
              <span><Check />{translateText(" 513 × 513 resolution")}</span>
              <span><Check />{translateText(" Smooth shading")}</span>
              <span><Check />{translateText(" Procedural surfaces")}</span>
            </div>
            <PreviewChecks>
              <span><CheckCircle2 />{translateText(" Deterministic Noise Stack")}</span>
              <span><CheckCircle2 />{translateText(" Seamless tiled coordinates")}</span>
            </PreviewChecks>
            <PreviewGenerate icon={Zap}>{translateText(" Generate Terrain")}</PreviewGenerate>
          </PreviewWindow>
        )}
      />

      <CompatibilityStrip label={translateText("Plugin compatibility")}>
        <CompatItem title={<>{translateText("Blender ")}{translateText(BLENDER_VERSION)}+</>} caption={translateText("Manifest-based extension")} />
        <CompatItem title={translateText("Eevee · Cycles")} caption={translateText("Principled baked materials")} />
        <CompatItem title={translateText("Create + Import")} caption={translateText("Noise Stack and validated packages")} />
      </CompatibilityStrip>

      <QuickStart
        titleId="blender-quickstart-title"
        label={translateText("Quick start")}
        title={translateText("Create terrain or continue an exported world")}
        description={translateText("Native generation and package import both produce editable Blender geometry.")}
        steps={quickSteps}
      />

      <DocSection
        id="blender-install"
        titleId="blender-install-title"
        index="01"
        icon={PackagePlus}
        title={translateText("Install the plugin")}
        description={translateText("The download is a ready-to-install Blender extension. Keep the ZIP intact.")}
      >
        <MethodCard recommended icon={Download} title={translateText("Install from Disk")} caption={translateText("Blender 5.2")}>
          <StepList steps={[
            { title: 'Download the extension ZIP', body: `Do not extract procedural-terrains-blender-${BLENDER_PACKAGE_VERSION}.zip.` },
            { title: 'Open Blender Preferences', body: 'Go to Edit > Preferences > Get Extensions.' },
            { title: 'Choose Install from Disk', body: 'Open the extensions menu, select Install from Disk, then choose the downloaded ZIP.' },
            { title: 'Enable Procedural Terrains', body: 'If needed, enable the extension. Its tools appear in File > Import and the 3D View Terrain sidebar.' },
          ]} />
          <div className="mt-6">
            <DownloadButton plugin={BLENDER_PLUGIN} onDownload={onDownload}>
              <Download aria-hidden />{translateText(" Download v")}{translateText(BLENDER_PACKAGE_VERSION)}
            </DownloadButton>
          </div>
        </MethodCard>
        <Note icon={CircleAlert}>
          <strong>{translateText("Version requirement.")}</strong>{translateText(" This build targets Blender ")}{translateText(BLENDER_VERSION)}{translateText(" and uses the current extension manifest format. Earlier Blender releases are not supported by this package.")}
        </Note>
      </DocSection>

      <DocSection
        id="blender-create"
        titleId="blender-create-title"
        index="02"
        icon={Sparkles}
        title={translateText("Create native terrain")}
        description={translateText("Build an editable tiled mesh directly from a deterministic recipe.")}
      >
        <MethodCard recommended icon={Mountain} title={translateText("Create a new terrain")} caption={translateText("Blender-native workflow")}>
          <StepList steps={[
            { title: 'Open the Terrain sidebar', body: 'In the 3D View, press N to open the Sidebar, choose Terrain, then select the Create workflow.' },
            { title: 'Choose the quick setup', body: 'Select one of the eight Terrain presets, click Apply, and set the deterministic seed, width, depth, maximum height, tile grid, and mesh resolution.' },
            { title: 'Set placement and shading', body: 'Center the assembly at World Origin or the 3D Cursor, then choose smooth shading and the editable procedural sand, grass, rock and snow material.' },
            { title: 'Customize the Noise Stack', body: 'Open Advanced Noise Stack to apply a stack preset or add, duplicate, reorder, and remove layers. Each layer exposes its blend, parameters, seed offset, and height, noise, slope, or biome masks.' },
            { title: 'Check density', body: 'Review Estimated vertices. Blender warns above one million vertices and blocks recipes above sixteen million.' },
            { title: 'Generate Terrain', body: 'The extension creates a collection of ordinary mesh tiles with UVs, smooth shading, procedural surface nodes, placeholder water, tile metadata, and the complete saved recipe.' },
          ]} />
        </MethodCard>
        <MethodCard icon={RefreshCw} title={translateText("Edit and regenerate")} caption={translateText("Preserve the collection")}>
          <StepList steps={[
            { title: 'Select a generated tile', body: 'Choose any tile inside a collection created by the extension.' },
            { title: 'Load Selected', body: 'Click Load Selected to restore the collection recipe into the Create controls.' },
            { title: 'Adjust the recipe', body: 'Change presets, seed, dimensions, resolution, layers, masks, placement, fine detail, thermal erosion, surface settings, or water.' },
            { title: 'Regenerate Selected', body: 'The extension replaces generated tile geometry while keeping the collection and any unrelated objects inside it.' },
          ]} />
        </MethodCard>
        <Note tone="success" icon={CheckCircle2}>
          <strong>{translateText("Unity parity.")}</strong>{translateText(" Blender and Unity use the same seeded CPU Noise Stack formulas and presets. Generated tile borders share global sample coordinates, so their edge vertices remain identical.")}
        </Note>
        <Note icon={CircleAlert}>
          <strong>{translateText("Work light, finish dense.")}</strong>{translateText(" Use 129 or 257 while shaping. Regenerate at 513 or 1025 only when the extra mesh density is useful.")}
        </Note>
      </DocSection>

      <DocSection
        id="blender-export"
        titleId="blender-export-title"
        index="03"
        icon={UploadCloud}
        title={translateText("Export for Blender")}
        description={translateText("The Blender production preset creates authoritative heightfields and baked surface maps.")}
      >
        <StepCard steps={[
          { title: 'Finish your terrain in Tile mode', body: 'Runtime document v1 supports studio terrain with square tile assemblies.' },
          { title: 'Open the Export panel', body: 'Select Export in the editor toolbar, then open Production Preset.' },
          { title: 'Choose Blender Scene', body: 'The preset enables vertex-grid RAW heightfields, separate tiles, color and normal maps, and biome splat data.' },
          { title: 'Choose a height grid', body: '1025 × 1025 preserves high source detail; the Blender importer can build a lighter editable mesh from it.' },
          { title: 'Export Terrain', body: 'Save the generated Blender terrain ZIP without changing its internal structure.' },
        ]} />
        <ExportLayout>
          <FolderTree root={translateText("Blender/")}>
            <span><FileJson aria-hidden />{translateText(" project.ptrterrain")}</span>
            <span><FileArchive aria-hidden />{translateText(" heightmap.raw")}</span>
            <span><Mountain aria-hidden />{translateText(" tiles/")}</span>
            <span><Layers3 aria-hidden />{translateText(" textures/")}</span>
            <span><Settings2 aria-hidden />{translateText(" splatmaps/")}</span>
          </FolderTree>
          <ExportTip icon={CheckCircle2} title={translateText("Source detail stays authoritative")}>
            {translateText("The importer can create a 129, 257, 513, 1025, or full-resolution mesh without changing the exported heightfield.")}
          </ExportTip>
        </ExportLayout>
      </DocSection>

      <DocSection
        id="blender-import"
        titleId="blender-import-title"
        index="04"
        icon={Workflow}
        title={translateText("Import and build")}
        description={translateText("Create a clean collection of native meshes you can sculpt, shade, modify, and render.")}
      >
        <StepCard steps={[
          { title: 'Open the importer', body: 'Choose File > Import > Procedural Terrains, or open 3D View > Sidebar > Terrain.' },
          { title: 'Select the export ZIP', body: 'The extension validates the archive, runtime document, artifact paths, and heightfield sizes before creating scene data.' },
          { title: 'Choose Mesh detail', body: 'Automatic uses up to 513 × 513 vertices per tile. Full source resolution is available for intentional high-density workflows.' },
          { title: 'Choose dimensions', body: 'Keep Source Dimensions for a faithful handoff, or choose Custom Dimensions and enter a new total width and depth. Vertical Scale controls elevation independently.' },
          { title: 'Choose placement', body: 'Center the complete assembly at World Origin or the 3D Cursor. The source minimum elevation maps to the selected placement height.' },
          { title: 'Choose materials and selection', body: 'Enable baked materials, smooth shading, packed images, and automatic tile selection as needed. ZIP textures are packed before temporary extraction is removed.' },
          { title: 'Import and Build', body: 'Blender creates positioned mesh tiles, UVs, baked materials, packed images, and source metadata in one undoable operation.' },
        ]} />
        <GeneratedGrid items={generatedAssets} />
        <Note tone="success" icon={PackageCheck}>
          <strong>{translateText("Ready for Blender tools.")}</strong>{translateText(" The result is ordinary mesh geometry with standard UV and Principled material data—not a locked custom object type.")}
        </Note>
      </DocSection>

      <section aria-labelledby="blender-limitations-title" className="scroll-mt-[88px] border-b border-border py-14 sm:py-16 lg:py-20">
        <SectionHeading
          label={translateText("Alpha scope")}
          titleId="blender-limitations-title"
          title={translateText("Built for reliable terrain handoff")}
          description={translateText("Native generation and faithful baked reconstruction both remain fully editable.")}
        />
        <ScopeGrid>
          <ScopeCard icon={CheckCircle2} title={translateText("Available now")}>
            <li>{translateText("Secure ZIP and .ptrterrain validation")}</li>
            <li>{translateText("Native seeded Noise Stack terrain generation")}</li>
            <li>{translateText("Fine detail and assembly-wide thermal erosion")}</li>
            <li>{translateText("Procedural sand, grass, rock and snow surfaces")}</li>
            <li>{translateText("Live placeholder water in creation and import")}</li>
            <li>{translateText("Custom dimensions and origin/cursor placement")}</li>
            <li>{translateText("Tiled editable mesh reconstruction")}</li>
            <li>{translateText("Aligned UVs and baked normal materials")}</li>
            <li>{translateText("Packed images and source custom properties")}</li>
          </ScopeCard>
          <ScopeCard planned icon={Sparkles} title={translateText("Planned next")}>
            <li>{translateText("Detailed biome shader reconstruction")}</li>
            <li>{translateText("Advanced water shaders and splines")}</li>
            <li>{translateText("Non-destructive reimport workflows")}</li>
            <li>{translateText("Node graph and hydraulic erosion authoring")}</li>
          </ScopeCard>
        </ScopeGrid>
      </section>

      <FaqSection titleId="blender-faq-title" label={translateText("Help")} title={translateText("Common questions")}>
        <FaqItem question={translateText("Can I sculpt or modify the imported terrain?")}>
          {translateText("Yes. Every tile is a standard Blender mesh, so sculpting, modifiers, Geometry Nodes, material edits, and regular mesh operations remain available.")}
        </FaqItem>
        <FaqItem question={translateText("Can I create terrain without exporting first?")}>
          {translateText("Yes. The Create workflow includes seeded presets and an advanced editable Noise Stack, tiled dimensions, regeneration, and an editable procedural sand, grass, rock and snow material.")}
        </FaqItem>
        <FaqItem question={translateText("Why does Automatic use 513 × 513 vertices?")}>
          {translateText("It keeps the mesh responsive while sampling the complete exported height range. You can choose 1025 or Full source resolution when you need denser geometry.")}
        </FaqItem>
        <FaqItem question={translateText("Are ZIP textures kept after import?")}>
          {translateText("Yes. Texture images loaded from ZIP packages are packed into the current .blend before the temporary extraction folder is removed.")}
        </FaqItem>
        <FaqItem question={translateText("How are axes converted?")}>
          {translateText("The right-handed mapping is source (X, Y, Z) to Blender (X, -Z, Y). This moves height to Blender Z while units remain meters.")}
        </FaqItem>
      </FaqSection>

      <FinalCta
        label={<>{translateText(" Blender extension v")}{translateText(BLENDER_PACKAGE_VERSION)}</>}
        title={translateText("Bring your next world into Blender.")}
        body={translateText("Install the extension, create or import a terrain, and continue with native Blender tools.")}
        actions={(
          <>
            <DownloadButton block plugin={BLENDER_PLUGIN} onDownload={onDownload}><Download aria-hidden />{translateText(" Download plugin")}</DownloadButton>
            <SecondaryButton onClick={onOpenEditor}>{translateText("Open terrain editor ")}<ExternalLink aria-hidden /></SecondaryButton>
          </>
        )}
      />
    </article>
  );
}
