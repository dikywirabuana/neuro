import { feeAwareTpPct } from "./smart";
import type { MarketRegime } from "./regime";
import { setupFitsRegime } from "./regime";
import {
  playbookFitsSetup,
  playbookOf,
  playbookAllowsPair,
  type PlaybookId,
} from "./playbook";
import type { PairForecast } from "./types";

export type EntryPolicy = {
  pair: string;
  minScore: number;
  maxSpreadPct: number;
  minRangePos: number;
  maxRangePos: number;
  minDayRangePct: number;
  stopLoss: number;
  takeProfit: number;
  label: string;
};

const SMART: EntryPolicy = {
  pair: "*",
  minScore: 58,
  maxSpreadPct: 0.75,
  minRangePos: 0.05,
  maxRangePos: 0.95,
  minDayRangePct: 0.5,
  stopLoss: 0.016,
  takeProfit: 0.014,
  label: "HYBRID",
};

export const ENTRY_POLICIES: Record<string, EntryPolicy> = {};

export function isHotMarket(volumeIdr?: number, spreadPct?: number): boolean {
  return (volumeIdr ?? 0) >= 300_000_000 && (spreadPct ?? 99) <= 0.75;
}

export function isVeryHot(volumeIdr?: number): boolean {
  return (volumeIdr ?? 0) >= 500_000_000;
}

export function policyFor(
  pair: string,
  ctx?: {
    volumeIdr?: number;
    spreadPct?: number;
    setupStopPct?: number;
    setupTpPct?: number;
    setup?: string;
  },
): EntryPolicy {
  const kind = ctx?.setup;
  return {
    ...SMART,
    pair: pair.toLowerCase(),
    stopLoss: ctx?.setupStopPct ?? SMART.stopLoss,
    takeProfit: ctx?.setupTpPct ?? SMART.takeProfit,
    label:
      kind === "BOUNCE" || kind === "PULLBACK" || kind === "BREAKOUT"
        ? kind
        : "HYBRID",
  };
}

export type EntryEval = { ok: boolean; reason: string; policy: EntryPolicy };

export function evaluateEntry(
  o: {
    pair: string;
    score: number;
    signal: string;
    rangePos: number;
    spreadPct: number;
    dayRangePct?: number;
    volumeIdr?: number;
    forecast?: PairForecast;
    setup?: "BOUNCE" | "PULLBACK" | "BREAKOUT" | "NONE";
    setupReason?: string;
    setupStopPct?: number;
    setupTpPct?: number;
  },
  feeRate = 0.0025,
  opts?: { regime?: MarketRegime; skipKind?: boolean; playbook?: PlaybookId },
): EntryEval {
  const p = policyFor(o.pair, {
    volumeIdr: o.volumeIdr,
    spreadPct: o.spreadPct,
    setupStopPct: o.setupStopPct,
    setupTpPct: o.setupTpPct,
    setup: o.setup,
  });
  const pb = playbookOf(opts?.playbook);

  const kindOk =
    o.setup === "BOUNCE" || o.setup === "PULLBACK" || o.setup === "BREAKOUT";
  if (opts?.skipKind) {
    if (o.spreadPct > pb.maxSpreadPct + 0.25) {
      return { ok: false, reason: `spread ${o.spreadPct.toFixed(2)}%`, policy: p };
    }
    if ((o.volumeIdr ?? 0) < 150_000_000) {
      return { ok: false, reason: "buku tipis", policy: p };
    }
    if (!playbookAllowsPair(pb, o.pair)) {
      return { ok: false, reason: `${o.pair} di luar playbook ${pb.name}`, policy: p };
    }
    return { ok: true, reason: o.setupReason || "Grok pick", policy: p };
  }
  if (!kindOk) {
    return { ok: false, reason: o.setupReason || "tidak ada setup", policy: p };
  }
  if (opts?.regime && !playbookFitsSetup(pb, o.setup, opts.regime)) {
    return {
      ok: false,
      reason: `${o.setup} tidak cocok ${pb.name}/${opts.regime}`,
      policy: p,
    };
  }
  if (opts?.regime && !opts.playbook && !setupFitsRegime(o.setup, opts.regime)) {
    return {
      ok: false,
      reason: `${o.setup} tidak cocok ${opts.regime}`,
      policy: p,
    };
  }

  const minScore = Math.max(
    pb.minScore,
    o.setup === "BREAKOUT" ? 68 : o.setup === "BOUNCE" ? 64 : 62,
  );
  if (o.score < minScore) {
    return { ok: false, reason: `setup lemah ${o.score} < ${minScore}`, policy: p };
  }
  if (pb.requireStrong && o.signal !== "STRONG_BUY") {
    return { ok: false, reason: `${pb.name} hanya STRONG_BUY`, policy: p };
  }
  if (o.signal !== "BUY" && o.signal !== "STRONG_BUY") {
    return { ok: false, reason: `signal ${o.signal}`, policy: p };
  }
  if (!playbookAllowsPair(pb, o.pair)) {
    return { ok: false, reason: `${o.pair} bukan major`, policy: p };
  }
  if ((o.volumeIdr ?? 0) < pb.minVolumeIdr) {
    return { ok: false, reason: "volume di bawah playbook", policy: p };
  }
  if (o.spreadPct > pb.maxSpreadPct) {
    return { ok: false, reason: `spread ${o.spreadPct.toFixed(2)}%`, policy: p };
  }
  const costPct = o.spreadPct + feeRate * 2 * 100;
  const minTp = feeAwareTpPct(o.spreadPct, feeRate) * 100;
  if (costPct > 1.5) {
    return { ok: false, reason: `biaya ${costPct.toFixed(2)}% terlalu mahal`, policy: p };
  }
  const tpPct = (o.setupTpPct ?? p.takeProfit) * 100;
  if (tpPct < minTp * 0.95) {
    return {
      ok: false,
      reason: `TP ${tpPct.toFixed(2)}% < fee+spread ${minTp.toFixed(2)}%`,
      policy: p,
    };
  }
  if ((o.volumeIdr ?? 0) < 300_000_000) {
    return { ok: false, reason: "buku tipis", policy: p };
  }

  return {
    ok: true,
    reason: o.setupReason || `${o.setup} score ${o.score}`,
    policy: {
      ...p,
      stopLoss: o.setupStopPct ?? p.stopLoss,
      takeProfit: Math.max(o.setupTpPct ?? p.takeProfit, feeAwareTpPct(o.spreadPct, feeRate)),
      label: o.setup || p.label,
    },
  };
}

export function entryPriority(_pair: string): number {
  return 0;
}
