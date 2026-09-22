import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  adaptWeights,
  DEFAULT_WEIGHTS,
  type ScoreWeights,
} from "./adaptive";
import { startBackground, stopBackground } from "./background";
import {
  applyOptimalToSettings,
  hardCapForCapital,
  optimalFromCapital,
  scaleSettingsToEquity,
  type OptimalPack,
  type RiskStyle,
} from "./capital-preset";
import { evaluateEntry } from "./entry";
import { playbookFitsSetup, playbookOf, playbookAllowsPair } from "./playbook";
import { gridPlan, gridStepPct, pickGridPair, type GridState } from "./grid";
import {
  getInfo,
  parseWallet,
  walletTotals,
  placeBuy,
  placeSell,
  quantizeBaseQty,
  ensurePairMeta,
  getCoinBalances,
  cancelOpenOrders,
  cancelOneOrder,
  listAllOpenOrders,
  getPairLimits,
  coinOfPair,
  tradeOrderId,
  waitUntilSettled,
  getOrderStatus,
  minBuyIdr,
  type WalletAsset,
  type OpenOrder,
} from "./indodax-private";
import { isTradeablePair } from "./new-coins";
import { PaperPortfolio, type PendingExit } from "./portfolio";
import { detectRegime, type RegimeReport } from "./regime";
import { notifyTakeProfit, unlockAudio } from "./notify";
import { canOpenReason, positionSizeIdr } from "./risk";
import { pushPriceHistory, rankOpportunities, scoreMarket } from "./scanner";
import {
  DEFAULT_SETTINGS,
  isLiveEnabled,
  type BotSettings,
  type BotSummary,
  type EquityPoint,
  type Opportunity,
  type Position,
  type Trade,
} from "./types";

type LogKind = "info" | "entry" | "exit" | "ai" | "live" | "error";

export type PendingManual = {
  pair: string;
  orderId: string;
  limitPx: number;
  slPct: number;
  tpPct: number;
  sizeIdr: number;
  ts: number;
};
type LogLine = { ts: number; text: string; kind: LogKind };
type AiDecision = {
  pair: string;
  action: "BUY" | "SKIP" | "SELL";
  confidence: number;
  reason: string;
  replace?: string;
  slPct?: number;
  tpPct?: number;
};
type RiskMode = "optimal" | "manual";

type BotState = {
  settings: BotSettings;
  running: boolean;
  wantRunning: boolean;
  lastScanAt: number | null;
  lastQuoteAt: number | null;
  source: "live" | "mock" | "idle" | "error";
  opportunities: Opportunity[];
  prices: Record<string, number>;
  positions: Record<string, Position>;
  trades: Trade[];
  equityHistory: EquityPoint[];
  summary: BotSummary;
  logs: LogLine[];
  error: string | null;
  realIdrBalance: number | null;
  wallet: WalletAsset[];
  walletAt: number | null;
  walletBusy: boolean;
  openOrders: OpenOrder[];
  apiStatus: "unknown" | "ok" | "fail";
  grokStatus: "unknown" | "ok" | "fail";
  regime: RegimeReport | null;
  weights: ScoreWeights;
  aiSource: "gemini" | "grok" | "heuristic" | "idle";
  aiSummary: string;
  aiDecisions: AiDecision[];
  autoTrade: boolean;
  scaleWithEquity: boolean;
  riskMode: RiskMode;
  riskStyle: RiskStyle;
  equityTier: OptimalPack | null;
  cash: number;
  priceHistory: Record<string, number[]>;
  pendingManual: PendingManual[];
  watchPair: string;
  watchTf: string;
  gridState: GridState | null;
  autoPlaybook: boolean;
  playbookWhy: string;
  circuitBase: number;

  pushLog: (text: string, kind?: LogKind) => void;
  start: () => void;
  stop: () => void;
  resetPortfolio: () => void;
  scanOnce: () => Promise<void>;
  ensureLiveQuotes: () => void;
  closePair: (pair: string) => Promise<boolean>;
  closeAllPairs: () => Promise<number>;
  refreshWallet: () => Promise<boolean>;
  sellWalletCoin: (coin: string, qty?: number) => Promise<boolean>;
  sellAllWallet: () => Promise<number>;
  cancelExchangeOrder: (order: OpenOrder) => Promise<boolean>;
  cancelAllExchangeOrders: () => Promise<number>;
  applySettingsAndReset: (
    s: BotSettings,
    opts?: { riskMode?: RiskMode; riskStyle?: RiskStyle },
  ) => void;
  setRiskMode: (mode: RiskMode) => void;
  setRiskStyle: (style: RiskStyle) => void;
  saveApiSettings: (partial: Partial<BotSettings>) => void;
  testApiConnection: () => Promise<boolean>;
  testGrokConnection: () => Promise<boolean>;
  setAutoTrade: (v: boolean) => void;
  setScaleWithEquity: (v: boolean) => void;
  manualBuy: (opts: {
    pair: string;
    slPct: number;
    tpPct: number;
    sizeIdr?: number;
    price?: number;
    market?: boolean;
    grid?: boolean;
  }) => Promise<boolean>;
  manualSell: (pair: string, qty?: number) => Promise<boolean>;
  setStops: (pair: string, slPct: number, tpPct: number) => boolean;
  cancelPendingManual: (pair: string) => Promise<boolean>;
  setWatchPair: (pair: string) => void;
  setWatchTf: (tf: string) => void;
  setAutoPlaybook: (v: boolean) => void;
};

let scanTimer: ReturnType<typeof setInterval> | null = null;
let quoteTimer: ReturnType<typeof setInterval> | null = null;
let scanning = false;
let priceRefreshing = false;
const exitingPairs = new Set<string>();
const pairCooldownUntil = new Map<string, number>();
const PAIR_COOLDOWN_MS = 12 * 60 * 1000;

function markPairCooldown(pair: string) {
  pairCooldownUntil.set(pair, Date.now() + PAIR_COOLDOWN_MS);
}
function isPairCooling(pair: string): boolean {
  return Date.now() < (pairCooldownUntil.get(pair) ?? 0);
}

function emptySummary(initial: number): BotSummary {
  return {
    cash: initial,
    equity: initial,
    initial,
    realizedPnl: 0,
    unrealizedPnl: 0,
    openPositions: 0,
    returnPct: 0,
    tradeCount: 0,
    winRate: 0,
    maxDrawdown: 0,
    dailyLoss: 0,
    dailyLossLimit: initial * 0.05,
  };
}

function normalizeSettings(raw: Partial<BotSettings> | undefined): BotSettings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  if (!s.tradingMode) s.tradingMode = s.paperOnly === false ? "live" : "paper";
  s.apiKey = s.apiKey ?? "";
  s.apiSecret = s.apiSecret ?? "";
  s.xaiApiKey = s.xaiApiKey ?? "";
  s.geminiApiKey = s.geminiApiKey ?? "";
  s.useGrokAi = false;
  s.iUnderstandLive = Boolean(s.iUnderstandLive);
  s.paperOnly = s.tradingMode !== "live";
  s.scanFocus = "all";
  s.playbook = "smart";
  s.maxPositions = Math.min(3, Math.max(1, Math.round(s.maxPositions) || 2));
  s.scanIntervalSec = Math.max(15, Math.round(s.scanIntervalSec) || 30);
  s.dailyLossLimitPct = s.dailyLossLimitPct > 0 ? s.dailyLossLimitPct : 0.05;
  s.globalStopPct = Math.min(0.15, Math.max(0.02, s.globalStopPct || 0.05));
  s.globalTakePct = Math.min(0.2, Math.max(0.02, s.globalTakePct || 0.05));
  const hours = Math.round(Number(s.timeExitHours));
  if (hours === 1 || hours === 2 || hours === 3) s.timeExitHours = hours;
  else if ((s as { timeExit60?: boolean }).timeExit60 === true) s.timeExitHours = 1;
  else s.timeExitHours = 0;
  s.trade90Pct = Boolean(s.trade90Pct);
  const hard = hardCapForCapital(s.initialIdr);
  let notion = Math.round(s.maxNotional) || 0;
  if (notion <= 10_000 && hard > 12_500) notion = Math.min(hard, 15_000);
  s.maxNotional = Math.min(hard, Math.max(10_000, notion || 10_000));
  s.minScoreToBuy = Math.min(Math.max(s.minScoreToBuy || 56, 50), 70);
  if (s.takeProfit > 0.03) s.takeProfit = 0.012;
  if (Math.round(s.initialIdr) === 198_335) s.initialIdr = 0;
  s.initialIdr = Math.max(0, Math.round(s.initialIdr) || 0);
  return s;
}

function portfolioFromState(s: {
  cash: number;
  settings: BotSettings;
  positions: Record<string, Position>;
  trades: Trade[];
  equityHistory: EquityPoint[];
}): PaperPortfolio {
  const positions = { ...s.positions };
  for (const p of Object.keys(positions)) {
    if (isDropped(p)) delete positions[p];
  }
  return PaperPortfolio.fromJSON({
    cash: s.cash,
    initialIdr: s.settings.initialIdr,
    positions,
    trades: s.trades,
    equityHistory: s.equityHistory,
  });
}

const droppedPairs = new Map<string, number>();
const sellingNow = new Set<string>();

function markDropped(pair: string) {
  droppedPairs.set(pair.toLowerCase(), Date.now());
}

function unmarkDropped(pair: string) {
  droppedPairs.delete(pair.toLowerCase());
}

function isDropped(pair: string): boolean {
  const ts = droppedPairs.get(pair.toLowerCase());
  return ts != null && Date.now() - ts < 180_000;
}

function pruneDropped(
  pos: Record<string, Position>,
): Record<string, Position> {
  const next = { ...pos };
  for (const p of Object.keys(next)) {
    if (isDropped(p)) delete next[p];
  }
  return next;
}

async function fetchTickers(): Promise<{
  tickers: Record<string, unknown>;
  source: "live" | "error";
}> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    const res = await fetch("/api/indodax/tickers", {
      headers: { accept: "application/json" },
      signal: ac.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`tickers ${res.status}`);
    const data = (await res.json()) as {
      tickers?: Record<string, unknown>;
      source?: string;
    };
    const tickers = data.tickers ?? {};
    if (data.source === "mock" || data.source === "error") {
      return { tickers: {}, source: "error" };
    }
    if (!Object.keys(tickers).length) throw new Error("empty");
    return { tickers, source: "live" };
  } catch {
    return { tickers: {}, source: "error" };
  }
}

