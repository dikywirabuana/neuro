import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { OpenOrder, WalletAsset } from "@/lib/neurotrend/indodax-private";
import type { Opportunity, Position, Trade } from "@/lib/neurotrend/types";
import { formatIdrReal, formatNum, formatPct } from "@/lib/utils";

function costBasis(
  coin: string,
  qty: number,
  trades: Trade[],
  positions: Record<string, Position>,
): { avg: number; cost: number } | null {
  const pair = `${coin}_idr`;
  const pos = positions[pair];
  if (pos && pos.qty > 0 && pos.costIdr > 0) {
    const avg = pos.entryPrice || pos.costIdr / pos.qty;
    return { avg, cost: avg * qty };
  }
  let held = 0;
  let cost = 0;
  for (const t of trades) {
    if (t.pair !== pair) continue;
    if (t.side === "BUY") {
      held += t.qty;
      cost += t.notional + (t.fee || 0);
    } else if (held > 0) {
      const take = Math.min(t.qty, held);
      const frac = take / held;
      cost *= 1 - frac;
      held -= take;
    }
  }
  if (held > 0 && cost > 0) {
    const avg = cost / held;
    return { avg, cost: avg * qty };
  }
  return null;
}

export function WalletPanel({
  wallet,
  openOrders = [],
  walletAt,
  apiStatus,
  busy,
  trades = [],
  positions = {},
  opportunities = [],
  onRefresh,
  onSellCoin,
  onSellAll,
  onCancelOrder,
  onCancelAllOrders,
}: {
  wallet: WalletAsset[];
  openOrders?: OpenOrder[];
  walletAt: number | null;
  apiStatus: "unknown" | "ok" | "fail";
  busy: boolean;
  trades?: Trade[];
  positions?: Record<string, Position>;
  opportunities?: Opportunity[];
  onRefresh: () => Promise<boolean>;
  onSellCoin: (coin: string) => Promise<boolean>;
  onSellAll: () => Promise<number>;
  onCancelOrder?: (order: OpenOrder) => Promise<boolean>;
  onCancelAllOrders?: () => Promise<number>;
}) {
  const [localBusy, setLocalBusy] = useState<string | null>(null);
  const idr = wallet.find((w) => w.coin === "idr");
  const coins = wallet.filter((w) => w.coin !== "idr");
  const totalCrypto = coins.reduce((s, w) => s + (w.valueIdr || 0), 0);
  const total = (idr?.qty ?? 0) + totalCrypto;
  const age =
    walletAt != null
      ? Math.max(0, Math.round((Date.now() - walletAt) / 1000))
      : null;

  const rows = useMemo(() => {
    return wallet.map((w) => {
      if (w.coin === "idr") {
        return { w, pnl: 0, pnlPct: 0, avg: 0, kind: "cash" as const };
      }
      const basis = costBasis(w.coin, w.qty, trades, positions);
      const opp = opportunities.find((o) => o.pair === w.pair);
      if (basis && basis.cost > 0) {
        const pnl = w.valueIdr - basis.cost;
        const pnlPct = (pnl / basis.cost) * 100;
        return { w, pnl, pnlPct, avg: basis.avg, kind: "cost" as const };
      }
      if (opp?.change24h != null) {
        const pnlPct = opp.change24h;
        const pnl = w.valueIdr * (pnlPct / (100 + pnlPct) || 0);
        return { w, pnl, pnlPct, avg: 0, kind: "d24" as const };
      }
      return { w, pnl: 0, pnlPct: 0, avg: 0, kind: "na" as const };
    });
  }, [wallet, trades, positions, opportunities]);

  const totalPnl = rows
    .filter((r) => r.kind === "cost")
    .reduce((s, r) => s + r.pnl, 0);

  const sellOne = async (coin: string) => {
    if (busy || localBusy) return;
    if (!confirm(`Jual SEMUA ${coin.toUpperCase()} di wallet ke IDR?`)) return;
    setLocalBusy(coin);
    try {
      const ok = await onSellCoin(coin);
      if (ok) toast.success(`Terjual ${coin.toUpperCase()}`);
      else toast.error(`Gagal jual ${coin.toUpperCase()} — cek Log`);
    } finally {
      setLocalBusy(null);
    }
  };

  const sellAll = async () => {
    if (busy || localBusy) return;
    if (!coins.length) return;
    if (
      !confirm(
        `Jual SEMUA ${coins.length} aset kripto di wallet Indodax ke IDR? Ini order LIVE.`,
      )
    )
      return;
    setLocalBusy("__all__");
    try {
      const n = await onSellAll();
      toast.success(`Jual semua wallet: ${n}/${coins.length} sukses`);
    } finally {
      setLocalBusy(null);
    }
  };

  const locked = busy || !!localBusy;

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="text-sm font-medium">Wallet Indodax (real)</div>
          <div className="mt-0.5 text-xs text-[var(--color-muted)] tabular">
            Cash {formatIdrReal(idr?.qty ?? 0)} · kripto {formatIdrReal(totalCrypto)} ·
            total {formatIdrReal(total)}
            {age != null ? ` · update ${age}s lalu` : ""}
          </div>
          <div
            className={`mt-0.5 text-xs tabular ${
              totalPnl > 0
                ? "text-[var(--color-buy)]"
                : totalPnl < 0
                  ? "text-[var(--color-sell)]"
                  : "text-[var(--color-muted)]"
            }`}
          >
            Unrealized {totalPnl >= 0 ? "+" : ""}
            {formatIdrReal(totalPnl)} (dari harga beli bot)
          </div>
          {apiStatus === "fail" ? (
            <div className="mt-1 text-xs text-[var(--color-sell)]">
              API gagal — Test Indodax di Settings
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={locked}
            onClick={() => {
              void (async () => {
                setLocalBusy("refresh");
                const ok = await onRefresh();
                setLocalBusy(null);
                if (ok) toast.success("Wallet di-refresh");
                else toast.error("Gagal refresh wallet");
              })();
            }}
          >
            {localBusy === "refresh" ? "Refresh…" : "Refresh"}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={locked || coins.length === 0}
            onClick={() => void sellAll()}
          >
            {localBusy === "__all__" ? "Menjual semua…" : "Jual semua wallet"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={locked || !openOrders.length}
            onClick={() => {
              if (!onCancelAllOrders) return;
              if (!confirm(`Cancel SEMUA ${openOrders.length} open order di Indodax?`))
                return;
              void (async () => {
                setLocalBusy("cancelall");
                const n = await onCancelAllOrders();
                setLocalBusy(null);
                toast.success(`Cancel ${n} order`);
              })();
            }}
          >
            {localBusy === "cancelall" ? "Cancel…" : "Cancel all orders"}
          </Button>
        </div>
      </div>

      {!wallet.length ? (
        <div className="panel p-8 text-center text-sm text-[var(--color-muted)]">
          Belum ada data wallet. Isi API Indodax di Settings, lalu klik Refresh.
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-muted)]">
                  <th className="px-4 py-3 font-medium">Aset</th>
                  <th className="px-4 py-3 font-medium text-right">Qty bebas</th>
                  <th className="px-4 py-3 font-medium text-right">Hold</th>
                  <th className="px-4 py-3 font-medium text-right">Harga</th>
                  <th className="px-4 py-3 font-medium text-right">Avg beli</th>
                  <th className="px-4 py-3 font-medium text-right">Nilai</th>
                  <th className="px-4 py-3 font-medium text-right">PnL</th>
                  <th className="px-4 py-3 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ w, pnl, pnlPct, avg, kind }) => (
                  <tr
                    key={w.coin}
                    className="border-b border-[var(--color-border)]/70 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium tabular uppercase">{w.coin}</div>
                      <div className="text-[11px] text-[var(--color-subtle)]">
                        {w.coin === "idr" ? "cash" : w.pair}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {w.coin === "idr"
                        ? formatIdrReal(w.qty)
                        : formatNum(w.qty, w.qty < 1 ? 8 : 4)}
                    </td>
                    <td className="px-4 py-3 text-right tabular text-[var(--color-muted)]">
                      {w.hold > 0
                        ? formatNum(w.hold, w.hold < 1 ? 8 : 4)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {w.coin === "idr"
                        ? "—"
                        : w.price > 0
                          ? formatNum(w.price, w.price < 10 ? 4 : 0)
                          : "no ticker"}
                    </td>
                    <td className="px-4 py-3 text-right tabular text-[var(--color-muted)]">
                      {kind === "cost" && avg > 0
                        ? formatNum(avg, avg < 10 ? 4 : 0)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular font-medium">
                      {w.price > 0 || w.coin === "idr"
                        ? formatIdrReal(w.valueIdr)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {w.coin === "idr" || kind === "na" ? (
                        <span className="text-[var(--color-subtle)]">—</span>
                      ) : (
                        <div
                          className={
                            pnl > 0
                              ? "text-[var(--color-buy)]"
                              : pnl < 0
                                ? "text-[var(--color-sell)]"
                                : "text-[var(--color-muted)]"
                          }
                        >
                          <div className="font-medium">
                            {pnl >= 0 ? "+" : ""}
                            {formatIdrReal(pnl)}
                          </div>
                          <div className="text-[11px]">
                            {formatPct(pnlPct)}
                            {kind === "d24" ? " 24h" : ""}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {w.coin === "idr" ? (
                        <span className="text-xs text-[var(--color-subtle)]">—</span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          disabled={locked || w.qty <= 0}
                          onClick={() => void sellOne(w.coin)}
                        >
                          {localBusy === w.coin ? "…" : "Jual"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openOrders.length ? (
        <div className="panel overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
            Open order Indodax · {openOrders.length} (yang di exchange, bukan paper)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-muted)]">
                  <th className="px-4 py-3 font-medium">Pair</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium text-right">Price</th>
                  <th className="px-4 py-3 font-medium text-right">Remain</th>
                  <th className="px-4 py-3 font-medium text-right">Order</th>
                  <th className="px-4 py-3 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.map((o) => (
                  <tr
                    key={`${o.pair}-${o.orderId}`}
                    className="border-b border-[var(--color-border)]/70 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium tabular">{o.pair}</td>
                    <td
                      className={`px-4 py-3 text-xs font-semibold uppercase ${
                        o.type === "buy"
                          ? "text-[var(--color-buy)]"
                          : "text-[var(--color-sell)]"
                      }`}
                    >
                      {o.type}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {formatNum(o.price, o.price < 10 ? 4 : 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {formatNum(o.remain, 4)}
                    </td>
                    <td className="px-4 py-3 text-right tabular text-[11px] text-[var(--color-subtle)]">
                      {o.orderId}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        disabled={locked || !onCancelOrder}
                        onClick={() => {
                          if (!onCancelOrder) return;
                          void (async () => {
                            setLocalBusy(o.orderId);
                            const ok = await onCancelOrder(o);
                            setLocalBusy(null);
                            if (ok) toast.success("Order dicancel");
                            else toast.error("Cancel gagal");
                          })();
                        }}
                      >
                        {localBusy === o.orderId ? "…" : "Cancel"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center text-[11px] text-[var(--color-subtle)]">
          Tidak ada open order di Indodax (refresh wallet untuk cek).
        </div>
      )}
    </div>
  );
}
