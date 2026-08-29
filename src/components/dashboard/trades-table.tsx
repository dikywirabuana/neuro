import type { Trade } from "@/lib/neurotrend/types";
import { formatIdr, formatNum } from "@/lib/utils";

export function TradesTable({ trades }: { trades: Trade[] }) {
  const rows = [...trades].reverse().slice(0, 50);

  if (!rows.length) {
    return (
      <div className="panel p-8 text-center text-sm text-[var(--color-muted)]">
        Belum ada trade paper.
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-muted)]">
              <th className="px-4 py-3 font-medium">Waktu</th>
              <th className="px-4 py-3 font-medium">Side</th>
              <th className="px-4 py-3 font-medium">Pair</th>
              <th className="px-4 py-3 font-medium text-right">Price</th>
              <th className="px-4 py-3 font-medium text-right">Notional</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium text-right">PnL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.id}
                className="border-b border-[var(--color-border)]/70 last:border-0"
              >
                <td className="px-4 py-3 tabular text-[var(--color-muted)]">
                  {new Date(t.ts).toLocaleTimeString("id-ID")}
                </td>
                <td
                  className={`px-4 py-3 font-medium ${
                    t.side === "BUY"
                      ? "text-[var(--color-buy)]"
                      : "text-[var(--color-sell)]"
                  }`}
                >
                  {t.side}
                </td>
                <td className="px-4 py-3 tabular">{t.pair}</td>
                <td className="px-4 py-3 text-right tabular">
                  {formatNum(t.price, t.price < 10 ? 4 : 0)}
                </td>
                <td className="px-4 py-3 text-right tabular">
                  {formatIdr(t.notional)}
                </td>
                <td className="px-4 py-3 text-[var(--color-muted)]">{t.reason}</td>
                <td
                  className={`px-4 py-3 text-right tabular font-medium ${
                    t.pnl > 0
                      ? "text-[var(--color-buy)]"
                      : t.pnl < 0
                        ? "text-[var(--color-sell)]"
                        : "text-[var(--color-muted)]"
                  }`}
                >
                  {t.side === "SELL" ? formatIdr(t.pnl) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
