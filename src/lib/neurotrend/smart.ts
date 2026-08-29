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

/** TP minimum: round-trip fee + spread + net edge 0.6%. */
export function feeAwareTpPct(spreadPct: number, feeRate = 0.0025): number {
  const cost = feeRate * 2 + spreadPct / 100;
  return clamp(cost + 0.006, 0.012, 0.028);
}

function none(reason: string, last: number, extras?: { high?: number; low?: number }): SmartSetup {
  return {
    kind: "NONE",
    score: 36,
    signal: "HOLD",
    reason,
    stopPct: 0.016,
    tpPct: 0.014,
    holdMin: 12,
    dumpLow: extras?.low ?? last,
    localPeak: extras?.high ?? last,
  };
}

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
  },
): SmartSetup {
  const px = last > 0 ? last : closes[closes.length - 1] ?? 0;
  if (!(px > 0)) return none("harga invalid", 0);

  if (extras.volumeIdr < 400_000_000) {
    return none("volume tipis, buku tidak cukup", px, extras);
  }
  if (extras.spreadPct > 0.65) {
    return none(`spread ${extras.spreadPct.toFixed(2)}% makan fee`, px, extras);
  }

  const series = closes.length >= 4 ? closes : [...closes, px];
  const window = series.slice(-24);
  const rsiVal =
    extras.rsi ?? rsi(series, Math.min(14, Math.max(5, series.length - 1)));
  const e = extras.emaFast ?? ema(series, Math.min(12, window.length));
  const prev = window[window.length - 2] ?? px;
  const rsiUse = series.length >= 20 ? rsiVal : null;

  const bounce = bounceSetup(px, prev, rsiUse, extras);
  const pull = pullbackSetup(px, prev, rsiUse, e, extras);
  const brk = breakoutSetup(px, prev, rsiUse, extras);

  const ranked = [bounce, pull, brk]
    .filter((s) => s.kind !== "NONE")
    .sort((a, b) => b.score - a.score);
  if (ranked[0]) return ranked[0];

  if (rsiVal != null && rsiVal > 76) {
    return { ...none("jenuh beli", px, extras), score: 24, signal: "SELL" };
  }
  return none("tidak ada setup", px, extras);
}

function bounceSetup(
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
  if (!(high > low) || !(low > 0)) return none("range invalid", px, extras);
  const dumpPct = ((high - low) / high) * 100;
  const offLow = ((px - low) / low) * 100;
  const dayPos = (px - low) / (high - low);
  const recovering = px > prev * 1.0015;
  const chg = extras.change24h;

  if (extras.volumeIdr < 800_000_000) {
    return none("bounce butuh volume besar", px, extras);
  }
  if (extras.spreadPct > 0.45) return none("spread bounce lebar", px, extras);
  if (dumpPct < 1.8 || dumpPct > 16) return none("bukan panic yang bisa rebound", px, extras);
  if (dayPos < 0.06 || dayPos > 0.28) return none("bukan zona rebound", px, extras);
  if (!recovering) return none("belum ada tick balik", px, extras);
  if (offLow < 0.15 || offLow > 3.2) return none("bukan bounce dari low", px, extras);
  if (chg != null && chg < -10) return none(`masih dump 24h ${chg.toFixed(1)}%`, px, extras);
  if (rsiVal != null && rsiVal > 42) {
    return none(`RSI ${rsiVal.toFixed(0)} belum oversold`, px, extras);
  }

  const volN = clamp(Math.log10(extras.volumeIdr / 800_000_000) / 2, 0, 1);
  const score = clamp(
    48 +
      (0.22 - dayPos) * 50 +
      volN * 10 +
      (recovering ? 8 : 0) -
      extras.spreadPct * 14 -
      Math.max(0, dumpPct - 8) * 1.2,
    0,
    99,
  );

  const slPx = low * 0.993;
  const sl = clamp((px - slPx) / px, 0.01, 0.022);
  const tp = Math.max(feeAwareTpPct(extras.spreadPct), 0.014);

  return {
    kind: "BOUNCE",
    score: Math.round(score),
    signal: score >= 72 ? "STRONG_BUY" : score >= 64 ? "BUY" : "HOLD",
    reason: `BOUNCE pos ${dayPos.toFixed(2)} · dump ${dumpPct.toFixed(1)}% · tick naik`,
    stopPct: sl,
    tpPct: tp,
    holdMin: 16,
    dumpLow: low,
    localPeak: high,
  };
}

