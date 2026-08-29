"""Indodax public ticker + TAPI (HMAC-SHA512)."""
from __future__ import annotations

import hmac
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

PUBLIC = "https://indodax.com"
TAPI = "https://indodax.com/tapi"
UA = "NeuroTrendAI/1.2-python"

FRACTIONAL = {
    "btc", "eth", "sol", "bnb", "ltc", "bch", "xrp", "ada", "dot", "link",
    "avax", "near", "sui", "ton", "trx", "matic", "pol", "atom", "uni", "apt",
    "arb", "op",
}
PRICE_ROUND = {
    "pepe_idr": 6, "bonk_idr": 6, "shib_idr": 6, "floki_idr": 6, "mog_idr": 6,
    "idx_idr": 4, "bank_idr": 3, "zama_idr": 3,
}


def _get(url: str, timeout: float = 12) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def fetch_tickers() -> dict[str, dict]:
    data = _get(f"{PUBLIC}/api/ticker_all")
    tickers = data.get("tickers") or data
    out: dict[str, dict] = {}
    if isinstance(tickers, dict):
        for k, v in tickers.items():
            if isinstance(v, dict):
                out[str(k).lower()] = v
    return out


def fetch_pairs() -> dict[str, dict]:
    try:
        rows = _get(f"{PUBLIC}/api/pairs")
    except Exception:
        return {}
    out: dict[str, dict] = {}
    if isinstance(rows, list):
        for r in rows:
            if not isinstance(r, dict):
                continue
            pair = str(r.get("ticker_id") or r.get("id") or "").lower()
            if not pair:
                continue
            out[pair] = {
                "price_round": int(r.get("price_round") or PRICE_ROUND.get(pair) or 0),
                "min_base": float(r.get("trade_min_base_currency") or 0),
                "min_idr": float(r.get("trade_min_traded_currency") or 10000),
            }
    return out


def num(x: Any) -> float:
    try:
        n = float(x)
        return n if n == n else 0.0
    except (TypeError, ValueError):
        return 0.0


def coin_of(pair: str) -> str:
    return pair.split("_")[0].lower()


def fmt_price(price: float, pair: str = "") -> str:
    if not (price > 0):
        return "0"
    d = PRICE_ROUND.get(pair, 0)
    if price < 0.01:
        d = max(d, 6)
    elif price < 1:
        d = max(d, 3)
    if d <= 0:
        return str(int(round(price)))
    tick = 10 ** -d
    return f"{round(price / tick) * tick:.{d}f}"


def fmt_qty(qty: float, pair: str) -> str:
    if not (qty > 0):
        return "0"
    base = coin_of(pair)
    if base not in FRACTIONAL:
        whole = int(qty + 1e-12)
        return str(whole) if whole > 0 else "0"
    q = int(qty * 1e8 + 1e-12) / 1e8
    if q <= 0:
        return "0"
    s = f"{q:.8f}".rstrip("0").rstrip(".")
    return s or "0"


def quantize(qty: float, pair: str) -> float:
    try:
        return float(fmt_qty(qty, pair))
    except ValueError:
        return 0.0


class Tapi:
    def __init__(self, key: str, secret: str):
        self.key = (key or "").strip()
        self.secret = (secret or "").strip()

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.key or not self.secret:
            return {"success": 0, "error": "API key kosong"}
        form = {"method": method, "nonce": str(int(time.time() * 1000))}
        for k, v in (params or {}).items():
            if v is None or v == "":
                continue
            form[k] = str(v)
        body = urllib.parse.urlencode(form)
        sign = hmac.new(self.secret.encode(), body.encode(), hashlib.sha512).hexdigest()
        req = urllib.request.Request(
            TAPI,
            data=body.encode(),
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Key": self.key,
                "Sign": sign,
                "User-Agent": UA,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "ignore")
            try:
                return json.loads(raw)
            except Exception:
                return {"success": 0, "error": raw[:180]}
        except Exception as e:
            return {"success": 0, "error": str(e)}

    def get_info(self) -> dict[str, Any]:
        return self.call("getInfo")

    def idr_balance(self) -> float:
        data = self.get_info()
        ret = data.get("return") or {}
        return num((ret.get("balance") or {}).get("idr"))

    def coin_avail(self, coin: str) -> float:
        data = self.get_info()
        ret = data.get("return") or {}
        return num((ret.get("balance") or {}).get(coin.lower()))

    def trade_buy(self, pair: str, price: float, idr: float) -> dict[str, Any]:
        px = num(price)
        qty = quantize(idr / px, pair) if px > 0 else 0
        if qty <= 0:
            return {"success": 0, "error": "qty 0 setelah quantize"}
        if qty * px < 10000:
            return {"success": 0, "error": f"notional < 10rb (qty {qty})"}
        base = coin_of(pair)
        return self.call(
            "trade",
            {
                "pair": pair,
                "type": "buy",
                "order_type": "limit",
                "price": fmt_price(px, pair),
                base: fmt_qty(qty, pair),
            },
        )

    def trade_sell(self, pair: str, price: float, qty: float) -> dict[str, Any]:
        q = quantize(qty, pair)
        if q <= 0:
            return {"success": 0, "error": "qty 0"}
        base = coin_of(pair)
        return self.call(
            "trade",
            {
                "pair": pair,
                "type": "sell",
                "order_type": "limit",
                "price": fmt_price(price, pair),
                base: fmt_qty(q, pair),
            },
        )

    def get_order(self, pair: str, order_id: str) -> dict[str, Any]:
        return self.call("getOrder", {"pair": pair, "order_id": order_id})

    def cancel_order(self, pair: str, order_id: str) -> dict[str, Any]:
        return self.call("cancelOrder", {"pair": pair, "order_id": order_id})

    def wait_fill(self, pair: str, order_id: str, side: str, tries: int = 8) -> tuple[bool, float]:
        filled = 0.0
        for _ in range(tries):
            time.sleep(0.55)
            raw = self.get_order(pair, order_id)
            od = ((raw.get("return") or {}).get("order") or {})
            status = str(od.get("status") or "").lower()
            if side == "buy":
                filled = num(od.get("order_idr") and 0)  # fallback
                remain = num(od.get("remain_" + coin_of(pair)))
                start = num(od.get(coin_of(pair)))
                if start > 0:
                    filled = max(0.0, start - remain)
            else:
                filled = num(od.get("order_" + coin_of(pair)))
            if status in {"filled", "done"}:
                return True, filled
            if status in {"cancelled", "canceled"}:
                return filled > 0, filled
        return filled > 0, filled