async function syncLiveAssets(
  get: () => BotState,
  set: (p: Partial<BotState>) => void,
  prices: Record<string, number>,
  pf: PaperPortfolio,
): Promise<{ cash: number; total: number } | null> {
  const settings = get().settings;
  const live = isLiveEnabled(settings);
  if (!live || !settings.apiKey || !settings.apiSecret) {
    const t = walletTotals(get().wallet ?? [], prices, pf.cash);
    return t.total > 0 ? t : null;
  }
  const now = Date.now();
  let wallet = get().wallet ?? [];
  let fetched = false;
  if (!wallet.length || now - (get().walletAt ?? 0) > 12_000) {
    try {
      const { balanceIdr, raw } = await getInfo(settings.apiKey, settings.apiSecret);
      if (!raw.error && raw.data?.success !== 0) {
        wallet = parseWallet(raw, prices);
        pf.syncCash(balanceIdr);
        fetched = true;
        set({
          wallet,
          realIdrBalance: balanceIdr,
          walletAt: now,
          apiStatus: "ok",
        });
      }
    } catch {
      /* keep last snapshot */
    }
  }
  if (fetched) {
    reconcileLivePositions(pf, wallet, prices, (m, k) => get().pushLog(m, k));
  }
  const tot = walletTotals(wallet, prices, pf.cash);
  if (tot.cash >= 0) pf.syncCash(tot.cash);
  if (tot.total >= 10_000 && settings.initialIdr < 10_000) {
    const seed = Math.round(tot.total);
    pf.initialIdr = seed;
    set({
      settings: { ...settings, initialIdr: seed },
    });
    get().pushLog(
      `Equity diisi dari total aset Rp ${seed.toLocaleString("id-ID")}`,
      "live",
    );
  }
  return tot;
}

function walletHave(wallet: WalletAsset[], coin: string): { avail: number; hold: number; total: number } {
  const row = wallet.find((w) => w.coin === coin);
  const avail = row?.qty ?? 0;
  const hold = row?.hold ?? 0;
  return { avail, hold, total: avail + hold };
}

function reconcileLivePositions(
  pf: PaperPortfolio,
  wallet: WalletAsset[],
  prices: Record<string, number>,
  log: (msg: string, kind?: LogKind) => void,
): void {
  if (!wallet.length) return;
  const now = Date.now();
  for (const pair of Object.keys(pf.positions)) {
    const pos = pf.positions[pair];
    if (!pos) continue;
    if (now - pos.entryTime < 60_000) continue;
    if (exitingPairs.has(pair) || sellingNow.has(pair)) continue;
    const coin = pair.replace(/_idr$/, "");
    const have = walletHave(wallet, coin);
    const px = prices[pair] || pos.entryPrice;
    const haveIdr = have.total * px;
    if (have.hold > 0) continue;
    if (!(have.total > 0) || haveIdr < 1_500 || have.total < pos.qty * 0.02) {
      pf.forgetPosition(pair, px, "SYNC_SOLD");
      markDropped(pair);
      log(
        `SYNC ${coin.toUpperCase()} — sudah tidak ada di Indodax, posisi ditutup`,
        "exit",
      );
      continue;
    }
    const t = pf.syncQtyFromExchange(pair, have.total, px);
    if (t) {
      log(
        `SYNC ${coin.toUpperCase()} qty sesuai wallet: ${have.total}`,
        "live",
      );
    }
  }
}

async function askAi(_opts: {
  regime: string;
  allowEntry: boolean;
  candidates: Opportunity[];
  weights: string;
  openPositions: number;
  maxPositions: number;
  minScore: number;
  feeRate: number;
  xaiApiKey?: string;
  geminiApiKey?: string;
  cash?: number;
  equity?: number;
  dailyLoss?: number;
  maxNotional?: number;
  live?: boolean;
  held?: { pair: string; score: number; pnlPct: number; ageMin: number }[];
}): Promise<{
  source: "gemini" | "grok" | "heuristic";
  summary: string;
  decisions: AiDecision[];
}> {
  return { source: "heuristic", summary: "Cloud AI OFF", decisions: [] };
}

