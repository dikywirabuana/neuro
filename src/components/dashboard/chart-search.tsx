import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { Opportunity } from "@/lib/neurotrend/types";
import { formatNum } from "@/lib/utils";

function tickerOf(pair: string): string {
  return pair.replace(/_idr$/i, "").replace(/_/g, "").toUpperCase();
}

function scoreMatch(pair: string, q: string): number {
  const base = tickerOf(pair).toLowerCase();
  if (!q) return 0;
  if (base === q) return 100;
  if (base.startsWith(q)) return 90 - Math.min(base.length, 30);
  if (base.includes(q)) return 50;
  return 0;
}

export function ChartSearch({
  onPick,
  activePair,
  opportunities,
  prices,
}: {
  onPick: (pair: string) => void;
  activePair: string;
  opportunities: Opportunity[];
  prices: Record<string, number>;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/_idr/g, "").replace(/[^a-z0-9]/g, "");
    const seen = new Set<string>();
    const list: { pair: string; price: number; vol: number }[] = [];
    const add = (pair: string, price: number, vol = 0) => {
      const p = pair.toLowerCase();
      if (!p.endsWith("_idr") || seen.has(p)) return;
      seen.add(p);
      list.push({ pair: p, price: price || prices[p] || 0, vol });
    };
    for (const o of opportunities) add(o.pair, o.price, o.volumeIdr);
    for (const pair of Object.keys(prices)) add(pair, prices[pair]);
    if (!needle) {
      return list
        .sort((a, b) => b.vol - a.vol || a.pair.localeCompare(b.pair))
        .slice(0, 14);
    }
    return list
      .map((r) => ({ ...r, s: scoreMatch(r.pair, needle) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || b.vol - a.vol)
      .slice(0, 14);
  }, [q, opportunities, prices]);

  const pick = (pair: string) => {
    onPick(pair);
    setQ("");
    setOpen(false);
  };

  const active = tickerOf(activePair || "btc_idr");
  const last = prices[activePair] || 0;

  return (
    <div className="relative min-w-[240px] flex-1">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">
          Chart
        </span>
        <span className="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 text-[11px] font-semibold tabular text-[var(--color-accent)]">
          {active}/IDR
        </span>
        {last > 0 ? (
          <span className="text-[11px] tabular text-[var(--color-muted)]">
            {formatNum(last, last < 10 ? 4 : 0)}
          </span>
        ) : null}
      </div>
      <Input
        placeholder="Cari koin: btc, pepe, hype…"
        value={q}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQ("");
            return;
          }
          if (!open || !rows.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((i) => Math.min(rows.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const row = rows[hi] ?? rows[0];
            if (row) pick(row.pair);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 140);
        }}
      />
      {open ? (
        <div className="absolute z-40 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-[var(--color-border)] bg-[#10151c] shadow-xl">
          {rows.length ? (
            rows.map((r, i) => (
              <button
                key={r.pair}
                type="button"
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                  i === hi || r.pair === activePair
                    ? "bg-white/8"
                    : "hover:bg-white/5"
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(r.pair)}
              >
                <span className="font-semibold tabular tracking-wide">
                  {tickerOf(r.pair)}
                  <span className="ml-2 text-[10px] font-normal text-[var(--color-subtle)]">
                    IDR
                  </span>
                </span>
                <span className="tabular text-xs text-[var(--color-muted)]">
                  {r.price > 0 ? formatNum(r.price, r.price < 10 ? 4 : 0) : "—"}
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-xs text-[var(--color-muted)]">
              Tidak ada pair “{q}”
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
