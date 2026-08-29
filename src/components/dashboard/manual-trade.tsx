import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PendingManual } from "@/lib/neurotrend/store";
import type { GridState } from "@/lib/neurotrend/grid";
import { gridLevels, gridStepPct } from "@/lib/neurotrend/grid";
import type { WalletAsset } from "@/lib/neurotrend/indodax-private";
import type { Opportunity, Position } from "@/lib/neurotrend/types";
import { formatIdr, formatNum } from "@/lib/utils";

const SUGGEST = [
  "btc_idr",
  "eth_idr",
  "hype_idr",
  "sol_idr",
  "xrp_idr",
  "doge_idr",
  "pepe_idr",
  "ada_idr",
  "bnb_idr",
];

function normPair(raw: string): string {
  const ticker = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace("/", "")
    .replace(/_idr/g, "")
    .replace(/[^a-z0-9]/g, "");
  return ticker ? `${ticker}_idr` : "";
}

function tickerOf(pair: string): string {
  return pair.replace(/_idr$/i, "").toUpperCase();
}

function qtyDigits(px: number, qty: number): number {
  if (qty > 0 && qty < 1) return 8;
  if (px >= 10_000) return 8;
  if (px >= 100) return 4;
  return qty < 10 ? 4 : 0;
}

function PctSlider({
  value,
  onChange,
  accent,
}: {
  value: number;
  onChange: (n: number) => void;
  accent: string;
}) {
  return (
    <div className="space-y-1.5 px-0.5">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#2a3444]"
        style={{ accentColor: accent }}
      />
      <div className="flex justify-between text-[10px] text-[#8b95a2]">
        {[0, 25, 50, 75, 100].map((n) => (
          <button
            key={n}
            type="button"
            className={`min-w-[28px] ${value === n ? "font-semibold text-white" : "hover:text-white"}`}
            onClick={() => onChange(n)}
          >
            {n}%
          </button>
        ))}
      </div>
    </div>
  );
}