async function liveSellOk(
  settings: BotSettings,
  pair: string,
  price: number,
  qty: number,
): Promise<{ ok: boolean; alreadyFlat?: boolean; error?: string; soldQty?: number }> {
  try {
    const coin = coinOfPair(pair);
    const px = price > 0 ? price : 0;
    const dustOf = (b: { avail: number; hold: number }) => {
      const tot = (b.avail || 0) + (b.hold || 0);
      return !(tot > 0) || (px > 0 && tot * px < 1_500);
    };

    let bal = await getCoinBalances(settings.apiKey, settings.apiSecret, coin);
    if (!bal.ok) return { ok: false, error: bal.error || "balance" };

    await cancelOpenOrders(settings.apiKey, settings.apiSecret, pair);
    await new Promise((r) => setTimeout(r, 400));
    bal = await getCoinBalances(settings.apiKey, settings.apiSecret, coin);
    if (!bal.ok) return { ok: false, error: bal.error || "balance" };
    if (dustOf(bal)) return { ok: true, alreadyFlat: true, soldQty: 0 };

    const sellQty = quantizeBaseQty(Math.min(qty, bal.avail), pair);
    if (sellQty <= 0) {
      if (dustOf(bal)) return { ok: true, alreadyFlat: true, soldQty: 0 };
      return { ok: false, error: `qty 0 (avail ${bal.avail} hold ${bal.hold})` };
    }

    let lastErr = "sell";
    const raw = await placeSell(
      settings.apiKey,
      settings.apiSecret,
      pair,
      price,
      sellQty,
    );
    if (raw.error || raw.data?.success === 0) {
      lastErr = String(raw.error || raw.data?.error || "sell");
      if (/insufficient|not enough|saldo|balance/i.test(lastErr)) {
        await new Promise((r) => setTimeout(r, 400));
        const again = await getCoinBalances(settings.apiKey, settings.apiSecret, coin);
        if (dustOf(again)) return { ok: true, alreadyFlat: true, soldQty: 0 };
        return { ok: false, error: lastErr };
      }
      return { ok: false, error: lastErr };
    }
    const oid = tradeOrderId(raw);
    if (oid) {
      await waitUntilSettled(
        settings.apiKey,
        settings.apiSecret,
        pair,
        oid,
        8000,
      );
    }
    const after = await getCoinBalances(settings.apiKey, settings.apiSecret, coin);
    if (!after.ok) return { ok: false, error: after.error || "balance after sell" };
    if (dustOf(after)) return { ok: true, soldQty: sellQty };
    const left = (after.avail || 0) + (after.hold || 0);
    const beforeTot = (bal.avail || 0) + (bal.hold || 0);
    const soldAmt = Math.max(0, beforeTot - left);
    if (soldAmt >= sellQty * 0.85) {
      return { ok: true, soldQty: soldAmt };
    }
    return { ok: false, error: lastErr === "sell" ? "sell belum fill / sisa masih ada" : lastErr };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function gridAddsMap(gs: GridState | null): Record<string, number> {
  if (!gs?.pair) return {};
  return { [gs.pair.toLowerCase()]: Math.max(1, gs.adds || 1) };
}

function followChart(
  set: (p: Partial<BotState>) => void,
  get: () => BotState,
  pair: string,
) {
  const p = String(pair || "").toLowerCase();
  if (!p.endsWith("_idr")) return;
  if (get().watchPair === p) return;
  set({ watchPair: p });
}

function fillQtyFromDelta(
  before: { avail: number; ok: boolean },
  after: { avail: number; ok: boolean },
  pair: string,
): number {
  if (!before.ok || !after.ok) return -1;
  return quantizeBaseQty(Math.max(0, after.avail - before.avail), pair);
}

async function executePendingExits(
  get: () => BotState,
  set: (p: Partial<BotState>) => void,
  pf: PaperPortfolio,
  exits: PendingExit[],
  settings: BotSettings,
  live: boolean,
): Promise<void> {
  for (const ex of exits) {
    if (exitingPairs.has(ex.pair) || sellingNow.has(ex.pair)) continue;
    exitingPairs.add(ex.pair);
    sellingNow.add(ex.pair);
    try {
      if (!pf.positions[ex.pair]) continue;
      let soldQty = ex.qty;
      if (live) {
        const sold = await liveSellOk(settings, ex.pair, ex.sellPx, ex.qty);
        if (!sold.ok) {
          get().pushLog(
            `TP/SL ${ex.reason} ${ex.pair} — LIVE SELL gagal: ${sold.error}`,
            "error",
          );
          continue;
        }
        if (sold.alreadyFlat) {
          pf.forgetPosition(ex.pair, ex.sellPx, "SYNC_SOLD");
          markDropped(ex.pair);
          get().pushLog(
            `SYNC ${ex.pair.replace("_idr", "").toUpperCase()} sudah flat di Indodax`,
            "exit",
          );
          continue;
        }
        if (sold.soldQty && sold.soldQty > 0) soldQty = sold.soldQty;
      }
      const pos = pf.positions[ex.pair];
      if (!pos) continue;
      const t =
        soldQty > 0 && soldQty < pos.qty * 0.95
          ? pf.closePartial(ex.pair, soldQty, ex.sellPx, ex.reason, settings)
          : pf.closePosition(ex.pair, ex.sellPx, ex.reason, settings);
      if (!t) continue;
      if (!pf.has(ex.pair)) {
        markDropped(t.pair);
        markPairCooldown(t.pair);
        const gs = get().gridState;
        if (gs?.pair === t.pair) set({ gridState: { ...gs, adds: 0 } });
      } else if (ex.reason === "GRID_TP") {
        const gs = get().gridState;
        if (gs?.pair === t.pair) {
          set({
            gridState: {
              ...gs,
              adds: Math.max(0, gs.adds - 1),
              lastBuyPx: t.price,
            },
          });
        }
      }
      get().pushLog(
        `EXIT ${t.pair} @ ${Math.round(t.price).toLocaleString("id-ID")} · ${t.reason} · PnL ${Math.round(t.pnl).toLocaleString("id-ID")}`,
        "exit",
      );
      if (
        t.reason === "TAKE_PROFIT" ||
        t.reason === "LOCK_GREEN" ||
        t.reason === "LOCK_GLOBAL_5" ||
        t.reason === "GRID_TP" ||
        t.reason === "TRAIL_GREEN" ||
        t.reason === "LOCK_EQ_2"
      ) {
        notifyTakeProfit(t.pair, t.pnl);
      }
    } finally {
      exitingPairs.delete(ex.pair);
      sellingNow.delete(ex.pair);
    }
  }
}

async function runGridCycle(
  get: () => BotState,
  set: (p: Partial<BotState>) => void,
  pf: PaperPortfolio,
  prices: Record<string, number>,
  bids: Record<string, number>,
  settings: BotSettings,
  opps: Opportunity[],
  live: boolean,
  regimeName: string,
): Promise<string> {
  const step = gridStepPct(settings.feeRate, settings.takeProfit);
  const pair =
    pickGridPair(opps, get().watchPair, get().gridState?.pair) ||
    get().watchPair ||
    "";
  if (!pair || !prices[pair]) return "grid: tidak ada pair likuid";
  const pos = pf.positions[pair] ?? null;
  const lot = Math.max(10_000, Math.min(settings.maxNotional || 10_000, 15_000));
  const plan = gridPlan({
    state: get().gridState,
    pair,
    price: prices[pair],
    bid: bids[pair] || prices[pair],
    pos,
    cash: pf.cash,
    stepPct: step,
    maxAdds: Math.min(3, settings.maxPositions || 3),
    lotIdr: lot,
    regime: regimeName,
    change24h: opps.find((o) => o.pair === pair)?.change24h,
  });
  const tpPct = step;
  const slPct = Math.max(settings.stopLoss || 0.016, step * 3);

  if (plan.action === "SELL_LOT" && pos) {
    if (exitingPairs.has(pair) || sellingNow.has(pair)) return "grid: sedang exit";
    const qty = plan.sellQty && plan.sellQty > 0 ? plan.sellQty : pos.qty;
    const px = bids[pair] || prices[pair];
    exitingPairs.add(pair);
    sellingNow.add(pair);
    try {
      if (live) {
        const sold = await liveSellOk(settings, pair, px * 0.997, qty);
        if (!sold.ok) {
          get().pushLog(`GRID SELL gagal ${pair}: ${sold.error}`, "error");
          return plan.reason;
        }
        if (sold.alreadyFlat) {
          pf.forgetPosition(pair, px, "SYNC_SOLD");
          markDropped(pair);
          set({ gridState: { ...plan.state, adds: 0, lastBuyPx: px } });
          get().pushLog(`GRID ${pair.replace("_idr", "").toUpperCase()} sudah flat`, "exit");
          return plan.reason;
        }
      }
      const t =
        qty >= pos.qty * 0.95
          ? pf.closePosition(pair, px, "GRID_TP", settings)
          : pf.closePartial(pair, qty, px, "GRID_TP", settings);
      if (t) {
        if (qty >= pos.qty * 0.95) markDropped(pair);
        const adds = Math.max(0, plan.state.adds - 1);
        const next: GridState = {
          pair,
          anchor: plan.state.anchor || t.price,
          lastBuyPx: t.price,
          adds,
        };
        set({ gridState: next });
        get().pushLog(
          `GRID SELL ${pair.replace("_idr", "").toUpperCase()} lot @ ${t.price.toLocaleString("id-ID")} · PnL ${Math.round(t.pnl).toLocaleString("id-ID")}`,
          "exit",
        );
        if (t.pnl > 0) notifyTakeProfit(t.pair, t.pnl);
      }
    } finally {
      exitingPairs.delete(pair);
      sellingNow.delete(pair);
    }
    return plan.reason;
  }

  if (plan.action !== "BUY" || !plan.sizeIdr) {
    set({ gridState: { ...plan.state, pair } });
    return plan.reason;
  }

  const px = prices[pair];
  const ask = opps.find((o) => o.pair === pair)?.sell || px;
  const need = minBuyIdr(pair, ask);
  const size = Math.max(need, Math.min(plan.sizeIdr, pf.cash * 0.95));
  if (size < need || pf.cash < need) {
    get().pushLog(`GRID BUY skip ${pair}: min lot Rp ${need.toLocaleString("id-ID")}`, "ai");
    return plan.reason;
  }
  if (live) {
    try {
      const before = await getCoinBalances(
        settings.apiKey,
        settings.apiSecret,
        coinOfPair(pair),
      );
      const raw = await placeBuy(
        settings.apiKey,
        settings.apiSecret,
        pair,
        ask * 1.001,
        size,
      );
      if (raw.error || raw.data?.success === 0) {
        get().pushLog(`GRID BUY gagal ${pair}: ${raw.error || raw.data?.error}`, "error");
        return plan.reason;
      }
      const oid = tradeOrderId(raw);
      if (oid) {
        const settled = await waitUntilSettled(
          settings.apiKey,
          settings.apiSecret,
          pair,
          oid,
          8000,
        );
        if (!settled.filled) {
          await cancelOpenOrders(settings.apiKey, settings.apiSecret, pair);
          const afterCancel = await getCoinBalances(
            settings.apiKey,
            settings.apiSecret,
            coinOfPair(pair),
          );
          const partial = fillQtyFromDelta(before, afterCancel, pair);
          if (partial > 0) {
            const infoP = await getInfo(settings.apiKey, settings.apiSecret);
            pf.syncCash(infoP.balanceIdr);
            const tP = pf.addToLong(pair, ask, partial, settings, plan.reason, {
              tpPct,
              stopPct: slPct,
              skipCash: true,
            });
            if (tP) {
              const next: GridState = {
                pair,
                anchor: plan.state.anchor || tP.price,
                lastBuyPx: tP.price,
                adds: (plan.state.adds || 0) + 1,
              };
              set({ gridState: next });
              followChart(set, get, pair);
              get().pushLog(`GRID BUY PARTIAL ${pair} qty=${partial}`, "entry");
            }
            return plan.reason;
          }
          get().pushLog(`GRID BUY ${pair} belum fill — dibatalkan`, "live");
          return plan.reason;
        }
      }
      const after = await getCoinBalances(
        settings.apiKey,
        settings.apiSecret,
        coinOfPair(pair),
      );
      const filledQty = fillQtyFromDelta(before, after, pair);
      if (filledQty < 0) {
        get().pushLog(`GRID BUY ${pair} balance gagal — tidak catat`, "error");
        return plan.reason;
      }
      if (filledQty <= 0) {
        get().pushLog(`GRID BUY ${pair} qty 0`, "error");
        return plan.reason;
      }
      const info = await getInfo(settings.apiKey, settings.apiSecret);
      pf.syncCash(info.balanceIdr);
      const trade = pf.addToLong(pair, ask, filledQty, settings, plan.reason, {
        tpPct,
        stopPct: slPct,
        skipCash: true,
      });
      if (trade) {
        const next: GridState = {
          pair,
          anchor: plan.state.anchor || trade.price,
          lastBuyPx: trade.price,
          adds: (plan.state.adds || 0) + 1,
        };
        set({ gridState: next });
        followChart(set, get, pair);
        get().pushLog(
          `GRID BUY ${pair.replace("_idr", "").toUpperCase()} lot ${next.adds} @ ${Math.round(trade.price).toLocaleString("id-ID")}`,
          "entry",
        );
      }
    } catch (e) {
      get().pushLog(
        `GRID BUY error: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    }
    return plan.reason;
  }

  const qty = quantizeBaseQty(size / (px * 1.001), pair);
  const trade = pf.addToLong(pair, px, qty, settings, plan.reason, {
    tpPct,
    stopPct: slPct,
  });
  if (trade) {
    const next: GridState = {
      pair,
      anchor: plan.state.anchor || trade.price,
      lastBuyPx: trade.price,
      adds: (plan.state.adds || 0) + 1,
    };
    set({ gridState: next });
    followChart(set, get, pair);
    get().pushLog(
      `GRID BUY ${pair.replace("_idr", "").toUpperCase()} lot ${next.adds} @ ${Math.round(trade.price).toLocaleString("id-ID")}`,
      "entry",
    );
  }
  return plan.reason;
}

async function settleManualLimits(
  get: () => BotState,
  set: (
    p: Partial<BotState> | ((s: BotState) => Partial<BotState>),
  ) => void,
): Promise<void> {
  const settings = get().settings;
  const pending = get().pendingManual ?? [];
  if (!pending.length || !isLiveEnabled(settings)) return;
  const keep: PendingManual[] = [];
  const pf = portfolioFromState({ ...get(), settings });
  let changed = false;
  for (const p of pending) {
    try {
      const st = await getOrderStatus(
        settings.apiKey,
        settings.apiSecret,
        p.pair,
        p.orderId,
      );
      if (st.status === "cancelled" || st.status === "canceled") continue;
      if (!st.filled) {
        keep.push(p);
        continue;
      }
      if (pf.has(p.pair)) continue;
      const bal = await getCoinBalances(
        settings.apiKey,
        settings.apiSecret,
        coinOfPair(p.pair),
      );
      if (!bal.ok) {
        keep.push(p);
        continue;
      }
      const cap = p.limitPx > 0 ? (p.sizeIdr / p.limitPx) * 1.08 : 0;
      const qty = quantizeBaseQty(
        Math.min(Math.max(0, bal.avail), cap > 0 ? cap : bal.avail),
        p.pair,
      );
      if (qty <= 0) {
        keep.push(p);
        continue;
      }
      const info = await getInfo(settings.apiKey, settings.apiSecret);
      pf.syncCash(info.balanceIdr);
      const trade = pf.openFilledLong(
        p.pair,
        p.limitPx,
        qty,
        settings,
        `MANUAL_LIMIT:${p.limitPx}`,
        {
          stopPct: p.slPct,
          tpPct: p.tpPct,
          setup: "NONE",
          holdMin: 12,
          skipCash: true,
        },
      );
      if (trade) {
        changed = true;
        get().pushLog(
          `LIMIT FILLED ${trade.pair} @ ${p.limitPx.toLocaleString("id-ID")} · SL ${(p.slPct * 100).toFixed(1)}% TP ${(p.tpPct * 100).toFixed(1)}%`,
          "entry",
        );
      } else keep.push(p);
    } catch {
      keep.push(p);
    }
  }
  if (changed || keep.length !== pending.length) {
    set({
      pendingManual: keep,
      cash: pf.cash,
      positions: pruneDropped({ ...pf.positions }),
      trades: [...pf.trades],
      summary: pf.summary(get().prices),
    });
  }
}

export const useBotStore = create<BotState>()(
  persist(
    (set, get) => ({
      settings: { ...DEFAULT_SETTINGS },
      running: false,
      wantRunning: false,
      lastScanAt: null,
      lastQuoteAt: null,
      source: "idle",
      opportunities: [],
      prices: {},
      positions: {},
      trades: [],
      equityHistory: [],
      summary: emptySummary(DEFAULT_SETTINGS.initialIdr),
      logs: [],
      error: null,
      realIdrBalance: null,
      wallet: [],
      openOrders: [],
      walletAt: null,
      walletBusy: false,
      apiStatus: "unknown",
      grokStatus: "unknown",
      regime: null,
      weights: { ...DEFAULT_WEIGHTS },
      aiSource: "idle",
      aiSummary: "",
      aiDecisions: [],
      autoTrade: true,
      scaleWithEquity: true,
      riskMode: "optimal",
      riskStyle: "aggressive",
      equityTier: null,
      cash: DEFAULT_SETTINGS.initialIdr,
      priceHistory: {},
      pendingManual: [],
      watchPair: "btc_idr",
      watchTf: "15",
      gridState: null,
      autoPlaybook: true,
      playbookWhy: "",
      circuitBase: 0,

      pushLog: (text, kind = "info") => {
        set((s) => ({
          logs: [{ ts: Date.now(), text, kind }, ...s.logs].slice(0, 200),
        }));
      },

      setAutoTrade: (v) => {
        set({ autoTrade: v });
        get().pushLog(v ? "Auto-trade ON" : "Auto-trade OFF");
      },
      setScaleWithEquity: (v) => {
        set({ scaleWithEquity: v });
        get().pushLog(v ? "Scale equity ON" : "Scale equity OFF");
      },
      setWatchPair: (pair) => {
        const raw = String(pair || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace("/", "");
        const ticker = raw.replace(/_idr/g, "").replace(/[^a-z0-9]/g, "");
        if (!ticker) return;
        set({ watchPair: `${ticker}_idr` });
      },
      setWatchTf: (tf) => {
        set({ watchTf: tf });
      },
      setAutoPlaybook: (v) => {
        set({ autoPlaybook: v });
        get().pushLog(v ? "Strategi AUTO — bot pilih mode tiap scan" : "Strategi dikunci manual");
      },
      setRiskMode: (mode) => {
        set({ riskMode: mode });
        get().pushLog(`Risk mode: ${mode}`);
      },
      setRiskStyle: (style) => {
        set({ riskStyle: style });
        get().pushLog(`Preset: ${style}`);
      },
      saveApiSettings: (partial) => {
        const next = normalizeSettings({ ...get().settings, ...partial });
        if (partial.playbook) {
          const pb = playbookOf(next.playbook);
          set({ settings: next, autoPlaybook: false, playbookWhy: `Manual · ${pb.name}` });
          get().pushLog(`Playbook dikunci: ${pb.name} · ${pb.tagline}`, "ai");
        } else {
          set({ settings: next });
          get().pushLog("API/settings partial saved");
        }
      },

      applySettingsAndReset: (s, opts) => {
        let next = normalizeSettings(s);
        const mode = opts?.riskMode ?? get().riskMode;
        if (next.initialIdr < 10_000) {
          get().pushLog("Isi modal dulu di Settings (min Rp 10.000)", "error");
          set({ settings: next, riskMode: mode, error: "Modal belum diisi" });
          return;
        }
        const style = opts?.riskStyle ?? get().riskStyle ?? "aggressive";
        if (mode === "optimal") {
          next = applyOptimalToSettings(next, next.initialIdr, { style });
        } else {
          next.maxNotional = Math.min(
            hardCapForCapital(next.initialIdr),
            Math.max(10_000, next.maxNotional),
          );
        }
        const pf = new PaperPortfolio(next.initialIdr);
        set({
          settings: next,
          riskMode: mode,
          riskStyle: style,
          cash: pf.cash,
          positions: {},
          trades: [],
          equityHistory: [],
          summary: emptySummary(next.initialIdr),
          equityTier: optimalFromCapital(next.initialIdr, style),
          error: null,
        });
        get().pushLog(
          `Settings saved [${mode.toUpperCase()}] · modal Rp ${next.initialIdr.toLocaleString("id-ID")} · maxPos ${next.maxPositions} · risk ${(next.riskPerTrade * 100).toFixed(1)}% · score≥${next.minScoreToBuy}`,
        );
      },

      resetPortfolio: () => {
        const { settings } = get();
        const pf = new PaperPortfolio(settings.initialIdr);
        set({
          cash: pf.cash,
          positions: {},
          trades: [],
          equityHistory: [],
          summary: emptySummary(settings.initialIdr),
          opportunities: [],
        });
        get().pushLog("Portfolio reset");
      },

      testApiConnection: async () => {
        const { settings } = get();
        if (!settings.apiKey || !settings.apiSecret) {
          set({ apiStatus: "fail" });
          get().pushLog("Indodax: key kosong", "error");
          return false;
        }
        try {
          const { balanceIdr, raw } = await getInfo(settings.apiKey, settings.apiSecret);
          if (raw.error || raw.data?.success === 0) {
            set({ apiStatus: "fail" });
            get().pushLog(
              `Indodax gagal: ${raw.error || raw.data?.error || "auth"}`,
              "error",
            );
            return false;
          }
          set({ apiStatus: "ok", realIdrBalance: balanceIdr });
          get().pushLog(
            `Indodax OK · balance Rp ${Math.round(balanceIdr).toLocaleString("id-ID")}`,
            "live",
          );
          void get().refreshWallet();
          return true;
        } catch (e) {
          set({ apiStatus: "fail" });
          get().pushLog(
            `Indodax error: ${e instanceof Error ? e.message : String(e)}`,
            "error",
          );
          return false;
        }
      },

      testGrokConnection: async () => {
        set({ grokStatus: "fail" });
        get().pushLog("Cloud AI dimatikan — tidak panggil Grok/Gemini (hemat API)", "ai");
        return false;
      },

      ensureLiveQuotes: () => {
        if (quoteTimer) return;
        void ensurePairMeta();
        const tick = async () => {
          if (priceRefreshing) return;
          priceRefreshing = true;
          try {
            const { tickers, source } = await fetchTickers();
            if (source !== "live") {
              set({ source: "error" });
              return;
            }
            const prices: Record<string, number> = { ...get().prices };
            const bids: Record<string, number> = {};
            for (const [pair, row] of Object.entries(tickers)) {
              const t = row as { last?: string; buy?: string };
              const last = Number(t.last);
              const buy = Number(t.buy);
              if (last > 0) prices[pair] = last;
              if (buy > 0) bids[pair] = buy;
            }
            const hist = pushPriceHistory(get().priceHistory, prices);
            if (scanning) {
              set({ prices, priceHistory: hist, source: "live", lastQuoteAt: Date.now() });
              return;
            }
            const settings = get().settings;
            await settleManualLimits(get, set);
            const pf = portfolioFromState({ ...get(), settings });
            const assetsEarly = await syncLiveAssets(get, set, prices, pf);
            const pending = pf.pendingExits(
              prices,
              settings,
              bids,
              gridAddsMap(get().gridState),
            );
            await executePendingExits(
              get,
              set,
              pf,
              pending,
              settings,
              isLiveEnabled(settings),
            );
            pf.markToMarket(prices);
            const assets = assetsEarly ?? (await syncLiveAssets(get, set, prices, pf));
            let summary = pf.summary(prices);
            if (assets && assets.total > 0) {
              summary = { ...summary, cash: assets.cash, equity: assets.total };
            }
            const opps = rankOpportunities(
              tickers as Record<string, never>,
              Math.min(settings.minVolumeIdr || 200_000_000, 200_000_000),
              40,
              16,
              DEFAULT_WEIGHTS,
              "all",
              hist,
            ).filter((o) => isTradeablePair(o.pair));
            const regime = detectRegime(opps);
            set({
              prices,
              priceHistory: hist,
              source: "live",
              lastQuoteAt: Date.now(),
              lastScanAt: get().lastScanAt ?? Date.now(),
              cash: pf.cash,
              positions: pruneDropped({ ...pf.positions }),
              trades: [...pf.trades],
              equityHistory: [...pf.equityHistory],
              summary,
              opportunities: opps,
              regime,
            });
          } finally {
            priceRefreshing = false;
          }
        };
        void tick();
        quoteTimer = setInterval(() => {
          void tick();
        }, 3000);
      },

      start: () => {
        if (get().running) return;
        let initial = get().settings.initialIdr;
        const liveBal = get().realIdrBalance;
        if (initial < 10_000 && liveBal != null && liveBal >= 10_000) {
          initial = Math.round(liveBal);
          const next = applyOptimalToSettings(
            { ...get().settings, initialIdr: initial },
            initial,
            { style: get().riskStyle ?? "aggressive" },
          );
          set({
            settings: next,
            cash: initial,
            summary: emptySummary(initial),
            equityTier: optimalFromCapital(initial, get().riskStyle ?? "aggressive"),
          });
          get().pushLog(
            `Modal diisi dari saldo live Rp ${initial.toLocaleString("id-ID")}`,
            "live",
          );
        }
        if (get().settings.initialIdr < 10_000) {
          set({ error: "Isi modal di Settings (min Rp 10.000)" });
          get().pushLog("Autopilot ditahan — modal/saldo < 10rb", "error");
          return;
        }
        if (Object.keys(get().positions).length === 0 && get().cash < 10_000) {
          const seed = get().settings.initialIdr;
          set({ cash: seed, summary: emptySummary(seed) });
          get().pushLog(`Cash diisi dari modal ${seed.toLocaleString("id-ID")}`, "ai");
        }
        set({ running: true, wantRunning: true, error: null });
        unlockAudio();
        if (typeof window !== "undefined" && "Notification" in window) {
          if (Notification.permission === "default") void Notification.requestPermission();
        }
        const intervalSec = Math.max(15, get().settings.scanIntervalSec || 15);
        get().pushLog(
          isLiveEnabled(get().settings)
            ? `Autopilot LIVE · scan ${intervalSec}s · background ON`
            : `Autopilot PAPER · scan ${intervalSec}s · background ON`,
          isLiveEnabled(get().settings) ? "live" : "ai",
        );
        get().ensureLiveQuotes();
        void get().scanOnce();
        if (scanTimer) clearInterval(scanTimer);
        scanTimer = setInterval(() => {
          void get().scanOnce();
        }, intervalSec * 1000);
        if (typeof window !== "undefined") void startBackground(intervalSec * 1000);
      },

      stop: () => {
        set({ running: false, wantRunning: false });
        if (scanTimer) {
          clearInterval(scanTimer);
          scanTimer = null;
        }
        if (typeof window !== "undefined") void stopBackground();
        get().pushLog("Autopilot stopped");
      },

      closePair: async (pair) => {
        const settings = get().settings;
        const prices = get().prices;
        const key = String(pair || "").toLowerCase();
        if (sellingNow.has(key)) return false;
        const pf = portfolioFromState({ ...get(), settings });
        const pos = pf.positions[key] ?? get().positions[key];
        if (!pos) return false;
        sellingNow.add(key);
        markDropped(key);
        const mark = prices[key] ?? pos.entryPrice;
        const qty = pos.qty;
        const ghost = { ...get().positions };
        delete ghost[key];
        set({ positions: ghost, summary: { ...get().summary, openPositions: Object.keys(ghost).length } });
        get().pushLog(`JUAL ${key.replace("_idr", "").toUpperCase()}…`, "live");
        try {
          if (isLiveEnabled(settings)) {
            const sold = await liveSellOk(settings, key, mark * 0.997, qty);
            if (!sold.ok && !sold.alreadyFlat) {
              unmarkDropped(key);
              set({
                positions: { ...get().positions, [key]: pos },
              });
              get().pushLog(
                `MANUAL SELL ${key} gagal, posisi dikembalikan: ${sold.error}`,
                "error",
              );
              return false;
            }
            pf.forgetPosition(key, mark, sold.alreadyFlat ? "SYNC_SOLD" : "MANUAL_SELL");
            try {
              const info = await getInfo(settings.apiKey, settings.apiSecret);
              pf.syncCash(info.balanceIdr);
            } catch {
              /* cash from next tick */
            }
            get().pushLog(
              `${sold.alreadyFlat ? "SYNC" : "LIVE SELL"} ${key.replace("_idr", "").toUpperCase()} · posisi ditutup`,
              "exit",
            );
          } else {
            const trade = pf.closePosition(key, mark, "MANUAL_SELL", settings);
            if (!trade) {
              unmarkDropped(key);
              return false;
            }
            get().pushLog(
              `MANUAL SELL ${trade.pair} @ ${Math.round(trade.price).toLocaleString("id-ID")} · PnL ${Math.round(trade.pnl).toLocaleString("id-ID")}`,
              "exit",
            );
          }
          const left = { ...pf.positions };
          delete left[key];
          set({
            cash: pf.cash,
            positions: left,
            trades: [...pf.trades],
            equityHistory: [...pf.equityHistory],
            summary: pf.summary(prices),
            gridState: (() => {
              const gs = get().gridState;
              if (gs?.pair !== key) return gs;
              return { pair: key, anchor: gs.anchor || mark, lastBuyPx: mark, adds: 0 };
            })(),
          });
          void get().refreshWallet();
          return true;
        } finally {
          sellingNow.delete(key);
        }
      },

      closeAllPairs: async () => {
        const pairs = Object.keys(get().positions);
        let n = 0;
        for (const p of pairs) {
          if (await get().closePair(p)) n += 1;
        }
        return n;
      },

      setStops: (pair, slPct, tpPct) => {
        const key = String(pair || "").trim().toLowerCase();
        const pos = get().positions[key];
        if (!pos) return false;
        const sl = Math.min(0.12, Math.max(0.005, slPct));
        const tp = Math.min(0.25, Math.max(0.006, tpPct));
        const stopLoss = pos.entryPrice * (1 - sl);
        const takeProfit =
          pos.entryPrice * (1 + get().settings.feeRate * 2 + tp);
        set({
          positions: {
            ...get().positions,
            [key]: { ...pos, stopLoss, takeProfit },
          },
        });
        get().pushLog(
          `TP/SL ${key} diubah · SL ${(sl * 100).toFixed(1)}% · TP ${(tp * 100).toFixed(1)}%`,
          "ai",
        );
        return true;
      },

      manualBuy: async ({ pair, slPct, tpPct, sizeIdr, price, market, grid }) => {
        const settings = get().settings;
        const ticker = String(pair || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace("/", "")
          .replace(/_idr/g, "")
          .replace(/[^a-z0-9]/g, "");
        const key = ticker ? `${ticker}_idr` : "";
        if (!key) {
          get().pushLog("Manual BUY: isi pair dulu", "error");
          return false;
        }

        const sl = Math.min(0.12, Math.max(0.005, slPct || 0.02));
        const tp = Math.min(0.25, Math.max(0.006, tpPct || 0.03));
        let last = get().prices[key] || 0;
        let ask = last;
        let bid = last;
        {
          const { tickers, source } = await fetchTickers();
          if (source === "live") {
            const row = tickers[key] as
              | { last?: string; sell?: string; buy?: string }
              | undefined;
            last = Number(row?.last || last) || last;
            ask = Number(row?.sell || last) || last;
            bid = Number(row?.buy || last) || last;
            if (last > 0) {
              set({ prices: { ...get().prices, [key]: last } });
            }
          } else {
            get().pushLog("Manual BUY: ticker Indodax gagal — no trade", "error");
            return false;
          }
        }
        if (!(last > 0)) {
          get().pushLog(`Manual BUY: pair ${key} tidak ada di Indodax`, "error");
          return false;
        }
        const wantPx = Number(price);
        const limitPx = market
          ? ask * 1.002
          : wantPx > 0
            ? wantPx
            : ask;
        if (!(limitPx > 0)) {
          get().pushLog("Manual BUY: harga tidak valid", "error");
          return false;
        }

        const pf = portfolioFromState({ ...get(), settings });
        const useGrid = Boolean(grid);
        if (pf.has(key) && !useGrid) {
          get().pushLog(`Manual BUY: ${key} sudah open — ubah TP/SL saja`, "error");
          return false;
        }
        if (pf.cash < 10_000) {
          get().pushLog("Manual BUY: cash < 10rb", "error");
          return false;
        }

        const want = Math.round(Number(sizeIdr) || 0);
        await ensurePairMeta();
        const need = minBuyIdr(key, limitPx);
        const size = Math.max(
          need,
          Math.min(
            want > 0 ? Math.max(want, need) : Math.max(settings.maxNotional || 0, need),
            Math.floor(pf.cash * 0.95),
          ),
        );
        if (size < need) {
          get().pushLog(
            `Manual BUY: lot min Rp ${need.toLocaleString("id-ID")} — naikkan size / cash`,
            "error",
          );
          return false;
        }
        const live = isLiveEnabled(settings);

        if (live) {
          try {
            const limitAt = limitPx;
            const before = await getCoinBalances(
              settings.apiKey,
              settings.apiSecret,
              coinOfPair(key),
            );
            const raw = await placeBuy(
              settings.apiKey,
              settings.apiSecret,
              key,
              limitAt,
              size,
            );
            if (raw.error || raw.data?.success === 0) {
              get().pushLog(
                `MANUAL LIVE BUY gagal ${key}: ${raw.error || raw.data?.error}`,
                "error",
              );
              return false;
            }
            const oid = tradeOrderId(raw);
            if (oid) {
              const settled = await waitUntilSettled(
                settings.apiKey,
                settings.apiSecret,
                key,
                oid,
                market ? 8000 : 3500,
              );
              if (!settled.filled) {
                if (market) {
                  get().pushLog(
                    `MARKET BUY ${key} belum fill @ ${limitAt.toLocaleString("id-ID")} — order tetap open`,
                    "live",
                  );
                }
                const pending: PendingManual = {
                  pair: key,
                  orderId: oid,
                  limitPx: limitAt,
                  slPct: sl,
                  tpPct: tp,
                  sizeIdr: size,
                  ts: Date.now(),
                };
                set({
                  pendingManual: [
                    ...(get().pendingManual ?? []).filter((x) => x.pair !== key),
                    pending,
                  ],
                });
                get().pushLog(
                  market
                    ? `MARKET ${key} menunggu fill`
                    : `LIMIT menunggu ${key} @ ${limitAt.toLocaleString("id-ID")}`,
                  "live",
                );
                return true;
              }
            }
            const after = await getCoinBalances(
              settings.apiKey,
              settings.apiSecret,
              coinOfPair(key),
            );
            const filledQty = fillQtyFromDelta(before, after, key);
            if (filledQty < 0) {
              get().pushLog(`MANUAL BUY ${key} balance gagal — tidak catat`, "error");
              return false;
            }
            if (filledQty <= 0) {
              get().pushLog(`MANUAL BUY ${key} qty 0`, "error");
              return false;
            }
            const info = await getInfo(settings.apiKey, settings.apiSecret);
            pf.syncCash(info.balanceIdr);
            const reason = useGrid
              ? `GRID:${(tp * 100).toFixed(1)}`
              : `MANUAL:SL${(sl * 100).toFixed(1)}/TP${(tp * 100).toFixed(1)}`;
            const trade = useGrid
              ? pf.addToLong(key, limitAt, filledQty, settings, reason, {
                  stopPct: sl,
                  tpPct: tp,
                  skipCash: true,
                })
              : pf.openFilledLong(key, limitAt, filledQty, settings, reason, {
                  stopPct: sl,
                  tpPct: tp,
                  setup: "NONE",
                  holdMin: 12,
                  skipCash: true,
                });
            if (!trade) {
              get().pushLog(`MANUAL BUY ${key} tidak tercatat`, "error");
              return false;
            }
            get().pushLog(
              `${useGrid ? "GRID" : market ? "MARKET" : "MANUAL"} LIVE BUY ${trade.pair} qty=${trade.qty} @ ${Math.round(trade.price).toLocaleString("id-ID")} · SL ${(sl * 100).toFixed(1)}% TP ${(tp * 100).toFixed(1)}%`,
              "entry",
            );
            const prevG = get().gridState;
            const same = prevG?.pair === key;
            set({
              cash: pf.cash,
              positions: pruneDropped({ ...pf.positions }),
              trades: [...pf.trades],
              equityHistory: [...pf.equityHistory],
              summary: pf.summary(get().prices),
              prices: { ...get().prices, [key]: last },
              watchPair: key,
              gridState: useGrid
                ? {
                    pair: key,
                    anchor: same && prevG && prevG.anchor > 0 ? prevG.anchor : trade.price,
                    lastBuyPx: trade.price,
                    adds: (same && prevG ? prevG.adds : 0) + 1,
                  }
                : prevG,
            });
            return true;
          } catch (e) {
            get().pushLog(
              `MANUAL BUY error: ${e instanceof Error ? e.message : String(e)}`,
              "error",
            );
            return false;
          }
        }

        const fill = limitPx;
        const qty = quantizeBaseQty(size / fill, key);
        if (qty <= 0) {
          get().pushLog(`MANUAL BUY ${key}: qty 0 / min base`, "error");
          return false;
        }
        const reason = useGrid
          ? `GRID:${(tp * 100).toFixed(1)}`
          : `MANUAL:SL${(sl * 100).toFixed(1)}/TP${(tp * 100).toFixed(1)}`;
        const trade = useGrid
          ? pf.addToLong(key, fill, qty, settings, reason, {
              stopPct: sl,
              tpPct: tp,
            })
          : pf.openFilledLong(key, fill, qty, settings, reason, {
              stopPct: sl,
              tpPct: tp,
              setup: "NONE",
              holdMin: 12,
            });
        if (!trade) {
          get().pushLog(`MANUAL BUY ${key} gagal (cash/min order)`, "error");
          return false;
        }
        get().pushLog(
          `${useGrid ? "GRID" : "MANUAL"} BUY ${trade.pair} qty=${trade.qty} @ ${Math.round(trade.price).toLocaleString("id-ID")} · SL ${(sl * 100).toFixed(1)}% TP ${(tp * 100).toFixed(1)}%`,
          "entry",
        );
        const prevG = get().gridState;
        const same = prevG?.pair === key;
        set({
          cash: pf.cash,
          positions: pruneDropped({ ...pf.positions }),
          trades: [...pf.trades],
          equityHistory: [...pf.equityHistory],
          summary: pf.summary({ ...get().prices, [key]: last }),
          prices: { ...get().prices, [key]: last },
          watchPair: key,
          gridState: useGrid
            ? {
                pair: key,
                anchor: same && prevG && prevG.anchor > 0 ? prevG.anchor : trade.price,
                lastBuyPx: trade.price,
                adds: (same && prevG ? prevG.adds : 0) + 1,
              }
            : prevG,
        });
        return true;
      },

      manualSell: async (pair, qty) => {
        const ticker = String(pair || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace("/", "")
          .replace(/_idr/g, "")
          .replace(/[^a-z0-9]/g, "");
        const key = ticker ? `${ticker}_idr` : "";
        if (!key) {
          get().pushLog("Manual SELL: isi pair dulu", "error");
          return false;
        }
        const settings = get().settings;
        const prices = get().prices;
        const want = Number(qty);
        const pos = get().positions[key];
        const mark = prices[key] || pos?.entryPrice || 0;
        if (pos) {
          const sellQty =
            want > 0 ? Math.min(want, pos.qty) : pos.qty;
          if (sellQty >= pos.qty * 0.995) return get().closePair(key);
          const pf = portfolioFromState({ ...get(), settings });
          if (isLiveEnabled(settings)) {
            const sold = await liveSellOk(
              settings,
              key,
              mark * 0.997,
              sellQty,
            );
            if (!sold.ok) {
              get().pushLog(
                `MANUAL SELL ${key} gagal: ${sold.error}`,
                "error",
              );
              return false;
            }
          }
          const trade = pf.closePartial(
            key,
            sellQty,
            mark,
            "MANUAL_SELL",
            settings,
          );
          if (!trade) return false;
          get().pushLog(
            `MANUAL SELL ${key} qty=${trade.qty} · PnL ${Math.round(trade.pnl).toLocaleString("id-ID")}`,
            "exit",
          );
          set({
            cash: pf.cash,
            positions: pruneDropped({ ...pf.positions }),
            trades: [...pf.trades],
            equityHistory: [...pf.equityHistory],
            summary: pf.summary(prices),
            gridState: (() => {
              const gs = get().gridState;
              if (gs?.pair !== key) return gs;
              return {
                pair: key,
                anchor: gs.anchor || mark,
                lastBuyPx: mark,
                adds: Math.max(0, (gs.adds || 1) - 1),
              };
            })(),
          });
          return true;
        }
        if (isLiveEnabled(settings) && !(get().wallet ?? []).length) {
          await get().refreshWallet();
        }
        return get().sellWalletCoin(ticker, want > 0 ? want : undefined);
      },

      cancelPendingManual: async (pair) => {
        const key = String(pair || "").toLowerCase();
        const row = (get().pendingManual ?? []).find((p) => p.pair === key);
        const settings = get().settings;
        if (row && isLiveEnabled(settings) && row.orderId) {
          await cancelOneOrder(
            settings.apiKey,
            settings.apiSecret,
            key,
            row.orderId,
            "buy",
          );
        }
        set({
          pendingManual: (get().pendingManual ?? []).filter((p) => p.pair !== key),
        });
        get().pushLog(`Limit ${key} dibatalkan`, "ai");
        return true;
      },

      refreshWallet: async () => {
        const { settings, prices } = get();
        if (!settings.apiKey || !settings.apiSecret) {
          get().pushLog("Wallet: isi Indodax API dulu di Settings", "error");
          return false;
        }
        set({ walletBusy: true });
        try {
          const { balanceIdr, raw } = await getInfo(settings.apiKey, settings.apiSecret);
          if (raw.error || raw.data?.success === 0) {
            get().pushLog(
              `Wallet gagal: ${raw.error || raw.data?.error || "auth"}`,
              "error",
            );
            set({ apiStatus: "fail", walletBusy: false });
            return false;
          }
          const wallet = parseWallet(raw, prices);
          const openOrders = await listAllOpenOrders(settings.apiKey, settings.apiSecret);
          const tot = walletTotals(wallet, prices, balanceIdr);
          const pf = portfolioFromState({ ...get(), settings });
          pf.syncCash(tot.cash);
          reconcileLivePositions(pf, wallet, prices, (m, k) => get().pushLog(m, k));
          if (tot.total >= 10_000 && settings.initialIdr < 10_000) {
            pf.initialIdr = Math.round(tot.total);
          }
          const summary = {
            ...pf.summary(prices),
            cash: tot.cash,
            equity: tot.total > 0 ? tot.total : pf.summary(prices).equity,
            initial:
              settings.initialIdr < 10_000 && tot.total >= 10_000
                ? Math.round(tot.total)
                : get().summary.initial || settings.initialIdr,
          };
          set({
            apiStatus: "ok",
            realIdrBalance: balanceIdr,
            wallet,
            openOrders,
            walletAt: Date.now(),
            walletBusy: false,
            cash: tot.cash,
            positions: pruneDropped({ ...pf.positions }),
            trades: [...pf.trades],
            summary,
            settings:
              settings.initialIdr < 10_000 && tot.total >= 10_000
                ? { ...settings, initialIdr: Math.round(tot.total) }
                : settings,
          });
          get().pushLog(
            `Aset total Rp ${Math.round(tot.total).toLocaleString("id-ID")} · cash Rp ${Math.round(tot.cash).toLocaleString("id-ID")}`,
            "live",
          );
          return true;
        } catch (e) {
          set({ walletBusy: false });
          get().pushLog(
            `Wallet error: ${e instanceof Error ? e.message : String(e)}`,
            "error",
          );
          return false;
        }
      },

      sellWalletCoin: async (coin, qty) => {
        const { settings, prices, wallet } = get();
        const row = wallet.find((w) => w.coin === coin);
        if (!row) return false;
        const pair = `${coin}_idr`;
        const px = prices[pair] || row.price;
        const sellQty =
          qty != null && qty > 0 ? Math.min(qty, row.qty) : row.qty;
        const sold = await liveSellOk(settings, pair, px * 0.997, sellQty);
        if (!sold.ok) {
          get().pushLog(`Jual wallet ${coin} gagal: ${sold.error}`, "error");
          return false;
        }
        get().pushLog(`Wallet SELL ${coin}`, "live");
        await get().refreshWallet();
        return true;
      },

      sellAllWallet: async () => {
        const coins = get().wallet.filter((w) => w.coin !== "idr" && w.qty > 0);
        let n = 0;
        for (const w of coins) {
          if (await get().sellWalletCoin(w.coin)) n += 1;
        }
        return n;
      },

      cancelExchangeOrder: async (order) => {
        const { settings } = get();
        const r = await cancelOneOrder(
          settings.apiKey,
          settings.apiSecret,
          order.pair,
          order.orderId,
          order.type,
        );
        if (r.error || r.data?.success === 0) {
          get().pushLog(`Cancel gagal: ${r.error || r.data?.error}`, "error");
          return false;
        }
        get().pushLog(`Cancel ${order.pair} #${order.orderId}`, "live");
        await get().refreshWallet();
        return true;
      },

      cancelAllExchangeOrders: async () => {
        const orders = get().openOrders;
        let n = 0;
        for (const o of orders) {
          if (await get().cancelExchangeOrder(o)) n += 1;
        }
        return n;
      },

      scanOnce: async () => {
        if (scanning) return;
        scanning = true;
        try {
          for (let i = 0; i < 20 && priceRefreshing; i++) {
            await new Promise((r) => setTimeout(r, 50));
          }
          void ensurePairMeta();
          let settings = get().settings;
          const live = isLiveEnabled(settings);
          const { tickers, source } = await fetchTickers();
          if (source !== "live") {
            set({ source: "error" });
            if (live && get().running) {
              get().pushLog("NO TRADE — ticker Indodax gagal / bukan live", "error");
            }
            return;
          }

          const prices: Record<string, number> = {};
          const bids: Record<string, number> = {};
          for (const [pair, row] of Object.entries(tickers)) {
            const t = row as { last?: string; buy?: string };
            const last = Number(t.last);
            const buy = Number(t.buy);
            if (last > 0) prices[pair] = last;
            if (buy > 0) bids[pair] = buy;
          }
          const hist = pushPriceHistory(get().priceHistory, prices);
          const weights = adaptWeights(get().trades);
          await settleManualLimits(get, set);
          const scoredAll = scoreMarket(tickers as Record<string, never>, {
            minVolumeIdr: settings.minVolumeIdr,
            weights,
            focus: "all",
            priceHistory: hist,
            barSec: 3,
          });
          const pf = portfolioFromState({ ...get(), settings });
          await syncLiveAssets(get, set, prices, pf);

          const closedPending = pf.pendingExits(
            prices,
            settings,
            bids,
            gridAddsMap(get().gridState),
          );
          await executePendingExits(get, set, pf, closedPending, settings, live);

          pf.markToMarket(prices);
          const assets = await syncLiveAssets(get, set, prices, pf);
          let summary = pf.summary(prices);
          if (assets && assets.total > 0) {
            summary = { ...summary, cash: assets.cash, equity: assets.total };
          }
          let equityTier = optimalFromCapital(
            summary.equity,
            get().riskStyle ?? "aggressive",
          );
          const riskMode = get().riskMode ?? "optimal";
          const scaleWithEquity = get().scaleWithEquity;
          if (riskMode === "optimal" && scaleWithEquity && summary.equity > 0) {
            const scaled = scaleSettingsToEquity(
              settings,
              summary.equity,
              get().riskStyle ?? "aggressive",
            );
            if (scaled.changed) {
              settings = { ...scaled.settings, scanFocus: "all" };
              equityTier = scaled.pack;
              get().pushLog(
                `Equity scale → tier ${scaled.pack.label} · maxPos ${settings.maxPositions}`,
                "ai",
              );
              if (get().running && scanTimer) {
                clearInterval(scanTimer);
                scanTimer = setInterval(() => {
                  void get().scanOnce();
                }, Math.max(15, settings.scanIntervalSec) * 1000);
              }
            } else {
              equityTier = scaled.pack;
            }
          }

          const opps = rankOpportunities(
            tickers as Record<string, never>,
            settings.minVolumeIdr,
            Math.min(settings.minScoreToBuy, 50),
            40,
            weights,
            "all",
            hist,
          ).filter((o) => isTradeablePair(o.pair));

          get().pushLog(
            `SCAN ${Object.keys(tickers).length} ticker · ${scoredAll.length} lolos vol · top ${opps.length}`,
          );

          const regime = detectRegime(opps);
          let playbookWhy = "Smart agresif";
          const pb = playbookOf("smart");
          if (settings.playbook !== "smart") {
            settings = { ...settings, playbook: "smart" };
          }
          playbookWhy = `Smart agresif · ${regime.regime} — ${regime.reason}`;
          const autoTrade = get().autoTrade;
          const universe = opps.slice(0, 12);
          const byPair = Object.fromEntries(opps.map((o) => [o.pair, o]));

          const held = Object.values(pf.positions).map((p) => {
            const px = prices[p.pair] ?? p.entryPrice;
            const mtm = p.qty * px;
            return {
              pair: p.pair,
              score: opps.find((o) => o.pair === p.pair)?.score ?? 40,
              pnlPct: p.costIdr > 0 ? ((mtm - p.costIdr) / p.costIdr) * 100 : 0,
              ageMin: (Date.now() - p.entryTime) / 60_000,
            };
          });

          let aiSource: BotState["aiSource"] = "heuristic";
          let aiSummary = "";
          const aiDecisions: AiDecision[] = [];
          const skipNewBuys = false;
          if (universe.length) {
            aiSummary = regime.allowEntry
              ? `Heuristic ${pb.name} · ${regime.regime} — ${regime.reason}`
              : `NO TRADE · ${regime.reason}`;
          }

          const grokPilot = false;
          const eqNow = summary.equity > 0 ? summary.equity : pf.cash;
          let base = get().circuitBase;
          if (!(base >= 10_000)) base = settings.initialIdr >= 10_000 ? settings.initialIdr : eqNow;
          if (pf.openCount() === 0 && eqNow >= 10_000) {
            if (Math.abs(eqNow - base) / Math.max(base, 1) >= 0.049) {
              get().pushLog(
                `Circuit reset — modal acuan Rp ${Math.round(eqNow).toLocaleString("id-ID")} (posisi flat)`,
                "ai",
              );
            }
            base = eqNow;
            set({ circuitBase: eqNow });
          }
          const globalRet = base > 0 ? ((eqNow - base) / base) * 100 : 0;
          const hitLoss =
            pf.openCount() > 0 &&
            globalRet <= -((settings.globalStopPct || 0.05) * 100);
          const hitWin =
            pf.openCount() > 0 &&
            globalRet >= (settings.globalTakePct || 0.05) * 100;
          const canHeuristic = !grokPilot && !hitWin;
          const canTrade =
            autoTrade &&
            get().running &&
            (grokPilot || canHeuristic) &&
            !hitWin &&
            !hitLoss;

          if (hitWin) {
            aiSummary = `LOCK +${((settings.globalTakePct || 0.05) * 100).toFixed(0)}% global — jual yang hijau, stop entry`;
          } else if (hitLoss) {
            aiSummary = `CIRCUIT -${((settings.globalStopPct || 0.05) * 100).toFixed(0)}% — jual hanya yang tembus SL`;
          } else if (!get().running) {
            aiSummary = "Scan pasar jalan. Tekan Start supaya auto-trade order.";
          } else if (!autoTrade) {
            aiSummary = "Auto-trade OFF — nyalakan tombol Auto.";
          } else if (grokPilot) {
            aiSummary = aiSummary || `GROK PILOT · ${regime.regime}`;
          } else if (!regime.allowEntry) {
            aiSummary = `NO TRADE · ${regime.reason}`;
          } else {
            aiSummary =
              aiSummary ||
              `${pb.name} · ${regime.regime} · ${regime.reason}`;
          }

          const buyPairs = new Set(
            aiDecisions.filter((d) => d.action === "BUY").map((d) => d.pair),
          );
          const sellPairs = aiDecisions.filter(
            (d) => d.action === "SELL" && pf.has(d.pair),
          );

          if (autoTrade && get().running && grokPilot) {
            for (const d of sellPairs) {
              const pos = pf.positions[d.pair];
              if (!pos) continue;
              const ageMin = (Date.now() - pos.entryTime) / 60_000;
              const mark = bids[d.pair] || prices[d.pair] || pos.entryPrice;
              const mtm = pos.qty * mark;
              const pnlPct = pos.costIdr > 0 ? ((mtm - pos.costIdr) / pos.costIdr) * 100 : 0;
              if (ageMin < 2 && pnlPct > -3) {
                get().pushLog(`GROK SELL skip ${d.pair}: hold < 2 menit`, "ai");
                continue;
              }
              if (live) {
                const sold = await liveSellOk(settings, d.pair, mark, pos.qty);
                if (!sold.ok) {
                  get().pushLog(`GROK SELL ${d.pair} gagal: ${sold.error}`, "error");
                  continue;
                }
              }
              const t = pf.closePosition(d.pair, mark, `GROK:${d.reason}`, settings);
              if (t) {
                markPairCooldown(t.pair);
                get().pushLog(
                  `GROK SELL ${t.pair} · ${d.reason} · PnL ${Math.round(t.pnl).toLocaleString("id-ID")}`,
                  "exit",
                );
              }
            }
          }

          const hasGridPos = Object.values(pf.positions).some((p) => p.setup === "GRID");
          if (!get().gridState && hasGridPos) {
            const g = Object.values(pf.positions).find((p) => p.setup === "GRID");
            if (g) {
              set({
                gridState: {
                  pair: g.pair,
                  anchor: g.entryPrice,
                  lastBuyPx: g.entryPrice,
                  adds: 1,
                },
              });
            }
          }
          if (
            hasGridPos &&
            autoTrade &&
            get().running &&
            !hitWin &&
            !hitLoss
          ) {
            const why = await runGridCycle(
              get,
              set,
              pf,
              prices,
              bids,
              settings,
              opps,
              live,
              regime.regime,
            );
            const gs = get().gridState;
            const step = gridStepPct(settings.feeRate, settings.takeProfit);
            aiSummary = `GRID ${gs?.pair?.replace("_idr", "").toUpperCase() || "—"} · step ${(step * 100).toFixed(1)}% · lot ${gs?.adds ?? 0} · ${why}`;
            get().pushLog(aiSummary, "ai");
          }

          if (skipNewBuys) {
            if (get().running) {
              get().pushLog("NO TRADE — AI gagal, tidak fallback BUY", "error");
            }
          } else if (!canTrade) {
            if (get().running && !hitLoss) {
              get().pushLog(`Tidak order: ${aiSummary}`, "ai");
            }
          } else {
            const buyRows = grokPilot
              ? aiDecisions
                  .filter((d) => d.action === "BUY")
                  .map((d) => byPair[d.pair])
                  .filter((row) => row && row.setup !== "PULLBACK")
              : universe.filter((o) => {
                  if (o.setup === "PULLBACK") return false;
                  if (!playbookFitsSetup(pb, o.setup, regime.regime)) return false;
                  if (!playbookAllowsPair(pb, o.pair)) return false;
                  if (pb.requireStrong) return o.signal === "STRONG_BUY";
                  return o.signal === "BUY" || o.signal === "STRONG_BUY";
                });

            if (!buyRows.length) {
              get().pushLog(
                `GATE: 0 kandidat · ${pb.name} · ${regime.regime}`,
                "ai",
              );
            }

            const maxPos = Math.min(settings.maxPositions, pb.maxPositions);
            let filled = 0;
            for (const row of buyRows) {
              if (!row) continue;
              if (isDropped(row.pair) || sellingNow.has(row.pair)) continue;
              if (!grokPilot) {
                const ev = evaluateEntry(row, settings.feeRate, {
                  regime: regime.regime,
                  playbook: settings.playbook,
                });
                if (!ev.ok) {
                  get().pushLog(`Skip ${row.pair}: ${ev.reason}`, "ai");
                  continue;
                }
              } else {
                const ev = evaluateEntry(row, settings.feeRate, {
                  regime: regime.regime,
                  skipKind: true,
                  playbook: settings.playbook,
                });
                if (!ev.ok) {
                  get().pushLog(`Grok skip ${row.pair}: ${ev.reason}`, "ai");
                  continue;
                }
              }
              const entryExtras = {
                stopPct: row.setupStopPct,
                tpPct: row.setupTpPct,
                setup: row.setup,
                holdMin: row.setupHoldMin,
                setupLow: row.setupDumpLow,
              };
              let want = grokPilot ? buyPairs.has(row.pair) : false;
              if (!grokPilot) {
                want = true;
              }
              if (!want) continue;

              if (pf.has(row.pair)) continue;
              if (isPairCooling(row.pair)) {
                get().pushLog(`Skip ${row.pair}: cooldown 12 menit setelah jual`, "ai");
                continue;
              }
              if (filled >= 1) {
                get().pushLog("Max 1 entry / scan — hold yang sudah terbuka", "ai");
                break;
              }
              if (pf.openCount() >= maxPos) {
                get().pushLog(
                  `Posisi penuh (${pf.openCount()}) — hold sampai TP/SL, tidak rotasi`,
                  "ai",
                );
                break;
              }

              if (live) {
                try {
                  await ensurePairMeta();
                  const limitPx = row.sell > 0 ? row.sell : row.price;
                  const need = minBuyIdr(row.pair, limitPx);
                  const sized = positionSizeIdr(
                    settings.trade90Pct
                      ? summary.equity || pf.cash
                      : pf.cash || summary.equity,
                    settings,
                    row.pair,
                  );
                  const cashCap = Math.floor(pf.cash * 0.95);
                  const notionCap = settings.trade90Pct
                    ? cashCap
                    : Math.max(settings.maxNotional || 0, need);
                  const size = Math.max(
                    need,
                    Math.min(
                      Math.max(sized || 0, need),
                      notionCap,
                      cashCap,
                    ),
                  );
                  if (pf.cash < 10_000) {
                    get().pushLog(
                      `LIVE BUY skip: cash Rp ${Math.round(pf.cash).toLocaleString("id-ID")} < min 10rb`,
                      "error",
                    );
                    break;
                  }
                  if (size < need || cashCap < need) {
                    get().pushLog(
                      `LIVE BUY skip ${row.pair}: lot min Rp ${need.toLocaleString("id-ID")} > cash`,
                      "ai",
                    );
                    continue;
                  }
                  const before = await getCoinBalances(
                    settings.apiKey,
                    settings.apiSecret,
                    coinOfPair(row.pair),
                  );
                  const raw = await placeBuy(
                    settings.apiKey,
                    settings.apiSecret,
                    row.pair,
                    limitPx,
                    size,
                  );
                  if (raw.error || raw.data?.success === 0) {
                    get().pushLog(
                      `LIVE BUY gagal ${row.pair}: ${raw.error || raw.data?.error}`,
                      "error",
                    );
                    continue;
                  }
                  const oid = tradeOrderId(raw);
                  if (oid) {
                    const settled = await waitUntilSettled(
                      settings.apiKey,
                      settings.apiSecret,
                      row.pair,
                      oid,
                    );
                    if (!settled.filled) {
                      await cancelOpenOrders(settings.apiKey, settings.apiSecret, row.pair);
                      const afterCancel = await getCoinBalances(
                        settings.apiKey,
                        settings.apiSecret,
                        coinOfPair(row.pair),
                      );
                      const partial = fillQtyFromDelta(before, afterCancel, row.pair);
                      if (partial < 0) {
                        get().pushLog(
                          `LIVE BUY ${row.pair} balance gagal — batal`,
                          "error",
                        );
                        continue;
                      }
                      if (partial > 0) {
                        const infoP = await getInfo(settings.apiKey, settings.apiSecret);
                        pf.syncCash(infoP.balanceIdr);
                        const decP = aiDecisions.find((d) => d.pair === row.pair);
                        const tP = pf.openFilledLong(
                          row.pair,
                          limitPx,
                          partial,
                          settings,
                          grokPilot
                            ? `GROK:${decP?.reason || row.score}`
                            : `${row.setup}:${aiSource}:${row.score}`,
                          {
                            ...entryExtras,
                            stopPct: decP?.slPct ?? entryExtras.stopPct,
                            tpPct: decP?.tpPct ?? entryExtras.tpPct,
                            skipCash: true,
                          },
                        );
                        if (tP) {
                          filled += 1;
                          get().pushLog(
                            `LIVE BUY PARTIAL ${tP.pair} qty=${tP.qty}`,
                            "entry",
                          );
                        }
                        continue;
                      }
                      get().pushLog(
                        `LIVE BUY ${row.pair} submitted tapi belum fill — batal`,
                        "error",
                      );
                      continue;
                    }
                  }
                  const after = await getCoinBalances(
                    settings.apiKey,
                    settings.apiSecret,
                    coinOfPair(row.pair),
                  );
                  const filledQty = fillQtyFromDelta(before, after, row.pair);
                  if (filledQty < 0) {
                    get().pushLog(
                      `LIVE BUY ${row.pair} balance gagal — tidak catat posisi`,
                      "error",
                    );
                    continue;
                  }
                  if (filledQty <= 0) {
                    get().pushLog(
                      `LIVE BUY ${row.pair} submitted tapi qty 0 — tidak catat posisi`,
                      "error",
                    );
                    continue;
                  }
                  const info = await getInfo(settings.apiKey, settings.apiSecret);
                  pf.syncCash(info.balanceIdr);
                  const minBase = getPairLimits(row.pair).minBase;
                  if (minBase > 0 && filledQty < minBase) {
                    get().pushLog(`LIVE BUY ${row.pair} di bawah min base`, "error");
                    continue;
                  }
                  const dec = aiDecisions.find((d) => d.pair === row.pair);
                  const trade = pf.openFilledLong(
                    row.pair,
                    limitPx,
                    filledQty,
                    settings,
                    grokPilot
                      ? `GROK:${dec?.reason || row.score}`
                      : `${row.setup}:${aiSource}:${row.score}`,
                    {
                      ...entryExtras,
                      stopPct: dec?.slPct ?? entryExtras.stopPct,
                      tpPct: dec?.tpPct ?? entryExtras.tpPct,
                      skipCash: true,
                    },
                  );
                  if (trade) {
                    filled += 1;
                    followChart(set, get, trade.pair);
                    get().pushLog(
                      `LIVE BUY FILLED ${trade.pair} qty=${trade.qty} @ ${Math.round(trade.price).toLocaleString("id-ID")}`,
                      "entry",
                    );
                  }
                } catch (e) {
                  get().pushLog(
                    `LIVE BUY error: ${e instanceof Error ? e.message : String(e)}`,
                    "error",
                  );
                }
                continue;
              }

              const dec = aiDecisions.find((d) => d.pair === row.pair);
              const trade = pf.openLong(
                row.pair,
                row.price,
                row.score,
                grokPilot
                  ? `GROK:${dec?.reason || row.score}`
                  : `${row.setup}:${aiSource}:${row.score}`,
                settings,
                {
                  ...entryExtras,
                  stopPct: dec?.slPct ?? entryExtras.stopPct,
                  tpPct: dec?.tpPct ?? entryExtras.tpPct,
                },
              );
              if (trade) {
                filled += 1;
                followChart(set, get, trade.pair);
                get().pushLog(
                  `AUTO BUY ${trade.pair} qty=${trade.qty} @ ${Math.round(trade.price).toLocaleString("id-ID")}`,
                  "entry",
                );
              } else {
                const why = canOpenReason(
                  pf.openCount(),
                  summary.equity,
                  row.score,
                  settings,
                  row.pair,
                  { cash: pf.cash, dailyLoss: pf.dailyLoss() },
                );
                get().pushLog(
                  `BUY skip ${row.pair}: ${why.ok ? "qty/min order" : why.reason}`,
                  "ai",
                );
              }
            }
            if (buyRows.length && filled === 0) {
              get().pushLog("GATE: kandidat ada, tidak ada yang terisi", "ai");
            }
          }

          if (live && get().running && autoTrade) {
            try {
              const heldPairs = new Set(Object.keys(pf.positions));
              const { raw } = await getInfo(settings.apiKey, settings.apiSecret);
              const w = parseWallet(raw, prices);
              for (const asset of w) {
                if (asset.coin === "idr" || asset.qty <= 0) continue;
                const pair = `${asset.coin}_idr`;
                if (heldPairs.has(pair)) continue;
                if (!isDropped(pair)) continue;
                if (asset.hold > 0) continue;
                if (asset.valueIdr > 0 && asset.valueIdr < 10_000) continue;
                get().pushLog(
                  `Sisa ${asset.coin.toUpperCase()} setelah exit — jual leftover`,
                  "live",
                );
                await get().sellWalletCoin(asset.coin);
              }
            } catch {
              /* leftover after our own exit only */
            }
          }

          summary = pf.summary(prices);
          const tot = walletTotals(get().wallet ?? [], prices, pf.cash);
          if (tot.total > 0) {
            summary = { ...summary, cash: tot.cash, equity: tot.total };
          }
          set({
            settings,
            lastScanAt: Date.now(),
            source: "live",
            opportunities: opps,
            prices,
            priceHistory: hist,
            positions: pruneDropped({ ...pf.positions }),
            trades: [...pf.trades],
            equityHistory: [...pf.equityHistory],
            summary,
            cash: pf.cash,
            regime,
            weights,
            aiSource,
            aiSummary,
            aiDecisions,
            equityTier,
            playbookWhy,
            error: null,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set({ error: msg });
          get().pushLog(`Scan error: ${msg}`, "error");
        } finally {
          scanning = false;
        }
      },
    }),
    {
      name: "neurotrend-v11-state",
      partialize: (s) => ({
        settings: s.settings,
        cash: s.cash,
        positions: s.positions,
        trades: s.trades.slice(0, 100),
        equityHistory: s.equityHistory.slice(-100),
        priceHistory: Object.fromEntries(
          Object.entries(s.priceHistory ?? {})
            .slice(0, 40)
            .map(([k, v]) => [k, v.slice(-40)]),
        ),
        autoTrade: s.autoTrade,
        scaleWithEquity: s.scaleWithEquity,
        riskMode: s.riskMode,
        riskStyle: s.riskStyle,
        wantRunning: s.wantRunning,
        pendingManual: s.pendingManual ?? [],
        watchPair: s.watchPair || "btc_idr",
        watchTf: s.watchTf || "15",
        gridState: s.gridState ?? null,
        autoPlaybook: s.autoPlaybook !== false,
        circuitBase: s.circuitBase || 0,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<BotState>;
        const settings = normalizeSettings(p.settings ?? current.settings);
        const positions = p.positions ?? {};
        const trades = p.trades ?? [];
        const seeded =
          typeof p.cash === "number" &&
          Math.round(p.cash) === 198_335 &&
          Object.keys(positions).length === 0 &&
          trades.length === 0;
        const cash =
          typeof p.cash === "number" && !seeded ? p.cash : settings.initialIdr;
        const equityHistory = p.equityHistory ?? [];
        const pf = portfolioFromState({
          cash,
          settings,
          positions,
          trades,
          equityHistory,
        });
        return {
          ...current,
          ...p,
          settings,
          cash: pf.cash,
          positions: pf.positions,
          trades: pf.trades,
          equityHistory: pf.equityHistory,
          summary: pf.summary({}),
          priceHistory: p.priceHistory ?? {},
          riskMode: p.riskMode === "manual" ? "manual" : "optimal",
          riskStyle:
            p.riskStyle === "safe" || p.riskStyle === "balanced"
              ? p.riskStyle
              : "aggressive",
          autoTrade: p.autoTrade !== false,
          scaleWithEquity: p.scaleWithEquity !== false,
          wantRunning: p.wantRunning === true,
          running: false,
          pendingManual: p.pendingManual ?? [],
          watchPair: p.watchPair || "btc_idr",
          watchTf: p.watchTf || "15",
          gridState: p.gridState ?? null,
          autoPlaybook: p.autoPlaybook !== false,
          playbookWhy: p.playbookWhy ?? "",
          circuitBase: typeof p.circuitBase === "number" ? p.circuitBase : 0,
        };
      },
    },
  ),
);
