import * as React from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

// React 18: parts forward refs so Radix can anchor, focus and animate them.

function DropdownMenu(props) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

const DropdownMenuTrigger = React.forwardRef(function DropdownMenuTrigger(props, ref) {
  return <DropdownMenuPrimitive.Trigger ref={ref} data-slot="dropdown-menu-trigger" {...props} />;
});

const DropdownMenuContent = React.forwardRef(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          // Above the landing overlay (z-index 10000).
          'bg-popover text-popover-foreground z-[10050] min-w-[9rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl border border-white/10 p-1 shadow-[0_18px_44px_-12px_rgb(0_0_0/0.75)]',
          'duration-200 ease-[cubic-bezier(.22,1,.36,1)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

const DropdownMenuItem = React.forwardRef(function DropdownMenuItem({ className, inset, variant = 'default', ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-red-400 data-[variant=destructive]:focus:bg-destructive/10 [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-hidden select-none transition-colors duration-150 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
});

const DropdownMenuSeparator = React.forwardRef(function DropdownMenuSeparator({ className, ...props }, ref) {
  return <DropdownMenuPrimitive.Separator ref={ref} data-slot="dropdown-menu-separator" className={cn('bg-border -mx-1 my-1 h-px', className)} {...props} />;
});

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator };
