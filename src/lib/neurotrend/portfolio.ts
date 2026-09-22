import { getPairLimits, quantizeBaseQty } from "./indodax-private";
import {
  canOpen,
  dailyLossFromTrades,
  feeOf,
  maxDrawdownPct,
  positionSizeIdr,
  stopPrice,
  takeProfitPrice,
} from "./risk";
import type {
  BotSettings,
  BotSummary,
  EquityPoint,
  Position,
  Trade,
} from "./types";
import { timeExitHoursOf } from "./types";

export type PendingExit = {
  pair: string;
  reason: string;
  sellPx: number;
  qty: number;
};

const SLIPPAGE = 0.001;

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PaperPortfolio {
  cash: number;
  initialIdr: number;
  positions: Record<string, Position> = {};
  trades: Trade[] = [];
  equityHistory: EquityPoint[] = [];

  constructor(initialIdr: number) {
    this.initialIdr = initialIdr;
    this.cash = initialIdr;
  }

  static fromJSON(data: {
    cash: number;
    initialIdr: number;
    positions: Record<string, Position>;
    trades: Trade[];
    equityHistory: EquityPoint[];
  }): PaperPortfolio {
    const p = new PaperPortfolio(data.initialIdr);
    p.cash = data.cash;
    p.positions = data.positions ?? {};
    p.trades = data.trades ?? [];
    p.equityHistory = data.equityHistory ?? [];
    return p;
  }

  toJSON() {
    return {
      cash: this.cash,
      initialIdr: this.initialIdr,
      positions: this.positions,
      trades: this.trades,
      equityHistory: this.equityHistory,
    };
  }

  openCount(): number {
    return Object.keys(this.positions).length;
  }

  has(pair: string): boolean {
    return Boolean(this.positions[pair]);
  }

  equity(prices: Record<string, number>): number {
    let eq = this.cash;
    for (const pos of Object.values(this.positions)) {
      const px = prices[pos.pair] ?? pos.entryPrice;
      eq += pos.qty * px;
    }
    return eq;
  }

  unrealized(prices: Record<string, number>): number {
    let u = 0;
    for (const pos of Object.values(this.positions)) {
      const px = prices[pos.pair] ?? pos.entryPrice;
      u += pos.qty * px - pos.costIdr;
    }
    return u;
  }

  realizedPnl(): number {
    return this.trades
      .filter((t) => t.side === "SELL")
      .reduce((s, t) => s + t.pnl, 0);
  }

  dailyLoss(): number {
    return dailyLossFromTrades(this.trades);
  }

  openLong(
    pair: string,
    lastPrice: number,
    score: number,
    reason: string,
    settings: BotSettings,
    extras?: {
      stopPct?: number;
      tpPct?: number;
      setup?: Position["setup"];
      holdMin?: number;
      setupLow?: number;
      tpMid?: number;
      tpUpper?: number;
    },
  ): Trade | null {
    if (lastPrice <= 0) return null;
    const prices: Record<string, number> = { [pair]: lastPrice };
    const eq = this.equity(prices);
    if (
      !canOpen(this.openCount(), eq, score, settings, pair, {
        cash: this.cash,
        dailyLoss: this.dailyLoss(),
      })
    ) {
      return null;
    }

    let sizeIdr = positionSizeIdr(eq, settings, pair);
    sizeIdr = Math.min(sizeIdr, this.cash * 0.95);
    if (sizeIdr < 10_000) return null;

    const fill = lastPrice * (1 + SLIPPAGE);
    let fee = feeOf(sizeIdr, settings);
    let spend = sizeIdr + fee;
    if (spend > this.cash) {
      spend = this.cash;
      sizeIdr = spend / (1 + settings.feeRate);
      fee = spend - sizeIdr;
    }
    if (sizeIdr < 10_000) return null;

    const qty = quantizeBaseQty(sizeIdr / fill, pair);
    if (qty <= 0) return null;
    const minBase = getPairLimits(pair).minBase;
    if (minBase > 0 && qty < minBase) return null;
    sizeIdr = qty * fill;
    fee = feeOf(sizeIdr, settings);
    spend = sizeIdr + fee;
    if (spend > this.cash) return null;

    this.cash -= spend;
    this.positions[pair] = {
      pair,
      qty,
      entryPrice: fill,
      entryTime: Date.now(),
      stopLoss: extras?.stopPct
        ? fill * (1 - extras.stopPct)
        : stopPrice(fill, settings, pair),
      takeProfit: extras?.tpMid
        ? extras.tpMid
        : extras?.tpPct
        ? fill * (1 + extras.tpPct)
        : takeProfitPrice(fill, settings, pair),
      costIdr: spend,
      peakPrice: fill,
      setup: extras?.setup,
      setupHoldMin: extras?.holdMin ?? 12,
      setupLow: extras?.setupLow,
      slHits: 0,
      tpMid: extras?.tpMid,
      tpUpper: extras?.tpUpper,
      partialTaken: false,
    };

    const trade: Trade = {
      id: uid(),
      ts: Date.now(),
      pair,
      side: "BUY",
      price: fill,
      qty,
      notional: sizeIdr,
      fee,
      reason,
      pnl: 0,
    };
    this.trades.push(trade);
    return trade;
  }

  /** LIVE: catat posisi dari qty yang benar-benar terisi di Indodax. */
  openFilledLong(
    pair: string,
    fillPrice: number,
    qty: number,
    settings: BotSettings,
    reason: string,
    extras?: {
      stopPct?: number;
      tpPct?: number;
      setup?: Position["setup"];
      holdMin?: number;
      setupLow?: number;
      skipCash?: boolean;
      tpMid?: number;
      tpUpper?: number;
    },
  ): Trade | null {
    if (!(fillPrice > 0) || !(qty > 0)) return null;
    const sizeIdr = qty * fillPrice;
    const fee = feeOf(sizeIdr, settings);
    const spend = sizeIdr + fee;
    if (!extras?.skipCash && this.cash >= spend) this.cash -= spend;
    this.positions[pair] = {
      pair,
      qty,
      entryPrice: fillPrice,
      entryTime: Date.now(),
      stopLoss: extras?.stopPct
        ? fillPrice * (1 - extras.stopPct)
        : stopPrice(fillPrice, settings, pair),
      takeProfit: extras?.tpMid
        ? extras.tpMid
        : extras?.tpPct
        ? fillPrice * (1 + extras.tpPct)
        : takeProfitPrice(fillPrice, settings, pair),
      costIdr: spend,
      peakPrice: fillPrice,
      setup: extras?.setup,
      setupHoldMin: extras?.holdMin ?? 12,
      setupLow: extras?.setupLow,
      slHits: 0,
      tpMid: extras?.tpMid,
      tpUpper: extras?.tpUpper,
      partialTaken: false,
    };
    const trade: Trade = {
      id: uid(),
      ts: Date.now(),
      pair,
      side: "BUY",
      price: fillPrice,
      qty,
      notional: sizeIdr,
      fee,
      reason,
      pnl: 0,
    };
    this.trades.push(trade);
    return trade;
  }

  addToLong(
    pair: string,
    fillPrice: number,
    qty: number,
    settings: BotSettings,
    reason: string,
    extras?: { stopPct?: number; tpPct?: number; skipCash?: boolean },
  ): Trade | null {
    const pos = this.positions[pair];
    if (!pos) {
      return this.openFilledLong(pair, fillPrice, qty, settings, reason, {
        setup: "GRID",
        stopPct: extras?.stopPct,
        tpPct: extras?.tpPct,
        holdMin: 6,
        skipCash: extras?.skipCash,
      });
    }
    if (!(fillPrice > 0) || !(qty > 0)) return null;
    const sizeIdr = qty * fillPrice;
    const fee = feeOf(sizeIdr, settings);
    const spend = sizeIdr + fee;
    if (!extras?.skipCash && this.cash >= spend) this.cash -= spend;
    const newQty = pos.qty + qty;
    const newCost = pos.costIdr + spend;
    pos.qty = newQty;
    pos.costIdr = newCost;
    pos.entryPrice = (pos.entryPrice * (newQty - qty) + fillPrice * qty) / newQty;
    pos.setup = "GRID";
    if (extras?.tpPct) {
      pos.takeProfit = pos.entryPrice * (1 + extras.tpPct);
    }
    if (extras?.stopPct) pos.stopLoss = pos.entryPrice * (1 - extras.stopPct);
    pos.peakPrice = Math.max(pos.peakPrice ?? fillPrice, fillPrice);
    const trade: Trade = {
      id: uid(),
      ts: Date.now(),
      pair,
      side: "BUY",
      price: fillPrice,
      qty,
      notional: sizeIdr,
      fee,
      reason,
      pnl: 0,
    };
    this.trades.push(trade);
    return trade;
  }

  syncCash(realIdr: number): void {
    if (Number.isFinite(realIdr) && realIdr >= 0) this.cash = realIdr;
  }

  closePosition(
    pair: string,
    bidPrice: number,
    reason: string,
    settings: BotSettings,
  ): Trade | null {
    const pos = this.positions[pair];
    if (!pos || bidPrice <= 0) return null;

    const fill = bidPrice * (1 - SLIPPAGE);
    const sellQty = quantizeBaseQty(pos.qty, pair);
    const qty = sellQty > 0 ? sellQty : pos.qty;
    const notional = qty * fill;
    const fee = feeOf(notional, settings);
    const proceeds = notional - fee;
    const pnl = proceeds - pos.costIdr;

    this.cash += proceeds;
    delete this.positions[pair];

    const trade: Trade = {
      id: uid(),
      ts: Date.now(),
      pair,
      side: "SELL",
      price: fill,
      qty,
      notional,
      fee,
      reason,
      pnl: Math.round(pnl * 100) / 100,
    };
    this.trades.push(trade);
    return trade;
  }

  closePartial(
    pair: string,
    qtyWanted: number,
    bidPrice: number,
    reason: string,
    settings: BotSettings,
  ): Trade | null {
    const pos = this.positions[pair];
    if (!pos || bidPrice <= 0 || !(qtyWanted > 0)) return null;
    const q = quantizeBaseQty(Math.min(qtyWanted, pos.qty), pair);
    if (!(q > 0)) return null;
    if (q >= pos.qty * 0.995) {
      return this.closePosition(pair, bidPrice, reason, settings);
    }
    const fill = bidPrice * (1 - SLIPPAGE);
    const notional = q * fill;
    const fee = feeOf(notional, settings);
    const proceeds = notional - fee;
    const costShare = pos.costIdr * (q / pos.qty);
    const pnl = proceeds - costShare;
    this.cash += proceeds;
    pos.qty = quantizeBaseQty(pos.qty - q, pair);
    pos.costIdr = Math.max(0, pos.costIdr - costShare);
    if (!(pos.qty > 0)) {
      delete this.positions[pair];
    }
    const trade: Trade = {
      id: uid(),
      ts: Date.now(),
      pair,
      side: "SELL",
      price: fill,
      qty: q,
      notional,
      fee,
      reason,
      pnl: Math.round(pnl * 100) / 100,
    };
    this.trades.push(trade);
    return trade;
  }

  /** Batalkan BUY yang live-nya gagal — kembalikan cash, jangan catat SELL palsu. */
  revertOpen(pair: string): boolean {
    const pos = this.positions[pair];
    if (!pos) return false;
    this.cash += pos.costIdr;
    delete this.positions[pair];
    const lastBuy = [...this.trades]
      .reverse()
      .find((t) => t.pair === pair && t.side === "BUY");
    if (lastBuy) {
      this.trades = this.trades.filter((t) => t.id !== lastBuy.id);
    }
    return true;
  }

  /** Tutup posisi lokal tanpa menambah cash — sudah terjual di exchange. */
  forgetPosition(pair: string, mark: number, reason: string): Trade | null {
    const pos = this.positions[pair];
    if (!pos) return null;
    const px = mark > 0 ? mark : pos.entryPrice;
    const notional = pos.qty * px;
    const pnl = notional - pos.costIdr;
    delete this.positions[pair];
    const trade: Trade = {
      id: uid(),
      ts: Date.now(),
      pair,
      side: "SELL",
      price: px,
      qty: pos.qty,
      notional,
      fee: 0,
      reason,
      pnl: Math.round(pnl * 100) / 100,
    };
    this.trades.push(trade);
    return trade;
  }

  /** Samakan qty posisi dengan saldo wallet (jual di luar bot). */
  syncQtyFromExchange(pair: string, qty: number, mark: number): Trade | null {
    const pos = this.positions[pair];
    if (!pos) return null;
    const q = quantizeBaseQty(qty, pair);
    if (!(q > 0)) return this.forgetPosition(pair, mark, "SYNC_SOLD");
    if (q >= pos.qty * 0.97) return null;
    const sold = pos.qty - q;
    const px = mark > 0 ? mark : pos.entryPrice;
    const costShare = pos.costIdr * (sold / pos.qty);
    pos.qty = q;
    pos.costIdr = Math.max(0, pos.costIdr - costShare);
    const trade: Trade = {
      id: uid(),
      ts: Date.now(),
      pair,
      side: "SELL",
      price: px,
      qty: sold,
      notional: sold * px,
      fee: 0,
      reason: "SYNC_PARTIAL",
      pnl: Math.round((sold * px - costShare) * 100) / 100,
    };
    this.trades.push(trade);
    return trade;
  }

  pendingExits(
    prices: Record<string, number>,
    _settings: BotSettings,
    bids?: Record<string, number>,
    gridAdds?: Record<string, number>,
  ): PendingExit[] {
    const out: PendingExit[] = [];
    const equity = this.equity(prices);
    const initial = this.initialIdr >= 10_000 ? this.initialIdr : 0;
    const globalPct = initial > 0 ? ((equity - initial) / initial) * 100 : 0;
    const lossCut = Math.max(2, (_settings.globalStopPct || 0.05) * 100);
    const winLock = Math.max(2, (_settings.globalTakePct || 0.05) * 100);
    const circuitOk = initial >= 10_000;
    const circuitLoss = circuitOk && globalPct <= -lossCut;
    const circuitWin = circuitOk && globalPct >= winLock;

    const feeRate = _settings.feeRate || 0.0025;
    let netUnreal = 0;
    for (const pos of Object.values(this.positions)) {
      const last = prices[pos.pair];
      if (!(last > 0)) continue;
      const bid = bids?.[pos.pair] && bids[pos.pair] > 0 ? bids[pos.pair] : last;
      netUnreal += bid * pos.qty * (1 - feeRate) - pos.costIdr;
    }
    const lockEq = equity > 0 && netUnreal >= equity * 0.02;

    if (lockEq) {
      for (const pair of Object.keys(this.positions)) {
        const pos = this.positions[pair];
        if (!pos) continue;
        const heldSec = (Date.now() - pos.entryTime) / 1000;
        if (heldSec < 45) continue;
        const last = prices[pair];
        if (!(last > 0)) continue;
        const bid = bids?.[pair] && bids[pair] > 0 ? bids[pair] : last;
        out.push({ pair, reason: "LOCK_EQ_2", sellPx: bid, qty: pos.qty });
      }
      if (out.length) return out;
    }

    const exitHours = timeExitHoursOf(_settings);
    const timedPair =
      exitHours > 0
        ? Object.values(this.positions)
            .filter((p) => p.setup !== "GRID")
            .slice()
            .sort((a, b) => a.entryTime - b.entryTime)[0]?.pair
        : undefined;

    for (const pair of Object.keys(this.positions)) {
      const pos = this.positions[pair];
      if (!pos) continue;
      const last = prices[pair];
      if (last == null || last <= 0) continue;
      const bid = bids?.[pair] && bids[pair] > 0 ? bids[pair] : last;
      const mark = Math.min(bid, last);
      pos.peakPrice = Math.max(pos.peakPrice ?? pos.entryPrice, last);

      const hardSl = pos.stopLoss > 0 ? pos.stopLoss : pos.entryPrice * 0.982;
      let sl = hardSl;
      if (pos.setupLow && pos.setupLow > 0) {
        const struct = pos.setupLow * 0.995;
        if (struct > hardSl && struct < pos.entryPrice) sl = struct;
      }

      const tp = pos.takeProfit;
      const heldMin = (Date.now() - pos.entryTime) / 60_000;
      const heldSec = heldMin * 60;
      const proceeds = mark * pos.qty * (1 - feeRate);
      const netPct =
        pos.costIdr > 0 ? ((proceeds - pos.costIdr) / pos.costIdr) * 100 : 0;
      const hardLossPct = Math.max(
        1.8,
        ((pos.entryPrice - hardSl) / pos.entryPrice) * 100,
      );
      const peakGrossPct =
        pos.entryPrice > 0
          ? ((pos.peakPrice ?? pos.entryPrice) / pos.entryPrice - 1) * 100
          : 0;
      const retraceFromPeakPct =
        (pos.peakPrice ?? 0) > 0
          ? (((pos.peakPrice ?? mark) - mark) / (pos.peakPrice ?? mark)) * 100
          : 0;
      let reason: string | null = null;

      const through = mark <= sl;
      const crash = netPct <= -Math.max(3.5, hardLossPct);
      const deep = crash || last <= sl * 0.994 || mark <= sl * 0.997;

      if (
        exitHours > 0 &&
        pair === timedPair &&
        heldMin >= exitHours * 60 &&
        pos.setup !== "GRID"
      ) {
        if (netPct >= 0.7) {
          out.push({
            pair,
            reason: `TIME_${exitHours}H`,
            sellPx: bid,
            qty: pos.qty,
          });
        }
        continue;
      }

      if (pos.setup === "GRID") {
        const tpLevel =
          tp > 0 ? tp : pos.entryPrice * (1 + Math.max(0.01, _settings.takeProfit || 0.014));
        const tpHit = bid >= tpLevel && netPct >= 0.2;
        const adds = Math.max(1, gridAdds?.[pair] || 1);
        if (tpHit && heldSec >= 5) {
          const lotQty = pos.qty / adds;
          out.push({
            pair,
            reason: "GRID_TP",
            sellPx: bid,
            qty: lotQty,
          });
          continue;
        }
        if (heldSec < 25 && !crash) {
          pos.slHits = 0;
          continue;
        }
        if (deep || through) {
          out.push({
            pair,
            reason: "STOP_LOSS",
            sellPx: mark,
            qty: pos.qty,
          });
        }
        continue;
      }

      // Lot baru: SL jangan kena shadow. TP boleh cepat.
      if (heldSec < 45 && !crash) {
        pos.slHits = 0;
        if (!(netPct >= 0.7 && bid >= tp && heldSec >= 5)) continue;
      }

      if (circuitWin && netPct >= 0.6 && heldMin >= 2) {
        reason = "LOCK_GLOBAL_5";
      } else if (deep) {
        reason = "STOP_LOSS";
        pos.slHits = 0;
      } else if (through && heldMin >= 1.5) {
        pos.slHits = (pos.slHits ?? 0) + 1;
        if ((pos.slHits ?? 0) >= 2) reason = "STOP_LOSS";
      } else {
        pos.slHits = 0;
      }

      if (!reason && circuitLoss && through && heldMin >= 2) {
        reason = "CIRCUIT_SL";
      }

      if (!reason && netPct >= 0.7 && bid >= tp) {
        reason = "TAKE_PROFIT";
      } else if (
        !reason &&
        heldMin >= 3 &&
        peakGrossPct >= 1.35 &&
        retraceFromPeakPct >= 0.55 &&
        netPct >= 0.5
      ) {
        reason = "TRAIL_GREEN";
      } else if (!reason && heldMin >= 12 && netPct >= 0.7) {
        reason = "LOCK_GREEN";
      }
      if (!reason) continue;
      out.push({
        pair,
        reason,
        sellPx:
          reason === "STOP_LOSS" || reason === "CIRCUIT_SL"
            ? mark * 0.996
            : bid,
        qty: pos.qty,
      });
    }
    return out;
  }

  checkExits(
    prices: Record<string, number>,
    settings: BotSettings,
    bids?: Record<string, number>,
  ): Trade[] {
    const closed: Trade[] = [];
    for (const ex of this.pendingExits(prices, settings, bids)) {
      const t = this.closePosition(ex.pair, ex.sellPx, ex.reason, settings);
      if (t) closed.push(t);
    }
    return closed;
  }

  markToMarket(prices: Record<string, number>): void {
    const eq = this.equity(prices);
    const last = this.equityHistory[this.equityHistory.length - 1];
    const now = Date.now();
    if (!last || now - last.ts >= 5_000) {
      this.equityHistory.push({ ts: now, equity: eq, cash: this.cash });
      if (this.equityHistory.length > 500) {
        this.equityHistory = this.equityHistory.slice(-400);
      }
    } else {
      last.equity = eq;
      last.cash = this.cash;
      last.ts = now;
    }
  }

  summary(prices: Record<string, number>): BotSummary {
    const equity = this.equity(prices);
    const unrealizedPnl = this.unrealized(prices);
    const realizedPnl = this.realizedPnl();
    const initial = this.initialIdr >= 10_000 ? this.initialIdr : 0;
    const sells = this.trades.filter((t) => t.side === "SELL");
    const wins = sells.filter((t) => t.pnl > 0).length;
    const curve = this.equityHistory.map((p) => p.equity);
    if (!curve.length) curve.push(equity);
    const limitPct = 0.05;
    return {
      cash: this.cash,
      equity,
      initial: this.initialIdr,
      realizedPnl,
      unrealizedPnl,
      openPositions: this.openCount(),
      returnPct: initial > 0 ? ((equity - initial) / initial) * 100 : 0,
      tradeCount: this.trades.length,
      winRate: sells.length ? (wins / sells.length) * 100 : 0,
      maxDrawdown: maxDrawdownPct(curve),
      dailyLoss: this.dailyLoss(),
      dailyLossLimit: this.initialIdr * limitPct,
    };
  }

  reset(initialIdr?: number): void {
    if (initialIdr != null && initialIdr > 0) this.initialIdr = initialIdr;
    this.cash = this.initialIdr;
    this.positions = {};
    this.trades = [];
    this.equityHistory = [];
  }
}
