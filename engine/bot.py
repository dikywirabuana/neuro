"""Python trading engine — source of truth. UI is display + remote control."""
from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from typing import Any

from indodax import Tapi, coin_of, fetch_tickers, fmt_price, num, quantize
from strategy import detect_setup

DATA = os.path.join(os.path.dirname(__file__), "data.json")
FEE = 0.0025


def _now() -> int:
    return int(time.time() * 1000)


class Engine:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.running = False
        self.thread: threading.Thread | None = None
        self.history: dict[str, list[float]] = {}
        self.logs: deque[dict[str, Any]] = deque(maxlen=200)
        self.opps: list[dict[str, Any]] = []
        self.prices: dict[str, float] = {}
        self.bids: dict[str, float] = {}
        self.positions: dict[str, dict[str, Any]] = {}
        self.trades: list[dict[str, Any]] = []
        self.settings: dict[str, Any] = {
            "initialIdr": 0,
            "riskPerTrade": 0.025,
            "stopLoss": 0.016,
            "takeProfit": 0.012,
            "maxPositions": 4,
            "minScoreToBuy": 58,
            "maxNotional": 25000,
            "scanIntervalSec": 15,
            "feeRate": FEE,
            "tradingMode": "paper",
            "apiKey": "",
            "apiSecret": "",
        }
        self.cash = 0.0
        self.initial = 0.0
        self.last_scan = 0
        self.error: str | None = None
        self.sl_hits: dict[str, int] = {}
        self._load()

    def log(self, text: str, kind: str = "info") -> None:
        self.logs.appendleft({"ts": _now(), "text": text, "kind": kind})

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            prices = dict(self.prices)
            pos = {k: dict(v) for k, v in self.positions.items()}
            eq = self._equity(prices)
            unreal = eq - self.cash
            realized = sum(t.get("pnl", 0) for t in self.trades if t.get("side") == "SELL")
            ret = ((eq - self.initial) / self.initial * 100) if self.initial > 0 else 0
            sells = [t for t in self.trades if t.get("side") == "SELL"]
            wins = sum(1 for t in sells if t.get("pnl", 0) > 0)
            return {
                "ok": True,
                "engine": "python",
                "running": self.running,
                "error": self.error,
                "lastScanAt": self.last_scan,
                "source": "live" if prices else "idle",
                "settings": {k: v for k, v in self.settings.items() if k not in ("apiKey", "apiSecret")},
                "live": self.settings.get("tradingMode") == "live",
                "cash": round(self.cash, 2),
                "positions": pos,
                "opportunities": list(self.opps)[:20],
                "prices": prices,
                "trades": list(self.trades)[-80:],
                "logs": list(self.logs)[:80],
                "summary": {
                    "cash": round(self.cash, 2),
                    "equity": round(eq, 2),
                    "initial": self.initial,
                    "realizedPnl": round(realized, 2),
                    "unrealizedPnl": round(unreal, 2),
                    "openPositions": len(pos),
                    "returnPct": round(ret, 2),
                    "tradeCount": len(self.trades),
                    "winRate": round(wins / len(sells) * 100, 1) if sells else 0,
                    "dailyLoss": 0,
                    "dailyLossLimit": self.initial * 0.08,
                    "maxDrawdown": 0,
                },
            }

    def apply_settings(self, s: dict[str, Any]) -> None:
        with self.lock:
            for k, v in s.items():
                if k in self.settings or k in ("apiKey", "apiSecret", "tradingMode", "iUnderstandLive"):
                    self.settings[k] = v
            cap = float(self.settings.get("initialIdr") or 0)
            if cap >= 10000 and self.cash <= 0:
                self.cash = cap
                self.initial = cap
            self._save()

    def start(self) -> dict[str, Any]:
        with self.lock:
            if float(self.settings.get("initialIdr") or 0) < 10000:
                return {"ok": False, "error": "Isi modal dulu"}
            if self.cash <= 0:
                self.cash = float(self.settings["initialIdr"])
                self.initial = self.cash
            if self.running:
                return {"ok": True, "running": True}
            self.running = True
            self.error = None
            self.thread = threading.Thread(target=self._loop, daemon=True)
            self.thread.start()
            self.log("Python engine START", "ai")
            return {"ok": True, "running": True}

    def stop(self) -> dict[str, Any]:
        with self.lock:
            self.running = False
            self.log("Python engine STOP")
            return {"ok": True, "running": False}

    def sell_pair(self, pair: str) -> dict[str, Any]:
        with self.lock:
            pos = self.positions.get(pair)
            if not pos:
                return {"ok": False, "error": "posisi tidak ada"}
            px = self.bids.get(pair) or self.prices.get(pair) or pos["entryPrice"]
            return self._close(pair, px, "MANUAL")

    def sell_all(self) -> dict[str, Any]:
        n = 0
        with self.lock:
            for pair in list(self.positions):
                px = self.bids.get(pair) or self.prices.get(pair) or self.positions[pair]["entryPrice"]
                if self._close(pair, px, "SELL_ALL").get("ok"):
                    n += 1
        return {"ok": True, "closed": n}

    def _equity(self, prices: dict[str, float]) -> float:
        eq = self.cash
        for p, pos in self.positions.items():
            px = prices.get(p) or pos["entryPrice"]
            eq += pos["qty"] * px
        return eq

    def _loop(self) -> None:
        while True:
            with self.lock:
                if not self.running:
                    return
                interval = max(15, int(self.settings.get("scanIntervalSec") or 15))
            try:
                self._tick()
            except Exception as e:
                with self.lock:
                    self.error = str(e)
                    self.log(f"Engine error: {e}", "error")
            time.sleep(interval)

    def _tick(self) -> None:
        tickers = fetch_tickers()
        prices: dict[str, float] = {}
        bids: dict[str, float] = {}
        opps: list[dict[str, Any]] = []
        for pair, t in tickers.items():
            if not pair.endswith("_idr"):
                continue
            last = num(t.get("last"))
            high = num(t.get("high"))
            low = num(t.get("low"))
            buy = num(t.get("buy"))
            sell = num(t.get("sell"))
            vol = num(t.get("vol_idr"))
            if last <= 0 or high < low:
                continue
            prices[pair] = last
            bids[pair] = buy if buy > 0 else last
            mid = (buy + sell) / 2 if buy > 0 and sell > 0 else last
            spread = ((sell - buy) / mid * 100) if mid > 0 and sell >= buy else 5
            if spread > 1.4:
                continue
            hist = self.history.get(pair, [])
            if not hist or abs(hist[-1] - last) / hist[-1] > 0.0002:
                hist = (hist + [last])[-40:]
                self.history[pair] = hist
            setup = detect_setup(hist, last, high, low, spread, vol)
            range_pos = (last - low) / (high - low) if high > low else 0.5
            opps.append({
                "pair": pair,
                "price": last,
                "buy": buy,
                "sell": sell,
                "high": high,
                "low": low,
                "volumeIdr": vol,
                "rangePos": round(range_pos, 3),
                "spreadPct": round(spread, 3),
                "score": setup["score"],
                "signal": setup["signal"],
                "tag": setup["kind"],
                "setup": setup["kind"],
                "setupReason": setup["reason"],
                "setupStopPct": setup["stopPct"],
                "setupTpPct": setup["tpPct"],
                "setupDumpLow": setup["dumpLow"],
            })
        opps.sort(key=lambda o: o["score"], reverse=True)

        with self.lock:
            self.prices = prices
            self.bids = bids
            self.opps = opps[:20]
            self.last_scan = _now()
            self._exits()
            self._entries(opps[:12])
            self._save()

    def _exits(self) -> None:
        fee = float(self.settings.get("feeRate") or FEE)
        for pair, pos in list(self.positions.items()):
            last = self.prices.get(pair)
            if not last:
                continue
            bid = self.bids.get(pair) or last
            sl = pos["stopLoss"]
            if pos.get("setupLow"):
                sl = min(sl, pos["setupLow"] * 0.995)
            tp = pos["takeProfit"]
            held = (_now() - pos["entryTime"]) / 60000
            proceeds = bid * pos["qty"] * (1 - fee)
            net = (proceeds - pos["costIdr"]) / pos["costIdr"] * 100 if pos["costIdr"] else 0
            shadow = last <= sl < bid
            if shadow:
                self.sl_hits[pair] = 0
                reason = None
            elif held >= 2.5 and bid <= sl:
                self.sl_hits[pair] = self.sl_hits.get(pair, 0) + 1
                reason = "STOP_LOSS" if self.sl_hits[pair] >= 2 else None
            else:
                self.sl_hits[pair] = 0
                reason = None
            if not reason and (net >= 0.8 or bid >= tp):
                reason = "TAKE_PROFIT"
            elif not reason and held >= 8 and net >= 0.45:
                reason = "LOCK_GREEN"
            if reason:
                self._close(pair, bid, reason)

    def _entries(self, opps: list[dict[str, Any]]) -> None:
        live = self.settings.get("tradingMode") == "live"
        max_pos = int(self.settings.get("maxPositions") or 4)
        min_score = int(self.settings.get("minScoreToBuy") or 58)
        if len(self.positions) >= max_pos:
            return
        for row in opps:
            if len(self.positions) >= max_pos:
                return
            pair = row["pair"]
            if pair in self.positions:
                continue
            if row.get("setup") not in ("BOUNCE", "PULLBACK"):
                continue
            if row["score"] < min_score:
                continue
            if row["signal"] not in ("BUY", "STRONG_BUY"):
                continue
            self._open(row, live)

    def _size(self) -> float:
        eq = self._equity(self.prices)
        sl = float(self.settings.get("stopLoss") or 0.016)
        risk = float(self.settings.get("riskPerTrade") or 0.025)
        cap = float(self.settings.get("maxNotional") or 25000)
        hard = max(10000, self.initial * 0.25) if self.initial else cap
        size = (eq * risk / sl) if sl > 0 else cap
        return max(10000, min(size, eq * 0.3, cap, hard, self.cash * 0.95))

    def _open(self, row: dict[str, Any], live: bool) -> None:
        pair = row["pair"]
        px = row["price"]
        size = self._size()
        if size < 10000:
            return
        qty = quantize(size / px, pair)
        if qty <= 0:
            return
        spend = qty * px * (1 + FEE)
        if spend > self.cash:
            return
        fill = px
        if live:
            tapi = Tapi(self.settings.get("apiKey", ""), self.settings.get("apiSecret", ""))
            raw = tapi.trade_buy(pair, px, size)
            if str(raw.get("success")) not in {"1", "1.0"} and raw.get("success") != 1:
                self.log(f"LIVE BUY gagal {pair}: {raw.get('error')}", "error")
                return
            oid = str(((raw.get("return") or {}).get("order_id")) or "")
            ok, _ = tapi.wait_fill(pair, oid, "buy") if oid else (False, 0)
            if not ok:
                if oid:
                    tapi.cancel_order(pair, oid)
                self.log(f"LIVE BUY {pair} belum fill — batal", "error")
                return
            avail = tapi.coin_avail(coin_of(pair))
            qty = quantize(avail, pair) if avail > 0 else qty
            fill = px
            self.log(f"LIVE BUY FILLED {pair} qty={qty} @ {fmt_price(fill, pair)}", "entry")
        else:
            self.log(f"PAPER BUY {pair} qty={qty} @ {fmt_price(px, pair)}", "entry")
        self.cash -= spend
        slp = float(row.get("setupStopPct") or 0.016)
        tpp = float(row.get("setupTpPct") or 0.012)
        self.positions[pair] = {
            "pair": pair,
            "qty": qty,
            "entryPrice": fill,
            "entryTime": _now(),
            "stopLoss": fill * (1 - slp),
            "takeProfit": fill * (1 + FEE * 2 + tpp),
            "costIdr": spend,
            "peakPrice": fill,
            "setup": row.get("setup"),
            "setupLow": row.get("setupDumpLow"),
        }
        self.trades.append({
            "id": f"{_now()}-{pair}",
            "ts": _now(),
            "pair": pair,
            "side": "BUY",
            "price": fill,
            "qty": qty,
            "notional": qty * fill,
            "fee": qty * fill * FEE,
            "reason": f"{row.get('setup')}:{row.get('score')}",
            "pnl": 0,
        })

    def _close(self, pair: str, px: float, reason: str) -> dict[str, Any]:
        pos = self.positions.get(pair)
        if not pos:
            return {"ok": False}
        live = self.settings.get("tradingMode") == "live"
        qty = quantize(pos["qty"], pair)
        if live:
            tapi = Tapi(self.settings.get("apiKey", ""), self.settings.get("apiSecret", ""))
            avail = tapi.coin_avail(coin_of(pair))
            if avail > 0:
                qty = quantize(min(qty, avail), pair)
            raw = tapi.trade_sell(pair, px, qty)
            if str(raw.get("success")) not in {"1", "1.0"} and raw.get("success") != 1:
                self.log(f"LIVE SELL gagal {pair}: {raw.get('error')}", "error")
                return {"ok": False, "error": raw.get("error")}
            self.log(f"LIVE SELL {reason} {pair}", "exit")
        fee = qty * px * FEE
        proceeds = qty * px - fee
        pnl = proceeds - pos["costIdr"]
        self.cash += proceeds
        del self.positions[pair]
        self.sl_hits.pop(pair, None)
        self.trades.append({
            "id": f"{_now()}-x-{pair}",
            "ts": _now(),
            "pair": pair,
            "side": "SELL",
            "price": px,
            "qty": qty,
            "notional": qty * px,
            "fee": fee,
            "reason": reason,
            "pnl": round(pnl, 2),
        })
        self.log(f"EXIT {pair} {reason} PnL {round(pnl):,}", "exit")
        return {"ok": True, "pnl": pnl}

    def _save(self) -> None:
        try:
            blob = {
                "cash": self.cash,
                "initial": self.initial,
                "positions": self.positions,
                "trades": self.trades[-100:],
                "settings": {k: v for k, v in self.settings.items() if k not in ("apiKey", "apiSecret")},
            }
            with open(DATA, "w", encoding="utf-8") as f:
                json.dump(blob, f)
        except Exception:
            pass

    def _load(self) -> None:
        if not os.path.isfile(DATA):
            return
        try:
            with open(DATA, encoding="utf-8") as f:
                blob = json.load(f)
            self.cash = float(blob.get("cash") or 0)
            self.initial = float(blob.get("initial") or 0)
            self.positions = blob.get("positions") or {}
            self.trades = blob.get("trades") or []
            self.settings.update(blob.get("settings") or {})
        except Exception:
            pass


ENGINE = Engine()
