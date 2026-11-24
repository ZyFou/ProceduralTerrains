import React from 'react';
import { ArrowRight, Check, ChevronRight, FolderOpen } from 'lucide-react';
import { translateText, useLanguage } from '@/i18n/LanguageContext.jsx';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/shadcn/badge.jsx';
import { Button } from '@/components/shadcn/button.jsx';
import MatrixButton from '@/components/matrix/MatrixButton.jsx';
import { SectionLabel } from '@/landing/home/HomeView.jsx';

/* Shared v3 building blocks for the Unity / Blender plugin documentation pages.
 * Both pages keep their own copy and translateText calls; these only own layout. */

// Clears the sticky engine tab bar when a section is scrolled into view.
const SECTION = 'scroll-mt-[88px] border-b border-border py-14 sm:py-16 lg:py-20';
const ICON_TILE = 'grid shrink-0 place-items-center rounded-lg border border-border bg-muted text-zinc-200';

export function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
}

/** Id of the DownloadButton whose download is in flight (provided by PluginsPage). */
export const DownloadStatusContext = React.createContext(null);

/**
 * Plugin download on the LED matrix button. `onDownload(plugin, buttonId)` lets
 * PluginsPage track which button started the download, so only that one spins.
 */
export function DownloadButton({ plugin, onDownload, block = false, children }) {
  useLanguage();
  const buttonId = React.useId();
  const loading = React.useContext(DownloadStatusContext) === buttonId;
  return (
    // The legacy global `* { margin: 0 }` outranks the component's ::slotted(svg) spacing.
    <MatrixButton
      theme="light"
      size="sm"
      block={block}
      loading={loading}
      loadingLabel={translateText('Downloading…')}
      onClick={() => onDownload(plugin, buttonId)}
      className="[&>svg]:mr-[0.45em]"
      style={{ '--mb-radius': '10px' }}
    >
      {children}
    </MatrixButton>
  );
}

export function SecondaryButton({ onClick, className, children }) {
  return (
    <Button variant="outline" className={cn('h-[38px] rounded-[10px] px-4 text-[13.5px]', className)} onClick={onClick}>
      {children}
    </Button>
  );
}

export function PluginHero({ titleId, eyebrow, title, subtitle, description, actions, meta, preview }) {
  return (
    <section
      aria-labelledby={titleId}
      className="grid items-center gap-12 py-12 sm:py-16 lg:min-h-[540px] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-[clamp(44px,6vw,80px)]"
    >
      <div className="flex min-w-0 flex-col items-start">
        <SectionLabel>{eyebrow}</SectionLabel>
        <h1 id={titleId} className="mt-5 max-w-[640px] text-[clamp(36px,5vw,60px)] leading-[1.03] font-semibold tracking-[-0.04em] text-foreground">
          {title}
          <br />
          <span className="text-muted-foreground">{subtitle}</span>
        </h1>
        <p className="mt-5 max-w-[560px] text-[15px] leading-relaxed text-zinc-400 sm:text-base">{description}</p>
        <div className="mt-8 grid w-full grid-cols-1 gap-3 min-[440px]:flex min-[440px]:w-auto min-[440px]:flex-wrap min-[440px]:items-center">
          {actions}
        </div>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-zinc-400 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5 [&_svg]:size-3.5 [&_svg]:text-brand">
          {meta}
        </div>
      </div>
      {preview}
    </section>
  );
}

/** Mock editor window shown next to the hero copy. */
export function PreviewWindow({ label, icon: Icon, title, subtitle, badge, children }) {
  return (
    <div
      aria-label={label}
      className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-[0_30px_80px_-30px_rgb(0_0_0/0.85)]"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className={cn(ICON_TILE, 'size-8')}><Icon className="size-4" aria-hidden /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <strong className="truncate text-[13.5px] font-medium text-foreground">{title}</strong>
          <small className="truncate text-xs text-zinc-400">{subtitle}</small>
        </div>
        <Badge variant="outline" className="h-6 font-mono text-[11px] font-normal tracking-[0.08em] text-zinc-300">{badge}</Badge>
      </div>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </div>
  );
}

export function PreviewChecks({ children }) {
  return (
    <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 [&>span]:flex [&>span]:items-center [&>span]:gap-2 [&>span]:text-[12.5px] [&>span]:text-zinc-300 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-brand">
      {children}
    </div>
  );
}

export function PreviewGenerate({ icon: Icon, children }) {
  return (
    <div className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground">
      <Icon className="size-3.5" aria-hidden />{children}
    </div>
  );
}

export function CompatibilityStrip({ label, children }) {
  return (
    <div aria-label={label} className="grid grid-cols-1 border-y border-border sm:grid-cols-3">
      {children}
    </div>
  );
}