export function ManualTradePanel({
  opportunities,
  prices,
  cash,
  maxNotional,
  positions,
  wallet = [],
  watchPair,
  live,
  onBuy,
  onSell,
  onSetStops,
  pendingManual = [],
  onCancelLimit,
  onWatch,
  gridState,
  feeRate = 0.0025,
  takeProfit = 0.012,
}: {
  opportunities: Opportunity[];
  prices: Record<string, number>;
  cash: number;
  maxNotional: number;
  positions: Record<string, Position>;
  wallet?: WalletAsset[];
  watchPair?: string;
  live: boolean;
  onBuy: (opts: {
    pair: string;
    slPct: number;
    tpPct: number;
    sizeIdr?: number;
    price?: number;
    market?: boolean;
    grid?: boolean;
  }) => Promise<boolean>;
  onSell: (pair: string, qty?: number) => Promise<boolean>;
  onSetStops: (pair: string, slPct: number, tpPct: number) => boolean;
  pendingManual?: PendingManual[];
  onCancelLimit?: (pair: string) => Promise<boolean>;
  onWatch?: (opts: {
    pair: string;
    limit: number;
    slPct: number;
    tpPct: number;
  }) => void;
  gridState?: GridState | null;
  feeRate?: number;
  takeProfit?: number;
}) {
  const [pair, setPair] = useState(watchPair || "hype_idr");
  const [buyQty, setBuyQty] = useState("");
  const [sellQty, setSellQty] = useState("");
  const [buyPct, setBuyPct] = useState(0);
  const [sellPct, setSellPct] = useState(0);
  const [sl, setSl] = useState("2");
  const [tp, setTp] = useState("3");
  const [gridOn, setGridOn] = useState(true);
  const [stepPct, setStepPct] = useState(() =>
    String((gridStepPct(feeRate, takeProfit) * 100).toFixed(1)),
  );
  const [busy, setBusy] = useState<"buy" | "sell" | null>(null);
  const [editPair, setEditPair] = useState("");
  const [editSl, setEditSl] = useState("2");
  const [editTp, setEditTp] = useState("3");

  const key = normPair(pair);
  const coin = tickerOf(key || "hype_idr");
  const px = key ? prices[key] || 0 : 0;
  const hint = opportunities.find((o) => o.pair === key);
  const pos = key ? positions[key] : undefined;
  const bag = wallet.find((w) => w.coin === coin.toLowerCase());
  const coinBal = Math.max(pos?.qty ?? 0, bag?.qty ?? 0);
  const spendCap = Math.max(0, cash);

  const options = useMemo(() => {
    const set = new Set(SUGGEST);
    for (const o of opportunities.slice(0, 30)) set.add(o.pair);
    for (const w of wallet) if (w.coin !== "idr") set.add(`${w.coin}_idr`);
    for (const p of Object.keys(positions)) set.add(p);
    return [...set];
  }, [opportunities, wallet, positions]);

  useEffect(() => {
    if (watchPair && watchPair !== key) setPair(watchPair);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchPair]);

  useEffect(() => {
    if (key && px > 0) {
      onWatch?.({
        pair: key,
        limit: px,
        slPct: Number(sl) / 100,
        tpPct: Number(tp) / 100,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const applyBuyPct = (pct: number) => {
    setBuyPct(pct);
    if (!(px > 0) || spendCap <= 0) {
      setBuyQty("");
      return;
    }
    const idr = (spendCap * pct) / 100;
    setBuyQty(idr > 0 ? String(idr / px) : "");
  };
  const applySellPct = (pct: number) => {
    setSellPct(pct);
    if (!(coinBal > 0)) {
      setSellQty("");
      return;
    }
    setSellQty(pct > 0 ? String((coinBal * pct) / 100) : "");
  };

  const buyEst = (Number(buyQty) || 0) * px;
  const sellEst = (Number(sellQty) || 0) * px;
  const d = qtyDigits(px, Number(buyQty) || coinBal || 0);

  const step = Math.max(0.006, (Number(stepPct) || 1.2) / 100);
  const gridAdds =
    gridOn && gridState?.pair === key ? Math.max(gridState.adds, pos ? 1 : 0) : pos ? 1 : 0;
  const nextBuyPx = (gridState?.pair === key && gridState.lastBuyPx > 0 ? gridState.lastBuyPx : px) * (1 - step);
  const nextSellPx = (pos?.entryPrice || px) * (1 + step);
  const oneLot = gridOn && coinBal > 0 ? coinBal / Math.max(gridAdds, 1) : 0;

  const buyNow = async () => {
    if (busy) return;
    if (!key) {
      toast.error("Pilih koin dulu");
      return;
    }
    if (!(px > 0)) {
      toast.error("Harga pasar belum ada");
      return;
    }
    const sizeIdr = buyEst > 0 ? buyEst : Math.min(10_000, spendCap);
    if (sizeIdr < 10_000) {
      toast.error("Estimasi min Rp 10.000 (saldo IDR kurang)");
      return;
    }
    setBusy("buy");
    try {
      const ok = await onBuy({
        pair: key,
        slPct: gridOn ? step * 3 : Number(sl) / 100 || 0.02,
        tpPct: gridOn ? step : Number(tp) / 100 || 0.03,
        sizeIdr,
        price: px,
        market: true,
        grid: gridOn,
      });
      if (ok) toast.success(`${gridOn ? "Grid lot" : "Buy"} ${coin} @ ${formatNum(px, px < 10 ? 4 : 0)}`);
      else toast.error("Buy gagal — cek Log");
    } finally {
      setBusy(null);
    }
  };

  const sellNow = async () => {
    if (busy) return;
    if (!key) {
      toast.error("Pilih koin dulu");
      return;
    }
    const q = Number(sellQty) > 0 ? Number(sellQty) : gridOn ? oneLot : 0;
    if (!(q > 0)) {
      toast.error("Isi jumlah koin / geser slider");
      return;
    }
    if (!(coinBal > 0)) {
      toast.error(`Tidak ada ${coin} di wallet`);
      return;
    }
    setBusy("sell");
    try {
      const ok = await onSell(key, q);
      if (ok) toast.success(`${gridOn ? "Grid sell lot" : "Sell"} ${coin} ${formatNum(q, d)}`);
      else toast.error("Sell gagal — cek Log");
    } finally {
      setBusy(null);
    }
  };

  const saveStops = (p: string) => {
    const slPct = Number(editSl) / 100;
    const tpPct = Number(editTp) / 100;
    if (!(slPct > 0) || !(tpPct > 0)) {
      toast.error("SL/TP tidak valid");
      return;
    }
    if (onSetStops(p, slPct, tpPct)) {
      toast.success(`TP/SL ${tickerOf(p)} disimpan`);
      setEditPair("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          list="man-pairs"
          className="max-w-[220px] bg-[#121821]"
          placeholder="Cari koin: hype, btc…"
          value={pair}
          onChange={(e) => setPair(e.target.value)}
          autoCapitalize="off"
        />
        <datalist id="man-pairs">
          {options.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {px > 0 ? (
          <span className="text-sm tabular text-[#8b95a2]">
            last <span className="font-semibold text-white">{formatNum(px, px < 10 ? 4 : 0)}</span> IDR
            {hint?.buy ? ` · bid ${formatNum(hint.buy, hint.buy < 10 ? 4 : 0)}` : ""}
            {hint?.sell ? ` · ask ${formatNum(hint.sell, hint.sell < 10 ? 4 : 0)}` : ""}
          </span>
        ) : (
          <span className="text-xs text-[#8b95a2]">menunggu harga…</span>
        )}
        <span className="ml-auto text-[11px] text-[#8b95a2]">{live ? "LIVE" : "PAPER"}</span>
      </div>

      <div className="rounded-xl border border-[#1e2733] bg-[#10151c] p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setGridOn((v) => !v)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              gridOn ? "bg-[#26a69a]/20 text-[#26a69a]" : "bg-[#1e2733] text-[#8b95a2]"
            }`}
          >
            Grid {gridOn ? "ON" : "OFF"}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-[#8b95a2]">
            Step %
            <Input
              className="h-8 w-16"
              type="number"
              min={0.6}
              max={5}
              step={0.1}
              value={stepPct}
              onChange={(e) => setStepPct(e.target.value)}
            />
          </label>
          {gridOn && px > 0 ? (
            <span className="text-[11px] tabular text-[#8b95a2]">
              next buy {formatNum(nextBuyPx, nextBuyPx < 10 ? 4 : 0)} · next sell{" "}
              {formatNum(nextSellPx, nextSellPx < 10 ? 4 : 0)} · {gridAdds} lot
            </span>
          ) : null}
        </div>
        {gridOn && px > 0 ? (
          <div className="flex flex-wrap gap-1">
            {gridLevels(gridState?.pair === key && gridState.anchor > 0 ? gridState.anchor : px, step, 3)
              .sort((a, b) => b - a)
              .map((lv) => {
                const near = Math.abs(lv - px) / px < 0.002;
                return (
                  <span
                    key={lv}
                    className={`rounded-full px-2 py-0.5 text-[10px] tabular ${
                      near ? "bg-white/10 text-white" : "text-[#8b95a2]"
                    }`}
                  >
                    {formatNum(lv, lv < 10 ? 4 : 0)}
                  </span>
                );
              })}
          </div>
        ) : (
          <div className="text-[11px] text-[#8b95a2]">
            Grid ON: Buy boleh numpuk lot di koin yang sama. Sell melepas 1 lot (bukan semua).
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[#1e2733] bg-[#10151c] p-4">
          <div className="mb-4 flex items-center justify-between text-sm">
            <span className="text-[#8b95a2]">
              Balance:{" "}
              <span className="font-semibold tabular text-white">
                {formatNum(cash, 0)} IDR
              </span>
            </span>
          </div>
          <div className="mb-3 flex items-center rounded-lg border border-[#2a3444] bg-[#0b0f14] px-3">
            <span className="shrink-0 text-xs text-[#8b95a2]">Coin amount</span>
            <input
              className="h-12 min-w-0 flex-1 bg-transparent px-3 text-right text-sm tabular text-white outline-none"
              inputMode="decimal"
              placeholder="0"
              value={buyQty}
              onChange={(e) => {
                setBuyQty(e.target.value);
                if (px > 0 && spendCap > 0) {
                  const idr = (Number(e.target.value) || 0) * px;
                  setBuyPct(Math.max(0, Math.min(100, Math.round((idr / spendCap) * 100))));
                }
              }}
            />
            <span className="shrink-0 font-semibold">{coin}</span>
          </div>
          <PctSlider value={buyPct} onChange={applyBuyPct} accent="#26a69a" />
          <div className="mt-3 flex items-center rounded-lg border border-[#2a3444] bg-[#0b0f14] px-3">
            <span className="shrink-0 text-xs text-[#8b95a2]">Estimation</span>
            <div className="h-12 flex-1 px-3 text-right text-sm tabular leading-[48px] text-white">
              {buyEst > 0 ? formatNum(buyEst, 0) : ""}
            </div>
            <span className="shrink-0 font-semibold">IDR</span>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void buyNow()}
            className="mt-4 h-12 w-full rounded-lg bg-[#1fa97a] text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy === "buy" ? "Buying…" : gridOn ? `Buy lot ${coin}` : `Buy ${coin}`}
          </button>
        </div>

        <div className="rounded-xl border border-[#1e2733] bg-[#10151c] p-4">
          <div className="mb-4 flex items-center justify-between text-sm">
            <span className="text-[#8b95a2]">
              Balance:{" "}
              <span className="font-semibold tabular text-white">
                {formatNum(coinBal, d)} {coin}
              </span>
            </span>
          </div>
          <div className="mb-3 flex items-center rounded-lg border border-[#2a3444] bg-[#0b0f14] px-3">
            <span className="shrink-0 text-xs text-[#8b95a2]">Coin amount</span>
            <input
              className="h-12 min-w-0 flex-1 bg-transparent px-3 text-right text-sm tabular text-white outline-none"
              inputMode="decimal"
              placeholder="0"
              value={sellQty}
              onChange={(e) => {
                setSellQty(e.target.value);
                if (coinBal > 0) {
                  setSellPct(
                    Math.max(0, Math.min(100, Math.round(((Number(e.target.value) || 0) / coinBal) * 100))),
                  );
                }
              }}
            />
            <span className="shrink-0 font-semibold">{coin}</span>
          </div>
          <PctSlider value={sellPct} onChange={applySellPct} accent="#ef5350" />
          <div className="mt-3 flex items-center rounded-lg border border-[#2a3444] bg-[#0b0f14] px-3">
            <span className="shrink-0 text-xs text-[#8b95a2]">Estimation</span>
            <div className="h-12 flex-1 px-3 text-right text-sm tabular leading-[48px] text-white">
              {sellEst > 0 ? formatNum(sellEst, 0) : ""}
            </div>
            <span className="shrink-0 font-semibold">IDR</span>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void sellNow()}
            className="mt-4 h-12 w-full rounded-lg bg-[#e24b4a] text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy === "sell" ? "Selling…" : gridOn ? `Sell lot ${coin}` : `Sell ${coin}`}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-[#8b95a2]">
        <label className="flex items-center gap-1.5">
          SL %
          <Input className="h-8 w-16" type="number" step={0.1} value={sl} onChange={(e) => setSl(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5">
          TP %
          <Input className="h-8 w-16" type="number" step={0.1} value={tp} onChange={(e) => setTp(e.target.value)} />
        </label>
        <span>dipakai otomatis setelah Buy</span>
      </div>

      {pendingManual.length ? (
        <div className="panel space-y-2 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
            Order menunggu fill
          </div>
          {pendingManual.map((p) => (
            <div
              key={`${p.pair}-${p.orderId}`}
              className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-xs"
            >
              <span className="font-semibold">{tickerOf(p.pair)}</span>
              <span className="tabular">
                @ {formatNum(p.limitPx, p.limitPx < 10 ? 4 : 0)} · {formatIdr(p.sizeIdr)}
              </span>
              <Button type="button" size="sm" variant="danger" onClick={() => void onCancelLimit?.(p.pair)}>
                Batal
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {Object.keys(positions).length ? (
        <div className="panel space-y-2 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
            Ubah TP / SL posisi open
          </div>
          {Object.values(positions).map((row) => {
            const mark = prices[row.pair] ?? row.entryPrice;
            const slNow = ((row.entryPrice - row.stopLoss) / row.entryPrice) * 100;
            const tpNow = ((row.takeProfit - row.entryPrice) / row.entryPrice) * 100;
            const editing = editPair === row.pair;
            return (
              <div
                key={row.pair}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-xs"
              >
                <span className="font-semibold">{tickerOf(row.pair)}</span>
                <span className="tabular text-[var(--color-muted)]">
                  {formatNum(row.qty, qtyDigits(mark, row.qty))} · mark {formatNum(mark, mark < 10 ? 4 : 0)}
                </span>
                <span className="tabular">
                  SL {slNow.toFixed(1)}% · TP {tpNow.toFixed(1)}%
                </span>
                {editing ? (
                  <>
                    <Input className="h-8 w-20" type="number" step={0.1} value={editSl} onChange={(e) => setEditSl(e.target.value)} />
                    <Input className="h-8 w-20" type="number" step={0.1} value={editTp} onChange={(e) => setEditTp(e.target.value)} />
                    <Button type="button" size="sm" onClick={() => saveStops(row.pair)}>
                      Simpan
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditPair("")}>
                      Batal
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditPair(row.pair);
                      setEditSl(slNow.toFixed(1));
                      setEditTp(tpNow.toFixed(1));
                    }}
                  >
                    Ubah TP/SL
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
