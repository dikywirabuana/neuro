import type { Opportunity, Position } from "./types";

export type GridState = {
  pair: string;
  anchor: number;
  lastBuyPx: number;
  adds: number;
};

export function gridStepPct(feeRate: number, takeProfit: number): number {
  const floor = feeRate * 2 + 0.004;
  return Math.max(0.01, floor, takeProfit || 0);
}

export function pickGridPair(
  opps: Opportunity[],
  watch: string,
  current?: string,
): string | null {
  const ok = (p: string) =>
    opps.some((o) => o.pair === p && o.volumeIdr >= 200_000_000 && o.spreadPct <= 0.8);
  if (current && ok(current)) return current;
  const w = watch?.toLowerCase();
  if (w && ok(w)) return w;
  const ranked = opps
    .filter((o) => o.spreadPct <= 0.55 && o.volumeIdr >= 500_000_000)
    .sort((a, b) => b.volumeIdr - a.volumeIdr);
  return ranked[0]?.pair ?? null;
}

export function gridLevels(anchor: number, step: number, n = 4): number[] {
  if (!(anchor > 0) || !(step > 0)) return [];
  const out: number[] = [anchor];
  for (let i = 1; i <= n; i++) {
    out.push(anchor * (1 - i * step));
    out.push(anchor * (1 + i * step));
  }
  return out.filter((x) => x > 0);
}

export function gridPlan(opts: {
  state: GridState | null;
  pair: string;
  price: number;
  bid: number;
  pos: Position | null;
  cash: number;
  stepPct: number;
  maxAdds: number;
  lotIdr: number;
  regime: string;
  change24h?: number;
}): {
  state: GridState;
  action: "BUY" | "SELL_LOT" | "HOLD";
  reason: string;
  sizeIdr?: number;
  sellQty?: number;
} {
  const {
    pair,
    price,
    bid,
    pos,
    cash,
    stepPct,
    maxAdds,
    lotIdr,
    regime,
    change24h,
  } = opts;
  let state: GridState = opts.state?.pair === pair
    ? { ...opts.state }
    : { pair, anchor: 0, lastBuyPx: 0, adds: 0 };

  if (pos && state.adds < 1) state.adds = 1;
  if (pos && state.lastBuyPx <= 0) state.lastBuyPx = pos.entryPrice;
  if (pos && state.anchor <= 0) state.anchor = pos.entryPrice;

  const mark = bid > 0 ? bid : price;
  const lot = Math.max(10_000, Math.floor(lotIdr));

  if (pos && pos.qty > 0) {
    const tp = pos.entryPrice * (1 + stepPct);
    if (mark >= tp) {
      const n = Math.max(1, state.adds);
      const sellQty = pos.qty / n;
      return {
        state,
        action: "SELL_LOT",
        reason: `GRID TP +${(stepPct * 100).toFixed(1)}%`,
        sellQty,
      };
    }
  }

  if (cash < 10_000 || lot > cash * 1.02) {
    return { state, action: "HOLD", reason: "grid: cash < lot" };
  }
  if (state.adds >= maxAdds) {
    return { state, action: "HOLD", reason: `grid: max ${maxAdds} lot` };
  }

  const dump = (change24h ?? 0) < -18;
  if (!pos) {
    if (regime === "TREND_DOWN" || dump) {
      return { state, action: "HOLD", reason: "grid: tunggu dump reda" };
    }
    return {
      state,
      action: "BUY",
      reason: "GRID seed",
      sizeIdr: Math.min(lot, Math.floor(cash * 0.92)),
    };
  }

  const trigger = state.lastBuyPx * (1 - stepPct);
  if (price <= trigger && !dump) {
    return {
      state,
      action: "BUY",
      reason: `GRID add −${(stepPct * 100).toFixed(1)}%`,
      sizeIdr: Math.min(lot, Math.floor(cash * 0.92)),
    };
  }

  return { state, action: "HOLD", reason: "grid: di antara level" };
}
