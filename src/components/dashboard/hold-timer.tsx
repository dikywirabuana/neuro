import { useEffect, useState } from "react";

export function formatMmSs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Hanya tampil lama hold — tidak ada timeout paksa. */
export function HoldCountdown({
  entryTime,
  compact = false,
}: {
  entryTime: number;
  compact?: boolean;
  holdMin?: number;
}) {
  const now = useNow(1000);
  const elapsed = Math.max(0, now - entryTime);
  const entered = new Date(entryTime).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  if (compact) {
    return (
      <span className="tabular font-semibold text-[var(--color-muted)]">
        {formatMmSs(elapsed)}
      </span>
    );
  }

  return (
    <div className="min-w-[160px]">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[var(--color-muted)] tabular">masuk {entered}</span>
        <span className="tabular font-semibold text-[var(--color-accent)]">
          hold {formatMmSs(elapsed)}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--color-subtle)]">
        Tidak ada timeout — keluar hanya TP / SL
      </div>
    </div>
  );
}