export function CompatItem({ title, caption }) {
  return (
    <span className="flex flex-col gap-1 border-b border-border py-4 last:border-b-0 sm:border-r sm:border-b-0 sm:px-6 sm:py-5 sm:first:pl-0 sm:last:border-r-0">
      <strong className="text-sm font-medium text-foreground">{title}</strong>
      <small className="text-[13px] text-zinc-400">{caption}</small>
    </span>
  );
}

export function SectionHeading({ label, titleId, title, description }) {
  return (
    <div className="flex max-w-[680px] flex-col items-start">
      <SectionLabel>{label}</SectionLabel>
      <h2 id={titleId} className="mt-4 text-[clamp(26px,3vw,38px)] leading-[1.12] font-semibold tracking-[-0.03em] text-foreground">{title}</h2>
      {description && <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">{description}</p>}
    </div>
  );
}

export function QuickStart({ titleId, label, title, description, steps }) {
  useLanguage();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <SectionHeading label={label} titleId={titleId} title={title} description={description} />
      <div className="mt-10 grid gap-3 md:grid-cols-3">
        {steps.map(({ icon: Icon, ...step }) => (
          <button
            type="button"
            onClick={() => scrollToSection(step.target)}
            key={step.label}
            className="group/step flex min-h-[220px] flex-col items-start rounded-xl border border-border bg-card p-5 text-left outline-none transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-[0_10px_30px_-12px_rgb(59_130_246/0.35)] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:hover:translate-y-0"
          >
            <span className="flex w-full items-center justify-between">
              <span className="font-mono text-xs tracking-[0.14em] text-zinc-400">{translateText(step.label)}</span>
              <span className={cn(ICON_TILE, 'size-10 transition-colors group-hover/step:border-brand/40 group-hover/step:text-blue-300')}>
                <Icon className="size-[18px]" aria-hidden />
              </span>
            </span>
            <h3 className="mt-6 text-base font-medium text-foreground">{translateText(step.title)}</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-400">{translateText(step.body)}</p>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-[13px] text-zinc-300 transition-colors group-hover/step:text-blue-300">
              {translateText("Read the guide ")}<ArrowRight className="size-3.5 transition-transform group-hover/step:translate-x-0.5" aria-hidden />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function DocSection({ id, titleId, index, icon: Icon, title, description, children }) {
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(SECTION, 'grid gap-8 lg:grid-cols-[minmax(220px,0.62fr)_minmax(0,1.65fr)] lg:gap-[clamp(48px,7vw,104px)]')}
    >
      <div className="flex flex-col items-start gap-4 self-start lg:sticky lg:top-[88px]">
        <SectionLabel>{index}</SectionLabel>
        <div className="flex items-start gap-3">
          <span className={cn(ICON_TILE, 'size-10')}><Icon className="size-[18px]" aria-hidden /></span>
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id={titleId} className="text-2xl leading-tight font-semibold tracking-[-0.025em] text-foreground">{title}</h2>
            <p className="max-w-[560px] text-sm leading-relaxed text-zinc-400 lg:max-w-[280px]">{description}</p>
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

export function MethodCard({ icon: Icon, title, caption, recommended = false, children }) {
  return (
    <div className={cn('min-w-0 rounded-xl border bg-card p-5 sm:p-6', recommended ? 'border-brand/30' : 'border-border')}>
      <div className="flex items-center gap-3">
        <span className={cn(ICON_TILE, 'size-9', recommended && 'border-brand/30 text-blue-300')}><Icon className="size-[17px]" aria-hidden /></span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <strong className="text-[15px] font-medium text-foreground">{title}</strong>
          <small className="text-[12.5px] text-zinc-400">{caption}</small>
        </div>
      </div>
      {children}
    </div>
  );
}

export function StepList({ steps, className }) {
  useLanguage();
  return (
    <ol className={cn('mt-6 flex flex-col', className)}>
      {steps.map((step, index) => (
        <li key={step.title} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-4 pb-6 last:pb-0">
          {index < steps.length - 1 && <span className="absolute top-8 bottom-1 left-[13.5px] w-px bg-border" aria-hidden />}
          <span className="relative grid size-7 place-items-center rounded-md border border-border bg-muted font-mono text-xs text-zinc-300">{translateText(index + 1)}</span>
          <div className="flex min-w-0 flex-col gap-1 pt-1">
            <strong className="text-sm font-medium text-foreground">{translateText(step.title)}</strong>
            <p className="text-[13.5px] leading-relaxed text-zinc-400 [overflow-wrap:anywhere]">{translateText(step.body)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A step list without a method heading, still framed as a card. */
export function StepCard({ steps }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-6">
      <StepList steps={steps} className="mt-0" />
    </div>
  );
}

export function Note({ tone = 'caution', icon: Icon, children }) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3.5">
      <Icon className={cn('mt-0.5 size-[18px]', tone === 'success' ? 'text-brand' : 'text-amber-300')} aria-hidden />
      <p className="text-[13.5px] leading-relaxed text-zinc-400 [overflow-wrap:anywhere] [&_strong]:font-medium [&_strong]:text-zinc-100">{children}</p>
    </div>
  );
}

export function ExportLayout({ children }) {
  return <div className="grid gap-3 md:grid-cols-2">{children}</div>;
}

export function FolderTree({ root, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-background p-5 font-mono text-[13px] text-zinc-400 [&>span]:flex [&>span]:items-center [&>span]:gap-2 [&>span]:pl-6 [&>span_svg]:size-3.5 [&>span_svg]:shrink-0 [&>span_svg]:text-zinc-500">
      <div className="flex items-center gap-2 text-zinc-200">
        <FolderOpen className="size-[15px] shrink-0 text-brand" aria-hidden /><strong className="font-medium">{root}</strong>
      </div>
      {children}
    </div>
  );
}

export function ExportTip({ icon: Icon, title, children }) {
  return (
    <div className="grid grid-cols-[22px_minmax(0,1fr)] content-center gap-3 rounded-xl border border-border bg-card p-5">
      <Icon className="mt-0.5 size-[18px] text-brand" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1.5">
        <strong className="text-sm font-medium text-foreground">{title}</strong>
        <p className="text-[13.5px] leading-relaxed text-zinc-400 [overflow-wrap:anywhere]">{children}</p>
      </div>
    </div>
  );
}

export function GeneratedGrid({ items }) {
  useLanguage();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map(([label, Icon]) => (
        <div key={label} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-card p-2.5">
          <span className={cn(ICON_TILE, 'size-8 rounded-md')}><Icon className="size-4" aria-hidden /></span>
          <strong className="text-[13.5px] font-medium text-zinc-200">{translateText(label)}</strong>
          <Check className="size-3.5 text-brand" aria-hidden />
        </div>
      ))}
    </div>
  );
}

export function ScopeGrid({ children }) {
  return <div className="mt-10 grid gap-3 md:grid-cols-2">{children}</div>;
}

export function ScopeCard({ icon: Icon, title, planned = false, children }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-6">
      <span className={cn(ICON_TILE, 'size-10', planned ? 'text-zinc-400' : 'border-brand/30 text-blue-300')}>
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <h3 className="mt-5 text-base font-medium text-foreground">{title}</h3>
      <ul
        className={cn(
          'mt-4 flex flex-col gap-2.5 text-[14px] leading-snug',
          '[&>li]:relative [&>li]:pl-4 [&>li]:before:absolute [&>li]:before:top-[0.5em] [&>li]:before:left-0 [&>li]:before:size-1.5 [&>li]:before:rounded-full',
          planned ? 'text-zinc-400 [&>li]:before:bg-zinc-600' : 'text-zinc-300 [&>li]:before:bg-zinc-400',
        )}
      >
        {children}
      </ul>
    </div>
  );
}

export function FaqSection({ titleId, label, title, children }) {
  return (
    <section aria-labelledby={titleId} className={cn(SECTION, 'grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-[clamp(40px,7vw,100px)]')}>
      <SectionHeading label={label} titleId={titleId} title={title} />
      <div className="flex min-w-0 flex-col">{children}</div>
    </section>
  );
}

export function FaqItem({ question, children }) {
  return (
    <details className="group/faq border-b border-border first:border-t">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-5 rounded-md py-5 text-[15px] font-medium text-zinc-100 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
        {question}
        <ChevronRight className="size-4 shrink-0 text-zinc-400 transition-transform group-open/faq:rotate-90 group-open/faq:text-blue-300" aria-hidden />
      </summary>
      <p className="pr-2 pb-5 text-sm leading-relaxed text-zinc-400 sm:pr-10">{children}</p>
    </details>
  );
}

export function FinalCta({ label, title, body, actions }) {
  return (
    <section className="my-16 flex flex-col gap-8 overflow-hidden rounded-2xl border border-border bg-card p-6 sm:my-20 sm:p-9 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-col items-start">
        <SectionLabel>{label}</SectionLabel>
        <h2 className="mt-4 text-[clamp(24px,2.6vw,32px)] leading-tight font-semibold tracking-[-0.03em] text-foreground">{title}</h2>
        <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-zinc-400">{body}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:shrink-0">{actions}</div>
    </section>
  );
}
