import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 [&>svg]:pointer-events-none transition-colors overflow-hidden',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        brand: 'border-brand/30 bg-brand/10 text-blue-300',
        outline: 'border-border text-muted-foreground',
        destructive: 'border-transparent bg-destructive text-white',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const Badge = React.forwardRef(function Badge({ className, variant, asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot.Root : 'span';
  return <Comp ref={ref} data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
});

export { Badge, badgeVariants };
