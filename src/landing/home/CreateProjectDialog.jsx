import React from 'react';
import { ArrowRight, Box, Boxes, Earth, Mountain, SlidersHorizontal, Trash2 } from 'lucide-react';
import { translateText, useLanguage } from '@/i18n/LanguageContext.jsx';
import { Button } from '@/components/shadcn/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/shadcn/dialog.jsx';

const WORKFLOWS = [
  { id: 'procedural', icon: SlidersHorizontal, title: 'Procedural', description: 'The current Tile, Infinite World, and Planet workflow with direct controls and Noise Layers.', action: 'Choose a procedural template' },
  { id: 'nodes', icon: Boxes, title: 'Nodes', description: 'A dedicated analytical graph workspace starting from a clean, flat slab. Desktop first.', action: 'Choose a Nodes recipe' },
  { id: 'manual', icon: Mountain, title: 'Manual Terrain', description: 'Drag mountains, valleys, ridges, plateaus, and craters onto a clean terrain and transform them directly.', action: 'Create Manual Terrain' },
  { id: 'real', icon: Earth, title: 'Real Terrain', description: 'Choose any real-world location and work in a focused import workspace with geographic elevation, imagery, and buildings.', action: 'Select a location' },
  { id: 'mini', icon: Box, title: 'Mini Terrain', description: 'A composed procedural diorama on a cut-away base, with water that stops at its edges. Opens already composed.', action: 'Choose a Mini Terrain template' },
];

export function CreateProjectDialog({ open, onOpenChange, disabled, onChoose }) {
  useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="ui font-sans outline-none sm:max-w-[860px]"
        // Focus the dialog itself rather than the first card, so opening it
        // with the mouse doesn't paint a focus ring on "Procedural".
        onOpenAutoFocus={(event) => { event.preventDefault(); event.currentTarget?.focus?.(); }}
      >
        <DialogHeader className="gap-2 pr-8">
          <span className="text-[12.5px] font-medium text-muted-foreground">{translateText('New project')}</span>
          <DialogTitle className="text-xl font-semibold tracking-[-0.025em]">{translateText('Choose how to build your terrain')}</DialogTitle>
          <DialogDescription>{translateText('Each project uses one authoring workflow. All modes can be saved and exported.')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {WORKFLOWS.map(({ id, icon: Icon, title, description, action }) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onChoose(id)}
              className="group/opt flex flex-col items-start gap-3 rounded-[14px] border border-white/[0.08] bg-gradient-to-b from-[#0e0f13] to-[#0a0b0e] p-4 text-left shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] transition-[translate,border-color,box-shadow] duration-[400ms] ease-[cubic-bezier(.22,1,.36,1)] outline-none hover:-translate-y-[3px] hover:border-white/[0.16] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_18px_40px_-18px_rgb(0_0_0/0.9)] focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 motion-reduce:hover:translate-y-0"
            >
              <span className="grid size-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-400 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] transition-[color,translate] duration-[400ms] ease-[cubic-bezier(.22,1,.36,1)] group-hover/opt:-translate-y-0.5 group-hover/opt:text-zinc-100">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <span className="flex flex-col gap-1">
                <strong className="text-sm font-medium text-foreground">{translateText(title)}</strong>
                <small className="text-[12.5px] leading-relaxed text-muted-foreground">{translateText(description)}</small>
              </span>
              <span className="mt-auto inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover/opt:text-zinc-100">
                {translateText(action)}<ArrowRight className="size-3 transition-transform group-hover/opt:translate-x-0.5" aria-hidden />
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteProjectDialog({ project, busy, onCancel, onConfirm }) {
  useLanguage();
  return (
    <Dialog open={!!project} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent role="alertdialog" className="ui font-sans sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="gap-2">
          <span className="text-[12.5px] font-medium text-muted-foreground">{translateText('Delete project')}</span>
          <DialogTitle>{translateText('Delete “')}{project?.metadata.name}&rdquo;?</DialogTitle>
          <DialogDescription>{translateText('This cannot be undone.')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>{translateText('Cancel')}</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}><Trash2 />{translateText('Delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
