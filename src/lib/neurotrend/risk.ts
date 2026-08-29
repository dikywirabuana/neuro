import { policyFor } from "./entry";
import { hardCapForCapital } from "./capital-preset";
import type { BotSettings, Trade } from "./types";

const MIN_ORDER = 10_000;

export function positionSizeIdr(
  equity: number,
  settings: BotSettings,
  pair?: string,
): number {
  if (equity < MIN_ORDER) return 0;
  const sl = pair ? policyFor(pair).stopLoss : settings.stopLoss;
  if (sl <= 0) return 0;
  const cap = Math.min(
    settings.maxNotional || MIN_ORDER,
    hardCapForCapital(equity || settings.initialIdr),
    Math.floor(equity * 0.92),
  );
  let size = (equity * settings.riskPerTrade) / sl;
  size = Math.min(size, cap);
  if (size < MIN_ORDER && equity >= MIN_ORDER) {
    size = Math.min(MIN_ORDER, cap, Math.floor(equity * 0.92));
  }
  return size >= MIN_ORDER ? Math.round(size) : 0;
}

export function dailyLossFromTrades(trades: Trade[], now = Date.now()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();
  return trades
    .filter((t) => t.side === "SELL" && t.ts >= from && t.pnl < 0)
    .reduce((s, t) => s + Math.abs(t.pnl), 0);
}

export function maxDrawdownPct(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0;
  let peak = equityCurve[0];
  let maxDd = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    if (peak > 0) {
      const dd = ((peak - eq) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return Math.round(maxDd * 10) / 10;
}

export function canOpen(
  openCount: number,
  equity: number,
  score: number,
  settings: BotSettings,
  pair?: string,
  extras?: { cash?: number; dailyLoss?: number },
): boolean {
  return canOpenReason(openCount, equity, score, settings, pair, extras).ok;
}

export function canOpenReason(
  openCount: number,
  equity: number,
  score: number,
  settings: BotSettings,
  pair?: string,
  extras?: { cash?: number; dailyLoss?: number },
): { ok: boolean; reason: string } {
  if (openCount >= settings.maxPositions) {
    return { ok: false, reason: `max positions ${settings.maxPositions}` };
  }
  if (equity < 10_000) return { ok: false, reason: "equity < 10rb (min order Indodax)" };
  const floor = pair
    ? policyFor(pair).minScore
    : Math.min(settings.minScoreToBuy, 55);
  if (score < floor) return { ok: false, reason: `score ${score} < ${floor}` };

  const cash = extras?.cash;
  if (cash != null && cash < 10_000) {
    return { ok: false, reason: "cash < 10rb — tidak cukup min order" };
  }

  const limit = settings.initialIdr * (settings.dailyLossLimitPct ?? 0.05);
  const daily = extras?.dailyLoss ?? 0;
  if (limit > 0 && daily >= limit) {
    return { ok: false, reason: "daily loss limit" };
  }
  return { ok: true, reason: "OK" };
}

export function stopPrice(entry: number, settings: BotSettings, pair?: string): number {
  const sl = pair ? policyFor(pair).stopLoss : settings.stopLoss;
  return entry * (1 - sl);
}

export function takeProfitPrice(
  entry: number,
  settings: BotSettings,
  pair?: string,
): number {
  const net = pair ? policyFor(pair).takeProfit : settings.takeProfit;
  const gross = settings.feeRate * 2 + Math.max(0.007, net);
  return entry * (1 + gross);
}

export function feeOf(notional: number, settings: BotSettings): number {
  return notional * settings.feeRate;
}

export function pickRotateVictim(
  positions: Record<
    string,
    { pair: string; qty: number; entryPrice: number; costIdr: number; entryTime: number }
  >,
  prices: Record<string, number>,
  scores: Record<string, number>,
): { pair: string; score: number; pnlPct: number; ageMin: number } | null {
  const rows = Object.values(positions).map((pos) => {
    const px = prices[pos.pair] ?? pos.entryPrice;
    const mtm = pos.qty * px;
    const pnlPct =
      pos.costIdr > 0 ? ((mtm - pos.costIdr) / pos.costIdr) * 100 : 0;
    return {
      pair: pos.pair,
      score: scores[pos.pair] ?? 40,
      pnlPct,
      ageMin: Math.max(0, (Date.now() - pos.entryTime) / 60_000),
    };
  });
  if (!rows.length) return null;
  rows.sort((a, b) => a.score - b.score || a.pnlPct - b.pnlPct);
  return rows[0];
}

export function shouldRotate(
  incomingScore: number,
  victim: { score: number; pnlPct: number; ageMin: number },
): boolean {
  if (victim.ageMin < 15) return false;
  if (victim.pnlPct <= -0.15) return false;
  if (victim.pnlPct >= 0.35) return false;
  return incomingScore >= victim.score + 18;
}
