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
  stopLoss: 0.016,
  takeProfit: 0.014,
  maxPositions: 2,
  minScoreToBuy: 64,
  minVolumeIdr: 300_000_000,
  scanIntervalSec: 30,
  feeRate: 0.0025,
  maxNotional: 10_000,
  paperOnly: true,
  tradingMode: "paper",
  iUnderstandLive: false,
  apiKey: "",
  apiSecret: "",
  xaiApiKey: "",
  geminiApiKey: "",
  useGrokAi: true,
  scanFocus: "all",
  dailyLossLimitPct: 0.05,
  playbook: "hybrid",
  globalStopPct: 0.05,
  globalTakePct: 0.05,
};

export function isLiveEnabled(s: BotSettings): boolean {
  return (
    s.tradingMode === "live" &&
    s.iUnderstandLive &&
    s.apiKey.trim().length > 8 &&
    s.apiSecret.trim().length > 8
  );
}
