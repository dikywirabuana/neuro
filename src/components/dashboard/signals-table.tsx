import { Badge } from "@/components/ui/badge";
import type { HorizonBias, Opportunity } from "@/lib/neurotrend/types";
import { formatNum } from "@/lib/utils";

function signalTone(s: Opportunity["signal"]) {
  if (s === "STRONG_BUY" || s === "BUY") return "buy" as const;
  if (s === "SELL" || s === "STRONG_SELL" || s === "AVOID") return "sell" as const;
  return "muted" as const;
}

function tagTone(tag?: string) {
  if (tag === "RAME") return "buy" as const;
  if (tag === "LISTING") return "buy" as const;
  if (tag === "BARU" || tag === "MEME") return "warn" as const;
  return "muted" as const;
}

function hzColor(b?: HorizonBias) {
  if (b === "UP") return "text-[var(--color-buy)]";
  if (b === "DOWN") return "text-[var(--color-sell)]";
  return "text-[var(--color-muted)]";
}

function hzText(row: Opportunity, key: "m5" | "m15" | "m30") {
  const h = row.forecast?.[key];
  if (!h) return "—";
  const sign = h.pct > 0 ? "+" : "";
  return `${h.bias} ${sign}${h.pct.toFixed(2)}%`;
}

export function SignalsTable({
  rows,
  focusLabel,
  onPick,
  activePair,
}: {
  rows: Opportunity[];
  focusLabel?: string;
  onPick?: (pair: string) => void;
  activePair?: string;
}) {
  if (!rows.length) {
    return (
      <div className="panel p-8 text-center text-sm text-[var(--color-muted)]">
        Menunggu scan. Hybrid: BOUNCE (chop) · BREAKOUT (tren). PULLBACK off.
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      {focusLabel ? (
        <div className="border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
          {focusLabel} · {rows.length} pair · bounce / pullback / breakout
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-muted)]">
              <th className="px-4 py-3 font-medium">Pair</th>
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Signal</th>
              <th className="px-4 py-3 font-medium">Setup</th>
              <th className="px-4 py-3 font-medium text-right">30 menit</th>
              <th className="px-4 py-3 font-medium text-right">15 menit</th>
              <th className="px-4 py-3 font-medium text-right">5 menit</th>
              <th className="px-4 py-3 font-medium text-right">RSI</th>
              <th className="px-4 py-3 font-medium text-right">Price</th>
              <th className="px-4 py-3 font-medium text-right">24h</th>
              <th className="px-4 py-3 font-medium text-right">Vol</th>
              <th className="px-4 py-3 font-medium text-right">Spread</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.pair}
                onClick={() => onPick?.(r.pair)}
                className={`border-b border-[var(--color-border)]/70 last:border-0 hover:bg-[var(--color-elevated)]/50 ${
                  onPick ? "cursor-pointer" : ""
                } ${
                  activePair === r.pair ? "bg-[var(--color-accent)]/10" : ""
                }`}
              >
                <td className="px-4 py-3 font-medium tabular">
                  {r.pair}
                  {r.tag ? (
                    <span className="ml-2">
                      <Badge tone={tagTone(r.tag)}>{r.tag}</Badge>
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--color-elevated)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-buy)]"
                        style={{ width: `${Math.min(100, r.score)}%` }}
                      />
                    </div>
                    <span className="tabular font-semibold">{r.score}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={signalTone(r.signal)}>{r.signal}</Badge>
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="font-semibold">{r.setup ?? "—"}</div>
                  <div className="text-[10px] text-[var(--color-subtle)] max-w-[220px] truncate">
                    {r.setupReason ?? ""}
                  </div>
                </td>
                <td
                  className={`px-4 py-3 text-right tabular text-xs font-semibold ${hzColor(r.forecast?.m30.bias)}`}
                >
                  {hzText(r, "m30")}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular text-xs ${hzColor(r.forecast?.m15.bias)}`}
                >
                  {hzText(r, "m15")}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular text-xs ${hzColor(r.forecast?.m5.bias)}`}
                >
                  {hzText(r, "m5")}
                </td>
                <td className="px-4 py-3 text-right tabular text-[var(--color-muted)]">
                  {r.details?.rsi != null ? r.details.rsi.toFixed(0) : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular">
                  {formatNum(r.price, r.price < 10 ? 4 : r.price < 1000 ? 1 : 0)}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular text-xs font-semibold ${
                    (r.change24h ?? 0) > 0
                      ? "text-[var(--color-buy)]"
                      : (r.change24h ?? 0) < 0
                        ? "text-[var(--color-sell)]"
                        : "text-[var(--color-muted)]"
                  }`}
                >
                  {r.change24h == null
                    ? "—"
                    : `${r.change24h > 0 ? "+" : ""}${r.change24h.toFixed(1)}%`}
                </td>
                <td className="px-4 py-3 text-right tabular text-[var(--color-muted)]">
                  {formatNum(r.volumeIdr / 1e6, 1)}M
                </td>
                <td className="px-4 py-3 text-right tabular text-[var(--color-muted)]">
                  {r.spreadPct.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-subtle)]">
        Hybrid: CHOP = BOUNCE. TREND = BREAKOUT. PULLBACK off (sering kena SL). Dump = diam.
        TP harus kalahkan fee Indodax. Bukan scalp tipis.
      </div>
    </div>
  );
}
