/** Technical indicators — pandas-free, array-based. */

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const avgG = gain / period;
  const avgL = loss / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

export function ema(series: number[], span: number): number | null {
  if (series.length < span) return null;
  const k = 2 / (span + 1);
  let e = series[0];
  for (let i = 1; i < series.length; i++) e = series[i] * k + e * (1 - k);
  return e;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { line: number; signal: number; hist: number } | null {
  if (closes.length < slow + signal) return null;
  const lineSeries: number[] = [];
  const kF = 2 / (fast + 1);
  const kS = 2 / (slow + 1);
  let eF = closes[0];
  let eS = closes[0];
  for (let i = 1; i < closes.length; i++) {
    eF = closes[i] * kF + eF * (1 - kF);
    eS = closes[i] * kS + eS * (1 - kS);
    lineSeries.push(eF - eS);
  }
  if (lineSeries.length < signal) return null;
  const kSig = 2 / (signal + 1);
  let sig = lineSeries[0];
  for (let i = 1; i < lineSeries.length; i++) {
    sig = lineSeries[i] * kSig + sig * (1 - kSig);
  }
  const line = lineSeries[lineSeries.length - 1];
  return { line, signal: sig, hist: line - sig };
}

export function bollinger(
  closes: number[],
  period = 20,
  stdDev = 2,
): { upper: number; mid: number; lower: number } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((s, x) => s + x, 0) / period;
  const variance =
    slice.reduce((s, x) => s + (x - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return { upper: mid + std * stdDev, mid, lower: mid - std * stdDev };
}

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < period + 1) return null;
  let sum = 0;
  for (let i = n - period; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    sum += tr;
  }
  return sum / period;
}

export type TechDetails = {
  rsi: number | null;
  rsiScore: number;
  macd: number | null;
  macdScore: number;
  bbPos: number | null;
  bbScore: number;
  emaFast: number | null;
  emaSlow: number | null;
  emaScore: number;
  volRatio: number | null;
  volScore: number;
  atrPct: number | null;
  atrScore: number;
};

export type TechScore = {
  score: number;
  details: TechDetails;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Composite 0–100 from the spec:
 * RSI 0–20, MACD 0–20, BB 0–20, EMA 0–20, Volume 0–10, ATR 0–10
 */
export function calculateTechScore(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes?: number[],
): TechScore {
  const details: TechDetails = {
    rsi: null,
    rsiScore: 10,
    macd: null,
    macdScore: 10,
    bbPos: null,
    bbScore: 10,
    emaFast: null,
    emaSlow: null,
    emaScore: 10,
    volRatio: null,
    volScore: 5,
    atrPct: null,
    atrScore: 5,
  };

  if (closes.length < 8) {
    return { score: 50, details };
  }

  const last = closes[closes.length - 1];

  const rsiVal = rsi(closes, 14);
  details.rsi = rsiVal != null ? Math.round(rsiVal * 10) / 10 : null;
  if (rsiVal != null) {
    details.rsiScore = clamp((70 - rsiVal) / 2, 0, 20);
  }

  const m = macd(closes);
  if (m) {
    details.macd = Math.round(m.line * 10000) / 10000;
    if (m.line > m.signal && m.hist > 0) details.macdScore = 20;
    else if (m.line > m.signal) details.macdScore = 15;
    else if (m.line < m.signal && m.hist < 0) details.macdScore = 0;
    else details.macdScore = 5;
  }

  const bb = bollinger(closes);
  if (bb && bb.upper !== bb.lower) {
    details.bbPos =
      Math.round(((last - bb.lower) / (bb.upper - bb.lower)) * 1000) / 10;
    if (last <= bb.lower) details.bbScore = 20;
    else if (last >= bb.upper) details.bbScore = 0;
    else if (last < bb.mid) details.bbScore = 15;
    else details.bbScore = 5;
  }

  const ef = ema(closes, 9);
  const es = ema(closes, 21);
  details.emaFast = ef;
  details.emaSlow = es;
  if (ef != null && es != null) {
    const prevEf = ema(closes.slice(0, -1), 9);
    const prevEs = ema(closes.slice(0, -1), 21);
    if (prevEf != null && prevEs != null && ef > es && prevEf <= prevEs) {
      details.emaScore = 20;
    } else if (ef > es) details.emaScore = 15;
    else if (prevEf != null && prevEs != null && ef < es && prevEf >= prevEs) {
      details.emaScore = 0;
    } else details.emaScore = 5;
  }

  if (volumes && volumes.length >= 10) {
    const recent = volumes.slice(-20);
    const avg = recent.reduce((s, x) => s + x, 0) / recent.length;
    const curr = volumes[volumes.length - 1];
    if (avg > 0) {
      const ratio = curr / avg;
      details.volRatio = Math.round(ratio * 100) / 100;
      if (ratio > 2) details.volScore = 10;
      else if (ratio > 1.5) details.volScore = 8;
      else if (ratio > 1) details.volScore = 6;
      else details.volScore = 3;
    }
  }

  const a = atr(highs, lows, closes);
  if (a != null && last > 0) {
    const pct = (a / last) * 100;
    details.atrPct = Math.round(pct * 10) / 10;
    if (pct < 1) details.atrScore = 10;
    else if (pct < 3) details.atrScore = 7;
    else if (pct < 5) details.atrScore = 5;
    else details.atrScore = 2;
  }

  const total =
    details.rsiScore +
    details.macdScore +
    details.bbScore +
    details.emaScore +
    details.volScore +
    details.atrScore;
  return { score: Math.round(clamp(total, 0, 100)), details };
}

/** Fallback when we only have 24h ticker (no candle history). */
export function tickerProxyTech(
  last: number,
  high: number,
  low: number,
  volumeIdr: number,
): TechScore {
  const rangePos = high > low ? (last - low) / (high - low) : 0.5;
  const dayPct = low > 0 ? ((high - low) / low) * 100 : 0;
  const rsiProxy = clamp(30 + rangePos * 50, 10, 90);
  const rsiScore = clamp((70 - rsiProxy) / 2, 0, 20);
  const bbScore = rangePos <= 0.2 ? 20 : rangePos >= 0.9 ? 0 : rangePos < 0.5 ? 15 : 5;
  const volScore = volumeIdr > 2e9 ? 10 : volumeIdr > 5e8 ? 7 : 4;
  const atrScore = dayPct < 3 ? 10 : dayPct < 8 ? 7 : dayPct < 15 ? 5 : 2;
  const emaScore = rangePos > 0.55 ? 15 : 5;
  const macdScore = rangePos > 0.5 && dayPct > 2 ? 15 : 8;
  const score = Math.round(
    rsiScore + macdScore + bbScore + emaScore + volScore + atrScore,
  );
  return {
    score: clamp(score, 0, 100),
    details: {
      rsi: Math.round(rsiProxy * 10) / 10,
      rsiScore,
      macd: null,
      macdScore,
      bbPos: Math.round(rangePos * 1000) / 10,
      bbScore,
      emaFast: last,
      emaSlow: (high + low) / 2,
      emaScore,
      volRatio: null,
      volScore,
      atrPct: Math.round(dayPct * 10) / 10,
      atrScore,
    },
  };
}
