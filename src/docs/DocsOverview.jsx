import { ArrowRight, Box, Globe2, Layers3, Orbit } from 'lucide-react';
import { translateText as t, useLanguage } from '../i18n/LanguageContext.jsx';
import packageInfo from '../../packages/procedural-terrains/package.json';
import { Badge } from '@/components/shadcn/badge.jsx';
import { Button } from '@/components/shadcn/button.jsx';
import { SectionLabel } from '../landing/home/HomeView.jsx';
import CodeBlock from './CodeBlock.jsx';
import { docsHref } from './docsPages.js';

const quickStart = `import { createTerrain } from 'procedural-terrains';

const terrain = await createTerrain({
  renderer,
  configuration: {
    layout: { chunkCount: 8, chunkSize: 128 },
    source: { kind: 'noise', seed: 1337 },
    heightScale: 560,
  },
});
scene.add(terrain.object);
await terrain.prepare(camera);

function frame(deltaSeconds) {
  terrain.update(deltaSeconds, { camera });
  renderer.render(scene, camera);
}
// When your scene closes:
terrain.dispose();`;

const WORLDS = [[Box, 'Tile', 'Finite terrain'], [Globe2, 'Infinite World', 'Camera-centred streaming'], [Orbit, 'Planet', 'Cube-sphere terrain'], [Layers3, 'Mini', 'Cutaway dioramas']];

export default function DocsOverview() {
  const { language } = useLanguage();
  const fr = language === 'fr';
  return (
    <div className="docs-overview docs-markdown">
      <header className="docs-hero flex flex-col items-start">
        <Badge variant="outline" className="h-6 rounded-full border-white/10 bg-white/[0.03] px-2.5 font-mono text-[11px] font-normal text-zinc-400">
          procedural-terrains · v{packageInfo.version}
        </Badge>
        <h1 className="mt-5 mb-0 max-w-[720px] text-[clamp(30px,3.2vw,44px)] leading-[1.06] font-semibold tracking-[-0.035em] text-foreground">
          {fr ? 'Vos terrains. Votre scène Three.js.' : 'Your terrain. Your Three.js scene.'}
        </h1>
        <p className="mt-4 mb-0 max-w-[600px] text-[15px] leading-relaxed text-zinc-400">
          {fr ? 'Le moteur du studio dans un package ESM typé : terrains finis, mondes infinis, planètes et dioramas Mini, avec eau et nuages à la demande.' : 'The studio runtime in a typed ESM package: finite terrain, infinite worlds, planets and Mini dioramas, with optional water and clouds.'}
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button asChild className="h-[38px] rounded-[10px] px-4">
            <a href={docsHref('getting-started')}>{t('Getting started')}<ArrowRight aria-hidden /></a>
          </Button>
          <Button asChild variant="outline" className="h-[38px] rounded-[10px] px-4 text-foreground">
            <a href={docsHref('playground')}>{t('Open playground')}<ArrowRight aria-hidden /></a>
          </Button>
        </div>
      </header>

      <figure className="docs-terrain-preview mt-9 mb-0 overflow-hidden rounded-xl border border-border bg-card bg-dots p-1.5">
        <img
          src={new URL('../../docs/images/mini-terrain.png', import.meta.url).href}
          alt={fr ? 'Diorama Mini Terrain avec eau et nuages' : 'Mini Terrain diorama with water and clouds'}
          className="block max-h-[340px] w-full rounded-lg object-cover"
        />
      </figure>

      <section className="mt-10 flex flex-col gap-4">
        <SectionLabel>{t('Worlds and sources')}</SectionLabel>
        <div className="docs-world-cards grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
          {WORLDS.map(([Icon, name, description]) => (
            <a
              href={docsHref('worlds')}
              key={name}
              className="group/card relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card bg-dots-lg p-4 no-underline transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-[0_10px_30px_-12px_rgb(59_130_246/0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span className="grid size-9 place-items-center rounded-lg border border-border bg-background text-zinc-300 transition-colors group-hover/card:text-blue-300">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <span className="flex flex-col gap-1">
                <strong className="text-sm font-medium text-foreground">{name}</strong>
                <small className="text-[13px] leading-snug text-zinc-400">{t(description)}</small>
              </span>
            </a>
          ))}
        </div>
      </section>

      <h2>{fr ? 'Un moteur qui s’intègre à votre application' : 'A runtime that fits your application'}</h2>
      <p>{fr ? 'Vous gardez la scène, la caméra, le renderer et la boucle d’animation. Le package fournit la géométrie, le bruit procédural, les shaders et le LOD. React et le backend du studio ne sont pas nécessaires.' : 'You own the scene, camera, renderer and animation loop. The package provides geometry, procedural noise, shaders and LOD. React and the studio backend are not required.'}</p>
      <CodeBlock code={quickStart} lang="js" />
      <CodeBlock code="npm install procedural-terrains" lang="sh" />
      <blockquote><p>{fr ? 'Three.js ~0.185.1 est une dépendance pair ; npm l’installe automatiquement si nécessaire.' : 'Three.js ~0.185.1 is a peer dependency; npm installs it automatically when needed.'}</p></blockquote>
      <p><a href={docsHref('code-export')} className="inline-flex items-center gap-1.5">{t('Studio and code export')}<ArrowRight className="size-[13px]" aria-hidden /></a></p>
    </div>
  );
}
