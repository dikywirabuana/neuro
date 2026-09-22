import { ema, rsi } from "./indicators";
import type { Signal } from "./types";

export type SetupKind = "BOUNCE" | "PULLBACK" | "BREAKOUT" | "NONE";

export type SmartSetup = {
  kind: SetupKind;
  score: number;
  signal: Signal;
  reason: string;
  stopPct: number;
  tpPct: number;
  holdMin: number;
  dumpLow: number;
  localPeak: number;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function feeAwareTpPct(spreadPct: number, feeRate = 0.0025): number {
  const cost = feeRate * 2 + spreadPct / 100;
  return clamp(cost + 0.01, 0.018, 0.028);
}

function none(reason: string, last: number, extras?: { high?: number; low?: number }): SmartSetup {
  return {
    kind: "NONE",
    score: 28,
    signal: "HOLD",
    reason,
    stopPct: 0.018,
    tpPct: 0.02,
    holdMin: 12,
    dumpLow: extras?.low ?? last,
    localPeak: extras?.high ?? last,
  };
}

const SKIP_MAJOR = /^(btc|eth)_idr$/;

/**
 * Smart Agresif — longgar supaya tetap masuk:
 * tape rame + tidak crash, atau dip yang sudah berhenti jatuh.
 * Tick 15 detik tidak wajib hijau.
 */
export function detectSetup(
  closes: number[],
  last: number,
  extras: {
    high: number;
    low: number;
    spreadPct: number;
    volumeIdr: number;
    rsi?: number | null;
    emaFast?: number | null;
    change24h?: number;
    pair?: string;
  },
): SmartSetup {
  const px = last > 0 ? last : closes[closes.length - 1] ?? 0;
  if (!(px > 0)) return none("harga invalid", 0);

  if (extras.pair && SKIP_MAJOR.test(extras.pair.toLowerCase())) {
    return none("skip BTC/ETH", px, extras);
  }
  if (extras.volumeIdr < 80_000_000) {
    return none("volume tipis", px, extras);
  }
  if (extras.spreadPct > 0.7) {
    return none(`spread ${extras.spreadPct.toFixed(2)}%`, px, extras);
  }

  const series = closes.length >= 3 ? closes : [...closes, px];
  const prev = series[series.length - 2] ?? px;
  const rsiVal =
    series.length >= 15
      ? (rsi(series, 14) ?? extras.rsi ?? null)
      : extras.rsi ?? null;

  const tape = hotTape(px, prev, rsiVal, series, extras);
  const dip = dipSnatch(px, prev, rsiVal, extras);
  const ranked = [tape, dip]
    .filter((s) => s.kind !== "NONE")
    .sort((a, b) => b.score - a.score);
  if (ranked[0]) return ranked[0];

  if (rsiVal != null && rsiVal > 82) {
    return { ...none("jenuh beli", px, extras), score: 20, signal: "SELL" };
  }
  return none("sepi", px, extras);
}

function hotTape(
  px: number,
  prev: number,
  rsiVal: number | null,
  series: number[],
  extras: {
    spreadPct: number;
    volumeIdr: number;
    high: number;
    low: number;
    change24h?: number;
  },
): SmartSetup {
  const { high, low } = extras;
  if (!(high > low)) return none("range invalid", px, extras);
  const chg = extras.change24h ?? 0;
  if (chg < -16) return none(`dump ${chg.toFixed(1)}%`, px, extras);
  if (extras.volumeIdr < 120_000_000) return none("tape sepi", px, extras);

  const dayPos = (px - low) / (high - low);
  if (dayPos < 0.08) return none("masih di lantai", px, extras);
  if (dayPos > 0.97 && chg > 18) return none("chase puncak", px, extras);

  const falling = px < prev * 0.997;
  if (falling) return none("masih jatuh", px, extras);

  if (rsiVal != null && rsiVal > 78) return none(`RSI ${rsiVal.toFixed(0)} jenuh`, px, extras);
  if (rsiVal != null && rsiVal < 28) return none("RSI terlalu lemah untuk tape", px, extras);

  const e8 = series.length >= 8 ? ema(series, 8) : null;
  const aboveEma = e8 == null || px >= e8 * 0.994;

  const volN = clamp(Math.log10(extras.volumeIdr / 120_000_000) / 2.4, 0, 1);
  const tight = extras.spreadPct <= 0.35 ? 8 : extras.spreadPct <= 0.5 ? 4 : 0;
  const lift = px >= prev ? 5 : 0;
  const emaPts = aboveEma ? 6 : 0;
  const rsiPts = rsiVal != null && rsiVal >= 40 && rsiVal <= 68 ? 6 : 0;
  const score = clamp(
    50 + volN * 28 + tight + lift + emaPts + rsiPts - extras.spreadPct * 8,
    0,
    99,
  );

  if (score < 54) return none("tape lemah", px, extras);

  return {
    kind: "BREAKOUT",
    score: Math.round(score),
    signal: score >= 72 ? "STRONG_BUY" : score >= 56 ? "BUY" : "HOLD",
    reason: `TAPE ${(extras.volumeIdr / 1e6).toFixed(0)}jt · RSI ${rsiVal?.toFixed(0) ?? "—"}`,
    stopPct: 0.018,
    tpPct: feeAwareTpPct(extras.spreadPct),
    holdMin: 16,
    dumpLow: low,
    localPeak: high,
  };
}

function dipSnatch(
  px: number,
  prev: number,
  rsiVal: number | null,
  extras: {
    spreadPct: number;
    volumeIdr: number;
    high: number;
    low: number;
    change24h?: number;
  },
): SmartSetup {
  const { high, low } = extras;
  if (!(high > low)) return none("range invalid", px, extras);
  if (extras.volumeIdr < 100_000_000) return none("dip sepi", px, extras);
  if (extras.spreadPct > 0.65) return none("spread dip lebar", px, extras);

  const chg = extras.change24h ?? 0;
  if (chg < -18) return none("knife", px, extras);

  const dayPos = (px - low) / (high - low);
  const notDumping = px >= prev * 0.9985;
  const rsiDip = rsiVal != null && rsiVal <= 46;
  const nearLow = dayPos <= 0.42;

  if (!rsiDip && !nearLow) return none("bukan zona dip", px, extras);
  if (!notDumping) return none("masih jatuh", px, extras);

  const volN = clamp(Math.log10(extras.volumeIdr / 100_000_000) / 2, 0, 1);
  const rsiEdge = rsiVal != null && rsiVal <= 46 ? (46 - rsiVal) * 0.5 : 0;
  const score = clamp(
    52 + rsiEdge + volN * 18 + (nearLow ? 6 : 0) + (notDumping ? 4 : 0) - extras.spreadPct * 8,
    0,
    99,
  );

  if (score < 56) return none("dip lemah", px, extras);

  return {
    kind: "BOUNCE",
    score: Math.round(score),
    signal: score >= 72 ? "STRONG_BUY" : score >= 56 ? "BUY" : "HOLD",
    reason: `DIP RSI ${rsiVal?.toFixed(0) ?? "—"} · pos ${dayPos.toFixed(2)}`,
    stopPct: clamp((px - low * 0.992) / px, 0.014, 0.026),
    tpPct: feeAwareTpPct(extras.spreadPct),
    holdMin: 14,
    dumpLow: low,
    localPeak: high,
  };
}
