import { evaluateEntry } from "./entry";
import type { MarketRegime } from "./regime";

export type HeuristicCandidate = {
  pair: string;
  score: number;
  signal: string;
  price: number;
  rangePos: number;
  volumeIdr: number;
  spreadPct: number;
  dayRangePct?: number;
  setup?: "BOUNCE" | "PULLBACK" | "BREAKOUT" | "NONE";
  setupReason?: string;
  setupStopPct?: number;
  setupTpPct?: number;
};

export type HeuristicDecision = {
  pair: string;
  action: "BUY" | "SKIP";
  confidence: number;
  reason: string;
};

export type HeuristicOpts = {
  allowEntry: boolean;
  openPositions: number;
  maxPositions: number;
  minScore?: number;
  feeRate?: number;
  minRangePos?: number;
  maxSpreadPct?: number;
  regime?: MarketRegime;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function heuristicDecide(
  candidates: HeuristicCandidate[],
  opts: HeuristicOpts,
): HeuristicDecision[] {
  const {
    allowEntry,
    openPositions,
    maxPositions,
    feeRate = 0.0025,
    regime,
  } = opts;
  const slots = Math.max(0, maxPositions - openPositions);

  if (!allowEntry) {
    // Tetap ranking; diam total bikin bot sepi semalaman.
  }

  const ranked = candidates
    .map((c) => {
      const ev = evaluateEntry(c, feeRate, { regime });
      const edge = ev.ok ? c.score : -1;
      return { c, ev, edge };
    })
    .sort((a, b) => b.edge - a.edge);

  const maxBuy = Math.min(slots, 1);
  let bought = 0;
  return ranked.slice(0, 8).map(({ c, ev, edge }) => {
    const need = 56;
    const slotBuy = ev.ok && bought < maxBuy && edge >= need;
    const ok = slotBuy;
    if (ok) bought += 1;
    return {
      pair: c.pair,
      action: ok ? ("BUY" as const) : ("SKIP" as const),
      confidence: ok ? clamp(0.64 + edge / 200, 0.64, 0.94) : 0.4,
      reason: ok
        ? `${c.setup} BUY · ${ev.reason}`
        : `Skip: ${ev.ok ? "bukan setup terkuat" : ev.reason}`,
    };
  });
}
