import type { PlaybookId } from "./playbook";

export type Signal =
  | "STRONG_BUY"
  | "BUY"
  | "HOLD"
  | "SELL"
  | "STRONG_SELL"
  | "AVOID";
export type TradingMode = "paper" | "live";
export type ScanFocus = "all" | "new_coins";

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

export type IndicatorDetails = {
  rsi: number | null;
  macd: number | null;
  bbPos: number | null;
  emaFast: number | null;
  emaSlow: number | null;
  volRatio: number | null;
  atrPct: number | null;
  techScore?: number;
};

export type Opportunity = {
  pair: string;
  price: number;
  buy: number;
  sell: number;
  high: number;
  low: number;
  volumeIdr: number;
  rangePos: number;
  spreadPct: number;
  score: number;
  signal: Signal;
  /** day high-low range % */
  dayRangePct?: number;
  change24h?: number;
  /** LISTING | BARU | MEME | VOLATILE | HOT */
  tag?: string;
  isNewCoin?: boolean;
  details?: IndicatorDetails;
  forecast?: PairForecast;
  setup?: "BOUNCE" | "PULLBACK" | "BREAKOUT" | "NONE";
  setupReason?: string;
  setupStopPct?: number;
  setupTpPct?: number;
  setupHoldMin?: number;
  setupDumpLow?: number;
};

export type Position = {
  pair: string;
  qty: number;
  entryPrice: number;
  entryTime: number;
  stopLoss: number;
  takeProfit: number;
  costIdr: number;
  peakPrice?: number;
  setup?: "BOUNCE" | "PULLBACK" | "BREAKOUT" | "NONE" | "GRID";
  setupHoldMin?: number;
  setupLow?: number;
  slHits?: number;
  tpMid?: number;
  tpUpper?: number;
  partialTaken?: boolean;
};

export type Trade = {
  id: string;
  ts: number;
  pair: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  notional: number;
  fee: number;
  reason: string;
  pnl: number;
};

export type EquityPoint = {
  ts: number;
  equity: number;
  cash: number;
};

export type BotSettings = {
  initialIdr: number;
  riskPerTrade: number;
  stopLoss: number;
  takeProfit: number;
  maxPositions: number;
  minScoreToBuy: number;
  minVolumeIdr: number;
  scanIntervalSec: number;
  feeRate: number;
  maxNotional: number;
  /** @deprecated use tradingMode */
  paperOnly: boolean;
  tradingMode: TradingMode;
  iUnderstandLive: boolean;
  apiKey: string;
  apiSecret: string;
  xaiApiKey: string;
  geminiApiKey: string;
  useGrokAi: boolean;
  scanFocus: ScanFocus;
  dailyLossLimitPct: number;
  playbook: PlaybookId;
  /** Tutup yang tembus SL jika return global ≤ -ini */
  globalStopPct: number;
  /** Jual semua jika return global ≥ ini */
  globalTakePct: number;
  /** 0 = off, 1/2/3 = jam timeout pair tertua */
  timeExitHours: 0 | 1 | 2 | 3;
  /** Satu order = 90% equity (abaikan cap 35%) */
  trade90Pct: boolean;
};

export type BotSummary = {
  cash: number;
  equity: number;
  initial: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openPositions: number;
  returnPct: number;
  tradeCount: number;
  winRate: number;
  maxDrawdown: number;
  dailyLoss: number;
  dailyLossLimit: number;
};

export const HARD_NOTIONAL_CAP = 10_000_000;

export const DEFAULT_SETTINGS: BotSettings = {
  initialIdr: 0,
  riskPerTrade: 0.02,
  stopLoss: 0.018,
  takeProfit: 0.022,
  maxPositions: 2,
  minScoreToBuy: 56,
  minVolumeIdr: 80_000_000,
  scanIntervalSec: 15,
  feeRate: 0.0025,
  maxNotional: 10_000,
  paperOnly: true,
  tradingMode: "paper",
  iUnderstandLive: false,
  apiKey: "",
  apiSecret: "",
  xaiApiKey: "",
  geminiApiKey: "",
  useGrokAi: false,
  scanFocus: "all",
  dailyLossLimitPct: 0.05,
  playbook: "smart",
  globalStopPct: 0.05,
  globalTakePct: 0.05,
  timeExitHours: 0,
  trade90Pct: false,
};

export function timeExitHoursOf(s: {
  timeExitHours?: number;
  timeExit60?: boolean;
}): 0 | 1 | 2 | 3 {
  const h = Math.round(Number(s.timeExitHours));
  if (h === 1 || h === 2 || h === 3) return h;
  if (s.timeExit60 === true) return 1;
  return 0;
}

export function isLiveEnabled(s: BotSettings): boolean {
  return (
    s.tradingMode === "live" &&
    s.iUnderstandLive &&
    s.apiKey.trim().length > 8 &&
    s.apiSecret.trim().length > 8
  );
}
