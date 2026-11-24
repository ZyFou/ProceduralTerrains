import React from 'react';
import { ArrowRight, Clock, CloudCheck, CloudOff, Copy, EllipsisVertical, Eye, FolderOpen, Globe2, LayoutTemplate, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { translateText, useLanguage } from '@/i18n/LanguageContext.jsx';
import { formatRelativeTime } from '@/i18n/language.js';
import { APP_NAME, APP_VERSION } from '@/constants/app.js';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/shadcn/badge.jsx';
import { Button } from '@/components/shadcn/button.jsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/shadcn/dropdown-menu.jsx';
import MatrixButton from '@/components/matrix/MatrixButton.jsx';

const VISIBILITY_ICONS = { private: Lock, unlisted: Eye, public: Globe2 };

/** Section title — sentence case, tight tracking. The v3.1 heading style. */
export function SectionLabel({ children, className }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-[15px] font-semibold tracking-[-0.015em] text-foreground', className)}>
      {children}
    </span>
  );
}

function projectKind(project) {
  if (project.terrain.miniTerrain) return 'Mini terrain';
  if (project.terrain.workspacePreset === 'real-terrain') return 'Real terrain';
  if (project.terrain.editorMode === 'nodes') return 'Nodes';
  if (project.terrain.editorMode === 'manual') return 'Manual';
  return 'Procedural';
}

function ProjectCard({ project, cloudEntry, disabled, busy, onOpen, onRename, onDuplicate, onDelete }) {
  const cloudProject = cloudEntry?.cloudProject;
  const isSynced = cloudEntry?.state === 'synced';
  const SyncIcon = isSynced ? CloudCheck : CloudOff;
  const VisibilityIcon = VISIBILITY_ICONS[cloudProject?.visibility] || Lock;
  const syncLabel = isSynced ? 'Synced to cloud' : 'Not synced to cloud';
  const visibilityLabel = cloudProject?.visibility ? `Cloud visibility: ${cloudProject.visibility}` : '';
  const thumbnail = project.metadata.thumbnail;

  return (
    <article
      className={cn(
        // No overflow-hidden / will-change here: clipping a composited, lifting
        // card made Chrome drop the rounded corners mid-hover. The thumbnail
        // clips itself instead, which also leaves room for the hover ring.
        'lp-ring group/card relative rounded-[14px] border border-white/[0.08] bg-gradient-to-b from-[#0e0f13] to-[#0a0b0e]',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_1px_2px_rgb(0_0_0/0.4)]',
        // Tailwind v4 lifts with the `translate` property, so it must be in the transition list.
        'transition-[translate,border-color,box-shadow] duration-[400ms] ease-[cubic-bezier(.22,1,.36,1)]',
        'hover:-translate-y-[3px] hover:border-white/[0.16] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_18px_40px_-18px_rgb(0_0_0/0.9)]',
        'has-[[data-state=open]]:border-white/[0.16] motion-reduce:hover:translate-y-0',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(project)}
        disabled={disabled}
        className="flex w-full flex-col rounded-[13px] text-left outline-none disabled:opacity-60"
      >
        <span className="relative block aspect-[16/10] w-full overflow-hidden rounded-t-[13px] [clip-path:inset(0_round_13px_13px_0_0)] border-b border-white/[0.06] bg-[radial-gradient(120%_100%_at_50%_0%,#1a1b21_0%,#0f1014_70%)]">
          {thumbnail
            ? <img src={thumbnail} alt="" className="size-full object-cover transition-[scale] duration-[600ms] ease-[cubic-bezier(.22,1,.36,1)] group-hover/card:scale-[1.035]" />
            : <span className="grid size-full place-items-center text-muted-foreground"><LayoutTemplate className="size-5" /></span>}
          <span
            role="img"
            title={translateText(visibilityLabel ? `${syncLabel} · ${visibilityLabel}` : syncLabel)}
            aria-label={translateText(visibilityLabel ? `${syncLabel}. ${visibilityLabel}.` : syncLabel)}
            className={cn(
              'absolute top-2.5 left-2.5 inline-flex h-6 items-center gap-1 rounded-full border px-2',
              isSynced ? 'border-white/10 bg-[#0a0b0e]/75 text-blue-300' : 'border-white/10 bg-[#0a0b0e]/75 text-zinc-400',
            )}
          >
            <SyncIcon className="size-3" aria-hidden />
            {cloudProject && <VisibilityIcon className="size-3" aria-hidden />}
          </span>
        </span>
        <span className="flex min-w-0 flex-col gap-1 px-3.5 pt-3 pb-3.5 pr-10">
          <strong className="truncate text-sm font-semibold text-white">{project.metadata.name}</strong>
          <span className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors group-hover/card:text-zinc-300">
            <span className="truncate">{translateText(projectKind(project))}</span>
            <span className="size-0.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
            <Clock className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{translateText(formatRelativeTime(project.metadata.modified))}</span>
          </span>
        </span>
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-2 bottom-2.5 size-7 text-muted-foreground transition-[opacity,background-color,color] duration-200 data-[state=open]:bg-accent data-[state=open]:text-foreground"
            aria-label={translateText(`Actions for ${project.metadata.name}`)}
          >
            <EllipsisVertical className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem disabled={disabled} onSelect={() => onOpen(project)}><FolderOpen />{translateText('Open')}</DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => onRename(project)}><Pencil />{translateText('Rename')}</DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => onDuplicate(project)}><Copy />{translateText('Duplicate')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onDelete(project)}><Trash2 />{translateText('Delete')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}