function pullbackSetup(
  px: number,
  prev: number,
  rsiVal: number | null,
  e: number | null,
  extras: { spreadPct: number; volumeIdr: number; high: number; low: number },
): SmartSetup {
  const { high, low } = extras;
  if (!(high > low) || !(high > 0)) return none("range invalid", px, extras);
  const dayPos = (px - low) / (high - low);
  const pullPct = ((high - px) / high) * 100;
  const aboveEma = e == null || px >= e * 0.992;

  if (dayPos < 0.36 || dayPos > 0.82) return none("bukan zona pullback", px, extras);
  if (pullPct < 0.35 || pullPct > 14) return none("bukan pullback", px, extras);
  if (!aboveEma) return none("di bawah EMA", px, extras);
  if (rsiVal != null && (rsiVal < 34 || rsiVal > 64)) {
    return none(`RSI ${rsiVal.toFixed(0)} di luar zona pullback`, px, extras);
  }
  if (extras.spreadPct > 0.7) return none("spread pullback lebar", px, extras);
  if (px < prev * 0.997) return none("pullback masih jatuh", px, extras);

  const volN = clamp(Math.log10(extras.volumeIdr / 250_000_000) / 2, 0, 1);
  const score = clamp(
    56 +
      (1.2 - Math.abs(dayPos - 0.55)) * 20 +
      volN * 12 -
      extras.spreadPct * 12,
    0,
    99,
  );

  return {
    kind: "PULLBACK",
    score: Math.round(score),
    signal: score >= 74 ? "STRONG_BUY" : score >= 62 ? "BUY" : "HOLD",
    reason: `PULLBACK −${pullPct.toFixed(1)}% dari high · pos ${dayPos.toFixed(2)}`,
    stopPct: 0.016,
    tpPct: Math.max(feeAwareTpPct(extras.spreadPct), 0.013),
    holdMin: 16,
    dumpLow: low,
    localPeak: high,
  };
}

function breakoutSetup(
  px: number,
  prev: number,
  rsiVal: number | null,
  extras: { spreadPct: number; volumeIdr: number; high: number; low: number },
): SmartSetup {
  if (extras.volumeIdr < 300_000_000) return none("breakout butuh volume", px, extras);
  if (extras.spreadPct > 0.6) return none("spread breakout lebar", px, extras);
  const { high, low } = extras;
  if (!(high > 0)) return none("high invalid", px, extras);
  const dayPos = high > low ? (px - low) / (high - low) : 0.5;
  const above = px >= high * 0.994;
  const notExtended = px <= high * 1.015;
  const lifting = px >= prev * 0.999;

  if (dayPos < 0.84 || !above || !notExtended) return none("bukan breakout", px, extras);
  if (!lifting) return none("breakout lemah", px, extras);
  if (rsiVal != null && (rsiVal < 50 || rsiVal > 74)) {
    return none(`RSI ${rsiVal.toFixed(0)} bukan zona breakout`, px, extras);
  }

  const volN = clamp(Math.log10(extras.volumeIdr / 400_000_000) / 2, 0, 1);
  const score = clamp(
    60 + volN * 16 - extras.spreadPct * 14 + (rsiVal != null && rsiVal < 66 ? 6 : 0),
    0,
    99,
  );

  const sl = clamp((px - high * 0.982) / px, 0.012, 0.022);
  return {
    kind: "BREAKOUT",
    score: Math.round(score),
    signal: score >= 76 ? "STRONG_BUY" : score >= 66 ? "BUY" : "HOLD",
    reason: `BREAKOUT near high · pos ${dayPos.toFixed(2)} · RSI ${rsiVal?.toFixed(0) ?? "—"}`,
    stopPct: sl,
    tpPct: Math.max(feeAwareTpPct(extras.spreadPct), 0.015),
    holdMin: 18,
    dumpLow: low,
    localPeak: high,
  };
}
