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

/** Hold + sisa waktu timeout (jika holdMin diisi). */
export function HoldCountdown({
  entryTime,
  compact = false,
  holdMin,
}: {
  entryTime: number;
  compact?: boolean;
  holdMin?: number;
}) {
  const now = useNow(1000);
  const elapsed = Math.max(0, now - entryTime);
  const limit = holdMin && holdMin > 0 ? holdMin * 60_000 : 0;
  const left = limit > 0 ? Math.max(0, limit - elapsed) : 0;
  const overtime = limit > 0 && elapsed >= limit;
  const entered = new Date(entryTime).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  if (compact) {
    return (
      <span
        className={`tabular font-semibold ${
          overtime
            ? "text-[var(--color-sell)]"
            : "text-[var(--color-muted)]"
        }`}
      >
        {limit > 0
          ? overtime
            ? `TO ${formatMmSs(elapsed)}`
            : formatMmSs(left)
          : formatMmSs(elapsed)}
      </span>
    );
  }

  return (
    <div className="min-w-[160px]">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[var(--color-muted)] tabular">masuk {entered}</span>
        <span
          className={`tabular font-semibold ${
            overtime
              ? "text-[var(--color-sell)]"
              : "text-[var(--color-accent)]"
          }`}
        >
          {limit > 0
            ? overtime
              ? `timeout ${formatMmSs(elapsed)}`
              : `sisa ${formatMmSs(left)}`
            : `hold ${formatMmSs(elapsed)}`}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--color-subtle)]">
        {limit > 0
          ? `Timeout ${holdMin} menit — lalu jual paksa`
          : "Tidak ada timeout — keluar hanya TP / SL"}
      </div>
    </div>
  );
}
