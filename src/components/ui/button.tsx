import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-sm font-medium transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-fg)]/30 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-primary)] text-[var(--color-primary-fg)] hover:opacity-90",
        secondary:
          "bg-[var(--color-elevated)] text-[var(--color-fg)] border border-[var(--color-border-strong)] hover:bg-[var(--color-border)]",
        ghost: "text-[var(--color-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-elevated)]",
        danger:
          "bg-[var(--color-danger-dim)] text-[var(--color-danger)] border border-[var(--color-danger)]/30 hover:opacity-90",
        success:
          "bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:opacity-90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-5",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
