import type { Trade } from "./types";

export type ScoreWeights = {
  range: number;
  volume: number;
  spread: number;
  bias: number;
};

export const DEFAULT_WEIGHTS: ScoreWeights = {
  range: 0.28,
  volume: 0.42,
  spread: 0.22,
  bias: 0.08,
};

/**
 * Adapt score weights from recent closed trades.
 * Win streak → trust momentum (range) more.
 * Losses → trust volume/liquidity more, reduce range chase.
 */
export function adaptWeights(trades: Trade[]): ScoreWeights {
  const sells = trades.filter((t) => t.side === "SELL").slice(-20);
  if (sells.length < 3) return { ...DEFAULT_WEIGHTS };

  const wins = sells.filter((t) => t.pnl > 0).length;
  const winRate = wins / sells.length;
  const avgPnl =
    sells.reduce((s, t) => s + t.pnl, 0) / Math.max(1, sells.length);

  let range = 0.45;
  let volume = 0.3;
  let spread = 0.2;
  const bias = 0.05;

  if (winRate >= 0.55 && avgPnl > 0) {
    range = 0.52;
    volume = 0.28;
    spread = 0.15;
  } else if (winRate < 0.4 || avgPnl < 0) {
    range = 0.32;
    volume = 0.42;
    spread = 0.21;
  }

  const sum = range + volume + spread + bias;
  return {
    range: range / sum,
    volume: volume / sum,
    spread: spread / sum,
    bias: bias / sum,
  };
}

export function describeWeights(w: ScoreWeights): string {
  return `range ${(w.range * 100).toFixed(0)}% · vol ${(w.volume * 100).toFixed(0)}% · spread ${(w.spread * 100).toFixed(0)}%`;
}
