export type HorizonBias = "UP" | "FLAT" | "DOWN";

export type HorizonForecast = {
  minutes: number;
  pct: number;
  bias: HorizonBias;
  conf: number;
};

export type PairForecast = {
  m5: HorizonForecast;
  m15: HorizonForecast;
  m30: HorizonForecast;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function linreg(ys: number[]): { slope: number; r2: number } {
  const n = ys.length;
  if (n < 3) return { slope: 0, r2: 0 };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += ys[i];
    sxx += i * i;
    sxy += i * ys[i];
  }
  const den = n * sxx - sx * sx;
  if (den === 0) return { slope: 0, r2: 0 };
  const slope = (n * sxy - sx * sy) / den;
  const mean = sy / n;
  let ssTot = 0;
  let ssRes = 0;
  const intercept = (sy - slope * sx) / n;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * i;
    ssTot += (ys[i] - mean) ** 2;
    ssRes += (ys[i] - pred) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { slope, r2: clamp(r2, 0, 1) };
}

function biasOf(pct: number): HorizonBias {
  if (pct >= 0.28) return "UP";
  if (pct <= -0.28) return "DOWN";
  return "FLAT";
}

/**
 * Perkiraan 5 / 15 / 30 menit ke depan. 30 menit = sinyal utama.
 */
export function forecastPair(
  closes: number[],
  last: number,
  extras?: {
    rsi?: number | null;
    macd?: number | null;
    rangePos?: number;
    dayRangePct?: number;
    barSec?: number;
  },
): PairForecast {
  const px = last > 0 ? last : closes[closes.length - 1] ?? 0;
  const emptyHz = (minutes: number): HorizonForecast => ({
    minutes,
    pct: 0,
    bias: "FLAT",
    conf: 0.15,
  });
  const empty: PairForecast = {
    m5: emptyHz(5),
    m15: emptyHz(15),
    m30: emptyHz(30),
  };
  if (!(px > 0)) return empty;

  const series = closes.length ? [...closes] : [px];
  if (series[series.length - 1] !== px) series.push(px);

  const barSec = extras?.barSec && extras.barSec > 0 ? extras.barSec : 4;
  const bars5 = Math.max(4, Math.round(300 / barSec));
  const bars15 = Math.max(8, Math.round(900 / barSec));
  const bars30 = Math.max(12, Math.round(1800 / barSec));

  const short = series.slice(-Math.min(series.length, bars5));
  const mid = series.slice(-Math.min(series.length, bars15));
  const long = series.slice(-Math.min(series.length, bars30));
  const a = linreg(short);
  const b = linreg(mid);
  const c = linreg(long);

  const slope5Pct = (a.slope / px) * bars5 * 100;
  const slope15Pct = (b.slope / px) * bars15 * 100;
  const slope30Pct = (c.slope / px) * bars30 * 100;

  let m5 = slope5Pct * (0.55 + 0.35 * a.r2);
  let m15 = (slope15Pct * 0.65 + slope5Pct * 0.35) * (0.5 + 0.35 * b.r2);
  let m30 =
    (slope30Pct * 0.55 + slope15Pct * 0.3 + slope5Pct * 0.15) *
    (0.48 + 0.4 * c.r2);

  const rsi = extras?.rsi;
  if (rsi != null) {
    if (rsi > 72) {
      m5 -= 0.35;
      m15 -= 0.22;
      m30 -= 0.28;
    } else if (rsi < 32) {
      m5 += 0.3;
      m15 += 0.18;
      m30 += 0.22;
    }
  }
  const macd = extras?.macd;
  if (macd != null) {
    if (macd > 0) {
      m5 += 0.08;
      m15 += 0.12;
      m30 += 0.18;
    } else {
      m5 -= 0.08;
      m15 -= 0.12;
      m30 -= 0.18;
    }
  }
  const rp = extras?.rangePos;
  if (rp != null) {
    if (rp > 0.88) {
      m5 -= 0.25;
      m15 -= 0.18;
      m30 -= 0.22;
    } else if (rp < 0.22) {
      m5 += 0.12;
      m30 += 0.1;
    }
  }

  const day = extras?.dayRangePct ?? 0;
  if (day > 0) {
    m5 = clamp(m5, -day * 0.35, day * 0.35);
    m15 = clamp(m15, -day * 0.55, day * 0.55);
    m30 = clamp(m30, -day * 0.75, day * 0.75);
  }
  m5 = clamp(m5, -3.5, 3.5);
  m15 = clamp(m15, -6.5, 6.5);
  m30 = clamp(m30, -8.5, 8.5);

  const conf5 = clamp(0.2 + a.r2 * 0.55 + (series.length >= 12 ? 0.1 : 0), 0.15, 0.85);
  const conf15 = clamp(0.18 + b.r2 * 0.5 + (series.length >= 24 ? 0.12 : 0), 0.12, 0.8);
  const conf30 = clamp(0.22 + c.r2 * 0.58 + (series.length >= 36 ? 0.14 : 0), 0.16, 0.88);

  return {
    m5: {
      minutes: 5,
      pct: Math.round(m5 * 100) / 100,
      bias: biasOf(m5),
      conf: Math.round(conf5 * 100) / 100,
    },
    m15: {
      minutes: 15,
      pct: Math.round(m15 * 100) / 100,
      bias: biasOf(m15),
      conf: Math.round(conf15 * 100) / 100,
    },
    m30: {
      minutes: 30,
      pct: Math.round(m30 * 100) / 100,
      bias: biasOf(m30),
      conf: Math.round(conf30 * 100) / 100,
    },
  };
}

export function forecastLift(fc: PairForecast): number {
  let lift = 0;
  if (fc.m30.bias === "UP") lift += 16 * fc.m30.conf;
  if (fc.m30.bias === "DOWN") lift -= 18 * fc.m30.conf;
  if (fc.m15.bias === "UP") lift += 5 * fc.m15.conf;
  if (fc.m15.bias === "DOWN") lift -= 6 * fc.m15.conf;
  if (fc.m5.bias === "UP") lift += 2 * fc.m5.conf;
  if (fc.m5.bias === "DOWN") lift -= 3 * fc.m5.conf;
  return lift;
}
