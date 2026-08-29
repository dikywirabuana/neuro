import { useState } from "react";
import { toast } from "sonner";
import { HoldCountdown } from "@/components/dashboard/hold-timer";
import { PairCandleChart } from "@/components/dashboard/candle-chart";
import { Button } from "@/components/ui/button";
import type { Position } from "@/lib/neurotrend/types";
import { formatIdr, formatNum, formatPct } from "@/lib/utils";

export function PortfolioPanel({
  positions,
  prices,
  onSellPair,
  onSellAll,
}: {
  positions: Record<string, Position>;
  prices: Record<string, number>;
  onSellPair: (pair: string) => Promise<boolean>;
  onSellAll: () => Promise<number>;
}) {
  const list = Object.values(positions).sort((a, b) => a.pair.localeCompare(b.pair));
  const [busy, setBusy] = useState<string | null>(null);

  if (!list.length) {
    return (
      <div className="panel p-8 text-center text-sm text-[var(--color-muted)]">
        Tidak ada posisi terbuka.
      </div>
    );
  }

  let totalUpnl = 0;
  for (const p of list) {
    const mark = prices[p.pair] ?? p.entryPrice;
    totalUpnl += (mark - p.entryPrice) * p.qty;
  }

  const sellOne = async (pair: string) => {
    if (busy) return;
    setBusy(pair);
    try {
      const ok = await onSellPair(pair);
      if (ok) toast.success(`Terjual ${pair}`);
      else toast.error(`Gagal jual ${pair}`);
    } finally {
      setBusy(null);
    }
  };

  const sellAll = async () => {
    if (busy) return;
    if (!confirm(`Jual SEMUA ${list.length} pair open sekarang?`)) return;
    setBusy("__all__");
    try {
      const n = await onSellAll();
      toast.success(`Close all: ${n} pair terjual`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="text-sm font-medium">
            Open sekarang · {list.length} pair
          </div>
          <div
            className={`mt-0.5 text-xs tabular ${
              totalUpnl >= 0 ? "text-[var(--color-buy)]" : "text-[var(--color-sell)]"
            }`}
          >
            Total uPnL {formatIdr(totalUpnl)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {list.map((p) => {
              const mark = prices[p.pair] ?? p.entryPrice;
              const upnl = (mark - p.entryPrice) * p.qty;
              return (
                <span
                  key={p.pair}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium tabular ${
                    upnl >= 0
                      ? "border-[var(--color-buy)]/30 bg-[var(--color-buy)]/10 text-[var(--color-buy)]"
                      : "border-[var(--color-sell)]/30 bg-[var(--color-sell)]/10 text-[var(--color-sell)]"
                  }`}
                >
                  {p.pair.replace("_idr", "").toUpperCase()}{" "}
                  {formatPct((mark / p.entryPrice - 1) * 100)}
                </span>
              );
            })}
          </div>
        </div>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={!!busy}
          onClick={() => void sellAll()}
        >
          {busy === "__all__" ? "Menjual semua…" : "Jual semua pair"}
        </Button>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-muted)]">
                <th className="px-4 py-3 font-medium">Pair</th>
                <th className="px-4 py-3 font-medium text-right">Qty</th>
                <th className="px-4 py-3 font-medium text-right">Entry</th>
                <th className="px-4 py-3 font-medium text-right">Mark</th>
                <th className="px-4 py-3 font-medium text-right">SL</th>
                <th className="px-4 py-3 font-medium text-right">TP</th>
                <th className="px-4 py-3 font-medium text-right">uPnL</th>
                <th className="px-4 py-3 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const mark = prices[p.pair] ?? p.entryPrice;
                const upnl = (mark - p.entryPrice) * p.qty;
                const pct = (mark / p.entryPrice - 1) * 100;
                return (
                  <tr
                    key={p.pair}
                    className="border-b border-[var(--color-border)]/70 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium tabular">{p.pair}</div>
                      <div className="text-[11px] text-[var(--color-subtle)]">
                        <HoldCountdown
                          entryTime={p.entryTime}
                          compact
                          holdMin={p.setupHoldMin ?? 12}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular text-[var(--color-muted)]">
                      {formatNum(p.qty, 6)}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {formatNum(p.entryPrice, p.entryPrice < 10 ? 4 : 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {formatNum(mark, mark < 10 ? 4 : 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular text-[var(--color-sell)]">
                      {formatNum(p.stopLoss, p.stopLoss < 10 ? 4 : 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular text-[var(--color-buy)]">
                      {formatNum(p.takeProfit, p.takeProfit < 10 ? 4 : 0)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular font-medium ${
                        upnl >= 0
                          ? "text-[var(--color-buy)]"
                          : "text-[var(--color-sell)]"
                      }`}
                    >
                      {formatIdr(upnl)} ({formatPct(pct)})
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        disabled={!!busy}
                        onClick={() => void sellOne(p.pair)}
                      >
                        {busy === p.pair ? "…" : "Jual"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
          Candle pair yang dibeli · EMA9 · entry / SL / TP
        </div>
        <div className="grid gap-3 lg:grid-cols-1">
          {list.map((p) => (
            <PairCandleChart
              key={p.pair}
              position={p}
              mark={prices[p.pair] ?? p.entryPrice}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