function EmptyProjects({ ready, onCreate }) {
  return (
    <div className="relative flex flex-col items-start gap-4 overflow-hidden rounded-xl border border-dashed border-border bg-card/60 bg-dots-lg p-6">
      <span className="grid size-10 place-items-center rounded-lg border border-border bg-background text-muted-foreground">
        <FolderOpen className="size-[18px]" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <strong className="text-sm font-medium text-foreground">{translateText('No projects yet')}</strong>
        <span className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">{translateText('Create a terrain from a template or drop a project file anywhere on this page.')}</span>
      </div>
      <Button variant="outline" size="sm" onClick={onCreate} disabled={!ready}><Plus />{translateText('Create terrain')}</Button>
    </div>
  );
}

export default function HomeView({
  projects, cloudEntries, ready, booting, exiting, busy,
  onCreate, onBrowseTemplates, onViewAll, onOpen, onRename, onDuplicate, onDelete,
}) {
  useLanguage();
  const disabled = !ready || exiting;
  const createLabel = exiting ? 'Opening editor' : booting ? 'Loading shaders' : 'Create terrain';

  return (
    <div className="ui flex flex-col gap-9 font-sans">
      <section className="flex flex-col items-start pt-4">
        <Badge variant="outline" className="h-6 rounded-full border-white/10 bg-white/[0.03] px-2.5 text-[11.5px] font-medium text-zinc-400">
          v{APP_VERSION}
        </Badge>
        <h1 className="mt-5 text-[clamp(32px,3.3vw,46px)] leading-[1.04] font-semibold tracking-[-0.035em] text-foreground">
          {translateText('Craft stunning worlds')}
          <br />
          <span className="text-muted-foreground">{translateText('with procedural power.')}</span>
        </h1>
        <p className="mt-4 max-w-[430px] text-[15px] leading-relaxed text-muted-foreground">
          {translateText(APP_NAME)}{translateText(' helps you generate, shape, and texture terrain for your projects.')}
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <MatrixButton
            theme="light"
            size="sm"
            loading={booting || exiting}
            loadingLabel={translateText(createLabel)}
            disabled={!booting && !exiting && disabled}
            onClick={onCreate}
            className="[&::part(button)]:text-sm [&::part(button)]:font-semibold"
            style={{ '--mb-radius': '10px' }}
          >
            {translateText('Create terrain')}
          </MatrixButton>
          <Button variant="outline" className="h-[38px] rounded-[10px] px-4" onClick={onBrowseTemplates}>
            <LayoutTemplate />{translateText('Browse templates')}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <SectionLabel>{translateText('Recent projects')}</SectionLabel>
          {projects.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onViewAll}>
              {translateText('View all')}<ArrowRight className="size-3" aria-hidden />
            </Button>
          )}
        </div>
        {projects.length
          ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 min-[1360px]:grid-cols-4">
              {projects.slice(0, 8).map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  cloudEntry={cloudEntries.get(project.id)}
                  disabled={disabled}
                  busy={busy}
                  onOpen={onOpen}
                  onRename={onRename}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )
          : <EmptyProjects ready={!disabled} onCreate={onCreate} />}
      </section>
    </div>
  );
}
