import type { BotSettings } from "./types";

export type CapitalTier =
  | "micro"
  | "small"
  | "medium"
  | "large"
  | "whale";

export type RiskStyle = "safe" | "balanced" | "aggressive";

export type OptimalPack = {
  tier: CapitalTier;
  style: RiskStyle;
  label: string;
  riskPerTrade: number;
  stopLoss: number;
  takeProfit: number;
  maxPositions: number;
  minScoreToBuy: number;
  minVolumeIdr: number;
  maxNotional: number;
  scanIntervalSec: number;
  feeRate: number;
  dailyLossLimitPct: number;
  note: string;
};

/** Satu order: modal kecil boleh 85% (min Indodax 10rb), modal besar 25%. */
export function hardCapForCapital(capitalIdr: number): number {
  const c = Math.max(0, Math.round(Number(capitalIdr) || 0));
  if (c < 10_000) return 10_000;
  if (c < 50_000) return Math.max(10_000, Math.round(c * 0.85));
  return Math.max(10_000, Math.round(c * 0.25));
}

/** Ukuran order mengikuti modal + gaya. */
export function notionalForCapital(
  capitalIdr: number,
  style: RiskStyle = "aggressive",
): number {
  const c = Math.max(0, Number(capitalIdr) || 0);
  const hard = hardCapForCapital(c);
  if (c < 10_000) return 10_000;
  let pct = 0.03;
  if (style === "safe") pct = 0.02;
  else if (style === "balanced") pct = 0.04;
  else if (c < 50_000) pct = 0.85;
  else if (c < 300_000) pct = 0.18;
  else if (c < 2_000_000) pct = 0.08;
  else if (c < 10_000_000) pct = 0.045;
  else pct = 0.03;
  return Math.max(10_000, Math.min(hard, Math.round(c * pct)));
}

function capNotional(n: number, capitalIdr: number): number {
  const hard = hardCapForCapital(capitalIdr);
  return Math.max(10_000, Math.min(hard, Math.round(n)));
}

function tierOf(c: number): CapitalTier {
  if (c < 500_000) return "micro";
  if (c < 2_000_000) return "small";
  if (c < 10_000_000) return "medium";
  if (c < 50_000_000) return "large";
  return "whale";
}

export function aggressiveFromCapital(capitalIdr: number): OptimalPack {
  const c = Math.max(0, Number(capitalIdr) || 0);
  const tier = tierOf(c);
  return {
    tier,
    style: "aggressive",
    label: "Agresif · ikut modal",
    riskPerTrade: c < 500_000 ? 0.03 : 0.025,
    stopLoss: 0.018,
    takeProfit: 0.014,
    maxPositions: c < 40_000 ? 1 : c >= 10_000_000 ? 4 : c >= 2_000_000 ? 3 : 2,
    minScoreToBuy: 64,
    minVolumeIdr: 300_000_000,
    maxNotional: notionalForCapital(c, "aggressive"),
    scanIntervalSec: 15,
    feeRate: 0.0025,
    dailyLossLimitPct: 0.08,
    note: "Hybrid: CHOP bounce · TREND pullback/breakout · diam di dump.",
  };
}

export function safeFromCapital(capitalIdr: number): OptimalPack {
  const c = Math.max(0, Number(capitalIdr) || 0);
  return {
    tier: tierOf(c),
    style: "safe",
    label: "Aman · ikut modal",
    riskPerTrade: 0.01,
    stopLoss: 0.016,
    takeProfit: 0.014,
    maxPositions: c < 40_000 ? 1 : c >= 10_000_000 ? 3 : 2,
    minScoreToBuy: 70,
    minVolumeIdr: 400_000_000,
    maxNotional: notionalForCapital(c, "safe"),
    scanIntervalSec: 30,
    feeRate: 0.0025,
    dailyLossLimitPct: 0.04,
    note: "2–3 pair, size 2% modal.",
  };
}

export function balancedFromCapital(capitalIdr: number): OptimalPack {
  const c = Math.max(0, Number(capitalIdr) || 0);
  return {
    tier: tierOf(c),
    style: "balanced",
    label: "Seimbang · ikut modal",
    riskPerTrade: 0.018,
    stopLoss: 0.016,
    takeProfit: 0.014,
    maxPositions: c < 40_000 ? 1 : c >= 2_000_000 ? 4 : 3,
    minScoreToBuy: 62,
    minVolumeIdr: 300_000_000,
    maxNotional: notionalForCapital(c, "balanced"),
    scanIntervalSec: 20,
    feeRate: 0.0025,
    dailyLossLimitPct: 0.05,
    note: "Size 4% modal.",
  };
}

export function packFromStyle(
  capitalIdr: number,
  style: RiskStyle = "aggressive",
): OptimalPack {
  if (style === "safe") return safeFromCapital(capitalIdr);
  if (style === "balanced") return balancedFromCapital(capitalIdr);
  return aggressiveFromCapital(capitalIdr);
}

export function optimalFromCapital(
  capitalIdr: number,
  style: RiskStyle = "aggressive",
): OptimalPack {
  return packFromStyle(capitalIdr, style);
}

export function tierFromCapital(capitalIdr: number): CapitalTier {
  return tierOf(capitalIdr);
}

export function applyPack(
  settings: BotSettings,
  pack: OptimalPack,
  capitalIdr?: number,
  opts?: { updateInitialIdr?: boolean },
): BotSettings {
  const capital = capitalIdr ?? settings.initialIdr;
  return {
    ...settings,
    initialIdr: opts?.updateInitialIdr === false ? settings.initialIdr : capital,
    riskPerTrade: pack.riskPerTrade,
    stopLoss: pack.stopLoss,
    takeProfit: pack.takeProfit,
    maxPositions: pack.maxPositions,
    minScoreToBuy: pack.minScoreToBuy,
    minVolumeIdr: pack.minVolumeIdr,
    maxNotional: capNotional(pack.maxNotional, capital),
    scanIntervalSec: pack.scanIntervalSec,
    feeRate: pack.feeRate,
    dailyLossLimitPct: pack.dailyLossLimitPct,
  };
}

export function applyOptimalToSettings(
  settings: BotSettings,
  capitalIdr?: number,
  opts?: { updateInitialIdr?: boolean; style?: RiskStyle },
): BotSettings {
  const capital = capitalIdr ?? settings.initialIdr;
  const pack = packFromStyle(capital, opts?.style ?? "aggressive");
  return applyPack(settings, pack, capital, opts);
}

export function scaleSettingsToEquity(
  settings: BotSettings,
  equity: number,
  style: RiskStyle = "aggressive",
): { settings: BotSettings; changed: boolean; pack: OptimalPack } {
  const pack = packFromStyle(equity, style);
  const next = applyPack(settings, pack, equity, { updateInitialIdr: false });
  const changed =
    settings.riskPerTrade !== next.riskPerTrade ||
    settings.stopLoss !== next.stopLoss ||
    settings.takeProfit !== next.takeProfit ||
    settings.maxPositions !== next.maxPositions ||
    settings.minScoreToBuy !== next.minScoreToBuy ||
    settings.maxNotional !== next.maxNotional ||
    settings.minVolumeIdr !== next.minVolumeIdr ||
    settings.scanIntervalSec !== next.scanIntervalSec;

  return { settings: next, changed, pack };
}
