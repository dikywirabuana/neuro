import { bollinger, ema, rsi } from "./indicators";
import { fetchJson } from "./http";

export type HtfBias = "UP" | "RANGE" | "DOWN";

export type OhlcBar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type HtfCache = { at: number; bars: OhlcBar[]; bias: HtfBias };
const cache = new Map<string, HtfCache>();
const TTL_MS = 3 * 60_000;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function biasFromCloses(closes: number[]): HtfBias {
  if (closes.length < 20) return "RANGE";
  const e20 = ema(closes, 20);
  const e50 = closes.length >= 50 ? ema(closes, 50) : ema(closes, 20);
  const last = closes[closes.length - 1];
  if (e20 == null || e50 == null || !(last > 0)) return "RANGE";
  const prev = ema(closes.slice(0, -3), 20);
  const slopeDown = prev != null && e20 < prev * 0.998;
  const slopeUp = prev != null && e20 > prev * 1.002;
  if (e20 < e50 * 0.998 && last < e20 && slopeDown) return "DOWN";
  if (e20 > e50 * 1.001 && last > e20 && slopeUp) return "UP";
  if (e20 < e50 && last < e20) return "DOWN";
  if (e20 > e50 && last > e20) return "UP";
  return "RANGE";
}

export async function fetchOhlcBars(
  pair: string,
  tf: "15" | "60" | "240",
): Promise<OhlcBar[]> {
  const key = `${pair}|${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS && hit.bars.length >= 20) {
    return hit.bars;
  }
  try {
    const raw = await fetchJson<{ bars?: OhlcBar[] }>(
      `/api/indodax/ohlc?pair=${encodeURIComponent(pair)}&tf=${tf}`,
      8_000,
    );
    const bars = Array.isArray(raw.bars) ? raw.bars.filter((b) => b.c > 0) : [];
    const bias = biasFromCloses(bars.map((b) => b.c));
    cache.set(key, { at: Date.now(), bars, bias });
    return bars;
  } catch {
    if (hit) return hit.bars;
    return [];
  }
}

export async function getHtfBias(
  pair: string,
  tf: "60" | "240" = "240",
): Promise<HtfBias> {
  const key = `${pair}|${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.bias;
  const bars = await fetchOhlcBars(pair, tf);
  if (bars.length < 20) return "RANGE";
  return biasFromCloses(bars.map((b) => b.c));
}

export type BbRsiConfirm = {
  ok: boolean;
  reason: string;
  mid?: number;
  upper?: number;
  lower?: number;
  stopPct?: number;
  wick?: boolean;
  rsi?: number;
};

/** H1: candle close di bawah lower BB(20,2) + RSI(14) < 30 + rejection. */
export async function confirmBbRsiLong(
  pair: string,
  lastPx: number,
): Promise<BbRsiConfirm> {
  const bars = await fetchOhlcBars(pair, "60");
  if (bars.length < 22) {
    return { ok: false, reason: "H1 OHLC kurang untuk BB(20)" };
  }
  const closed = bars.slice(0, -1);
  const lastClosed = closed[closed.length - 1];
  if (!lastClosed) return { ok: false, reason: "H1 candle kosong" };
  const closes = closed.map((b) => b.c);
  const bb = bollinger(closes, 20, 2);
  const r = rsi(closes, 14);
  if (!bb || r == null) return { ok: false, reason: "BB/RSI H1 gagal" };
  if (lastClosed.c > bb.lower * 1.002) {
    return {
      ok: false,
      reason: `H1 close belum di bawah lower BB (${lastClosed.c.toFixed(0)} > ${bb.lower.toFixed(0)})`,
      rsi: r,
      lower: bb.lower,
    };
  }
  if (r >= 30) {
    return { ok: false, reason: `RSI H1 ${r.toFixed(0)} ≥ 30`, rsi: r };
  }
  const range = lastClosed.h - lastClosed.l;
  const lowerWick =
    Math.min(lastClosed.o, lastClosed.c) - lastClosed.l;
  const wick = range > 0 && lowerWick / range >= 0.35;
  if (!(lastPx > lastClosed.c * 0.9995) && !wick) {
    return { ok: false, reason: "belum rejection / tick balik dari lower BB" };
  }
  if (!(bb.mid > lastPx)) {
    return { ok: false, reason: "sudah di atas middle BB — skip chase" };
  }
  const slPx = Math.min(lastClosed.l, bb.lower) * 0.995;
  const stopPct = clamp((lastPx - slPx) / lastPx, 0.012, 0.028);
  return {
    ok: true,
    reason: wick
      ? `BB+RSI H1 close under · RSI ${r.toFixed(0)} · wick`
      : `BB+RSI H1 close under · RSI ${r.toFixed(0)}`,
    mid: bb.mid,
    upper: bb.upper,
    lower: bb.lower,
    stopPct,
    wick,
    rsi: r,
  };
}
