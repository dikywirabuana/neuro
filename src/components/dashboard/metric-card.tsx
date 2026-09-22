import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  live = false,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "up" | "down";
  live?: boolean;
}) {
  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
          {label}
        </div>
        {live ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-buy)]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-buy)] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-buy)]" />
            </span>
            Live
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-2 text-xl sm:text-2xl font-semibold tracking-tight tabular transition-colors duration-300",
          tone === "up" && "text-[var(--color-buy)]",
          tone === "down" && "text-[var(--color-sell)]",
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-[var(--color-subtle)]">{hint}</div>
      ) : null}
    </div>
  );
}
