import type { ScoreWeights } from "./adaptive";
import { DEFAULT_WEIGHTS } from "./adaptive";
import {
  calculateTechScore,
  tickerProxyTech,
} from "./indicators";
import {
  isNewCoinCandidate,
  isTradeablePair,
  listingPriority,
  minVolumeForPair,
  newCoinBoost,
  newCoinTag,
  type ScanFocus,
} from "./new-coins";
import { detectSetup } from "./smart";
import { forecastPair } from "./forecast";
import type { Opportunity } from "./types";

type TickerRow = {
  high?: string | number;
  low?: string | number;
  last?: string | number;
  buy?: string | number;
  sell?: string | number;
  vol_idr?: string | number;
  [key: string]: unknown;
};

export type PriceHistory = Record<string, number[]>;

function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export type ScoreOptions = {
  minVolumeIdr: number;
  weights?: ScoreWeights;
  focus?: ScanFocus;
  newCoinMinVolume?: number;
  priceHistory?: PriceHistory;
  barSec?: number;
};

export function scoreMarket(
  tickers: Record<string, TickerRow>,
  minVolumeIdrOrOpts: number | ScoreOptions,
  weightsArg: ScoreWeights = DEFAULT_WEIGHTS,
): Opportunity[] {
  const opts: ScoreOptions =
    typeof minVolumeIdrOrOpts === "number"
      ? { minVolumeIdr: minVolumeIdrOrOpts, weights: weightsArg, focus: "all" }
      : minVolumeIdrOrOpts;

  const focus = opts.focus ?? "all";
  const hist = opts.priceHistory ?? {};
  const minVol =
    focus === "new_coins"
      ? Math.min(opts.minVolumeIdr, opts.newCoinMinVolume ?? 12_000_000)
      : opts.minVolumeIdr;

  const out: Opportunity[] = [];
  const now = Date.now();

  for (const [pair, t] of Object.entries(tickers)) {
    if (!isTradeablePair(pair)) continue;

    const last = num(t.last);
    const high = num(t.high);
    const low = num(t.low);
    const buy = num(t.buy);
    const sell = num(t.sell);
    const vol = num(t.vol_idr);

    if (last <= 0 || high <= 0 || low <= 0 || high < low) continue;

    const dayRangePct = low > 0 ? ((high - low) / low) * 100 : 0;
    const isNew = isNewCoinCandidate(pair, dayRangePct, vol, now);
    if (focus === "new_coins" && !isNew) continue;

    const pairMinVol = minVolumeForPair(pair, minVol);
    if (vol < pairMinVol) continue;

    const rangePos = high > low ? (last - low) / (high - low) : 0.5;
    const mid = buy > 0 && sell > 0 ? (buy + sell) / 2 : last;
    const spreadPct = mid > 0 && sell >= buy ? ((sell - buy) / mid) * 100 : 5;
    if (spreadPct > 1.4) continue;

    const closes = hist[pair] ?? [];
    const series =
      closes.length >= 2 ? [...closes, last] : [low, mid || last, last, high];
    const highs = series.map((c, i) =>
      i === series.length - 1 ? Math.max(c, high) : c * 1.004,
    );
    const lows = series.map((c, i) =>
      i === series.length - 1 ? Math.min(c, low) : c * 0.996,
    );
    const tech =
      series.length >= 20
        ? calculateTechScore(series, highs, lows)
        : tickerProxyTech(last, high, low, vol);

    const openPx = num((t as { open?: unknown }).open);
    const change24h =
      openPx > 0 ? ((last - openPx) / openPx) * 100 : (rangePos - 0.5) * dayRangePct;

    const setup = detectSetup(series, last, {
      high,
      low,
      spreadPct,
      volumeIdr: vol,
      rsi: tech.details.rsi,
      emaFast: tech.details.emaFast,
      change24h,
      pair,
    });

    const fc = forecastPair(series, last, {
      rsi: tech.details.rsi,
      macd: tech.details.macd,
      rangePos,
      dayRangePct,
      barSec: opts.barSec && opts.barSec > 0 ? opts.barSec : 3,
    });
    const tag =
      setup.kind === "BOUNCE"
        ? "BOUNCE"
        : setup.kind === "PULLBACK"
          ? "PULLBACK"
          : setup.kind === "BREAKOUT"
            ? "BREAKOUT"
            : vol >= 300_000_000 && spreadPct <= 0.8
              ? "RAME"
              : newCoinTag(pair, dayRangePct);

    out.push({
      pair,
      price: last,
      buy,
      sell,
      high,
      low,
      volumeIdr: vol,
      rangePos: Math.round(rangePos * 1000) / 1000,
      spreadPct: Math.round(spreadPct * 1000) / 1000,
      score: setup.score,
      signal: setup.signal,
      dayRangePct: Math.round(dayRangePct * 10) / 10,
      change24h: Math.round(change24h * 10) / 10,
      tag,
      isNewCoin: isNew,
      details: {
        rsi: tech.details.rsi,
        macd: tech.details.macd,
        bbPos: tech.details.bbPos,
        emaFast: tech.details.emaFast,
        emaSlow: tech.details.emaSlow,
        volRatio: tech.details.volRatio,
        atrPct: tech.details.atrPct,
        techScore: tech.score,
      },
      forecast: fc,
      setup: setup.kind,
      setupReason: setup.reason,
      setupStopPct: setup.stopPct,
      setupTpPct: setup.tpPct,
      setupHoldMin: setup.holdMin,
      setupDumpLow: setup.dumpLow,
    });
  }

  return out;
}

