"""BOUNCE / PULLBACK setups — same idea as the web brain."""
from __future__ import annotations

from typing import Any


def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    gain = loss = 0.0
    for i in range(len(closes) - period, len(closes)):
        d = closes[i] - closes[i - 1]
        if d >= 0:
            gain += d
        else:
            loss -= d
    avg_g = gain / period
    avg_l = loss / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100 - 100 / (1 + rs)


def ema(series: list[float], span: int) -> float | None:
    if len(series) < span:
        return None
    k = 2 / (span + 1)
    e = series[0]
    for x in series[1:]:
        e = x * k + e * (1 - k)
    return e


def detect_setup(closes: list[float], last: float, high: float, low: float, spread: float, vol: float) -> dict[str, Any]:
    px = last if last > 0 else (closes[-1] if closes else 0)
    none = {
        "kind": "NONE",
        "score": 28,
        "signal": "HOLD",
        "reason": "tidak ada setup",
        "stopPct": 0.016,
        "tpPct": 0.012,
        "dumpLow": px,
    }
    if not (px > 0):
        none["reason"] = "harga invalid"
        return none
    if vol < 250_000_000:
        none["reason"] = "volume tipis"
        return none
    if spread > 0.85:
        none["reason"] = f"spread {spread:.2f}%"
        return none

    series = closes[-20:] + ([px] if not closes or closes[-1] != px else [])
    if len(series) < 4:
        series = [low or px, px, high or px]
    window = series[-20:]
    peak = max(window)
    trough = min(window)
    r = rsi(series, min(14, max(5, len(series) - 1)))
    e = ema(series, min(12, len(window)))

    bounce = _bounce(window, px, peak, trough, r, spread, vol, high, low)
    pull = _pullback(window, px, peak, trough, r, e, spread, vol)
    if bounce["kind"] != "NONE" and bounce["score"] >= pull["score"]:
        return bounce
    if pull["kind"] != "NONE":
        return pull
    if bounce["kind"] != "NONE":
        return bounce
    return none


def _bounce(window, px, peak, trough, rsi_v, spread, vol, high, low):
    dump = ((peak - trough) / peak * 100) if peak > 0 else 0
    off = ((px - trough) / trough * 100) if trough > 0 else 0
    prev = window[-2] if len(window) >= 2 else px
    recovering = px > prev and px > trough * 1.001
    day_pos = (px - low) / (high - low) if high > low else 0.5
    if dump < 1.15 or dump > 7:
        return {"kind": "NONE", "score": 20, "signal": "HOLD", "reason": "bukan panik", "stopPct": 0.016, "tpPct": 0.012, "dumpLow": trough}
    if not recovering:
        return {"kind": "NONE", "score": 22, "signal": "HOLD", "reason": "belum reversal", "stopPct": 0.016, "tpPct": 0.012, "dumpLow": trough}
    if off < 0.12 or off > 2.0:
        return {"kind": "NONE", "score": 24, "signal": "HOLD", "reason": "bounce tidak pas", "stopPct": 0.016, "tpPct": 0.012, "dumpLow": trough}
    if rsi_v is not None and rsi_v > 46:
        return {"kind": "NONE", "score": 26, "signal": "HOLD", "reason": f"RSI {rsi_v:.0f}", "stopPct": 0.016, "tpPct": 0.012, "dumpLow": trough}
    if day_pos > 0.88:
        return {"kind": "NONE", "score": 22, "signal": "HOLD", "reason": "kejar puncak", "stopPct": 0.016, "tpPct": 0.012, "dumpLow": trough}
    import math
    vol_n = clamp(math.log10(vol / 250_000_000) / 2, 0, 1)
    score = clamp(58 + dump * 5 + ((42 - rsi_v) * 0.7 if rsi_v else 0) + vol_n * 10 - spread * 10, 0, 99)
    buffer = max(0.0045, spread / 100 * 2)
    sl_px = trough * (1 - buffer)
    sl = clamp((px - sl_px) / px, 0.014, 0.022)
    tp = clamp(dump * 0.45 / 100 + 0.008, 0.01, 0.016)
    sig = "STRONG_BUY" if score >= 78 else ("BUY" if score >= 62 else "HOLD")
    return {
        "kind": "BOUNCE",
        "score": round(score),
        "signal": sig,
        "reason": f"BOUNCE dump {dump:.1f}% · lepas low {off:.2f}%",
        "stopPct": sl,
        "tpPct": tp,
        "dumpLow": trough,
    }


def _pullback(window, px, peak, trough, rsi_v, e, spread, vol):
    if len(window) < 10:
        return {"kind": "NONE", "score": 20, "signal": "HOLD", "reason": "histori pendek", "stopPct": 0.016, "tpPct": 0.012, "dumpLow": trough}
    first = window[0]
    slope = ((px - first) / first * 100) if first > 0 else 0
    pull = ((peak - px) / peak * 100) if peak > 0 else 0
    above = e is None or px >= e * 0.996
    if slope < 0.4 or pull < 0.45 or pull > 2.4 or not above:
        return {"kind": "NONE", "score": 22, "signal": "HOLD", "reason": "bukan pullback", "stopPct": 0.016, "tpPct": 0.012, "dumpLow": trough}
    if rsi_v is not None and (rsi_v < 34 or rsi_v > 62):
        return {"kind": "NONE", "score": 24, "signal": "HOLD", "reason": f"RSI {rsi_v:.0f}", "stopPct": 0.016, "tpPct": 0.012, "dumpLow": trough}
    if spread > 0.55:
        return {"kind": "NONE", "score": 22, "signal": "HOLD", "reason": "spread lebar", "stopPct": 0.016, "tpPct": 0.012, "dumpLow": trough}
    import math
    vol_n = clamp(math.log10(max(vol, 1) / 400_000_000) / 2, 0, 1)
    score = clamp(56 + slope * 3 + (1.2 - abs(pull - 1.0)) * 8 + vol_n * 12 - spread * 12, 0, 99)
    sig = "STRONG_BUY" if score >= 76 else ("BUY" if score >= 62 else "HOLD")
    return {
        "kind": "PULLBACK",
        "score": round(score),
        "signal": sig,
        "reason": f"PULLBACK −{pull:.2f}% dari puncak",
        "stopPct": 0.016,
        "tpPct": 0.011,
        "dumpLow": trough,
    }
