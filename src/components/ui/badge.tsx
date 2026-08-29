import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  children,
  tone = "neutral",
}: {
  className?: string;
  children: ReactNode;
  tone?: "neutral" | "buy" | "sell" | "warn" | "muted";
}) {
  const tones = {
    neutral:
      "bg-[var(--color-elevated)] text-[var(--color-fg)] border-[var(--color-border)]",
    buy: "bg-[var(--color-accent-dim)] text-[var(--color-accent)] border-[var(--color-accent)]/25",
    sell: "bg-[var(--color-danger-dim)] text-[var(--color-sell)] border-[var(--color-sell)]/25",
    warn: "bg-[var(--color-elevated)] text-[var(--color-warn)] border-[var(--color-warn)]/25",
    muted:
      "bg-transparent text-[var(--color-muted)] border-[var(--color-border)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tabular",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