export function rankOpportunities(
  tickers: Record<string, TickerRow>,
  minVolumeIdr: number,
  minScore: number,
  topN: number,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  focus: ScanFocus = "all",
  priceHistory?: PriceHistory,
): Opportunity[] {
  const all = scoreMarket(tickers, {
    minVolumeIdr,
    weights,
    focus,
    priceHistory,
  });

  const floor = Math.min(minScore, 40);
  const setups = all.filter(
    (r) =>
      r.setup &&
      r.setup !== "NONE" &&
      r.score >= floor,
  );
  const rest = all
    .filter((r) => !setups.includes(r) && r.volumeIdr >= minVolumeIdr)
    .sort((a, b) => b.volumeIdr - a.volumeIdr);

  return [...setups, ...rest]
    .sort((a, b) => {
      const sa = a.setup && a.setup !== "NONE" ? 1 : 0;
      const sb = b.setup && b.setup !== "NONE" ? 1 : 0;
      if (sb !== sa) return sb - sa;
      if (b.score !== a.score) return b.score - a.score;
      return b.volumeIdr - a.volumeIdr;
    })
    .slice(0, Math.max(topN, 12));
}

export function pushPriceHistory(
  hist: PriceHistory,
  prices: Record<string, number>,
  cap = 150,
  maxPairs = 100,
): PriceHistory {
  const next: PriceHistory = { ...hist };
  for (const [pair, px] of Object.entries(prices)) {
    if (!(px > 0) || !isTradeablePair(pair)) continue;
    const arr = next[pair] ? next[pair].slice() : [];
    const last = arr[arr.length - 1];
    if (last == null || Math.abs(last - px) / last > 0.0002) arr.push(px);
    next[pair] = arr.length > cap ? arr.slice(-cap) : arr;
  }
  const keys = Object.keys(next);
  if (keys.length > maxPairs) {
    const keep = new Set(
      Object.entries(prices)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxPairs)
        .map(([k]) => k),
    );
    for (const k of keys) {
      if (!keep.has(k) && !next[k]) delete next[k];
    }
    const extras = Object.keys(next).filter((k) => !keep.has(k));
    extras.slice(0, extras.length - 10).forEach((k) => {
      delete next[k];
    });
  }
  return next;
}

export function mockTickers(): Record<string, TickerRow> {
  const seed = Math.floor(Date.now() / 60_000);
  const pairs = [
    ["fartcoin_idr", 2400, 6_000_000_000],
    ["velvet_idr", 12000, 2_000_000_000],
    ["xrp_idr", 17800, 7_000_000_000],
    ["doge_idr", 1250, 3_000_000_000],
    ["pepe_idr", 0.05, 1_500_000_000],
    ["sol_idr", 1_350_000, 4_000_000_000],
    ["btc_idr", 1_130_000_000, 9_000_000_000],
    ["hype_idr", 970_000, 4_000_000_000],
    ["onl_idr", 850, 800_000_000],
  ] as const;

  const out: Record<string, TickerRow> = {};
  pairs.forEach(([pair, base, vol], i) => {
    const wobble = Math.sin(seed + i * 1.7) * 0.04;
    const last = base * (1 + wobble);
    const high = last * (1.08 + Math.abs(Math.sin(seed + i)) * 0.12);
    const low = last * (0.9 - Math.abs(Math.cos(seed + i)) * 0.04);
    out[pair] = {
      last,
      high,
      low,
      buy: last * 0.998,
      sell: last * 1.002,
      vol_idr: vol * (0.9 + Math.abs(Math.sin(seed + i * 0.3)) * 0.2),
      open: last * (1 - wobble * 0.5),
    };
  });
  return out;
}
