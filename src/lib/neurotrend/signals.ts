import type { Signal } from "./types";

export function classifySignal(score: number): Signal {
  if (score >= 80) return "STRONG_BUY";
  if (score >= 60) return "BUY";
  if (score >= 40) return "HOLD";
  if (score >= 20) return "SELL";
  return "STRONG_SELL";
}

export function signalWeight(signal: Signal): number {
  switch (signal) {
    case "STRONG_BUY":
      return 2;
    case "BUY":
      return 1;
    case "HOLD":
      return 0;
    case "SELL":
      return -1;
    case "STRONG_SELL":
    case "AVOID":
      return -2;
    default:
      return 0;
  }
}

export function isBullish(signal: Signal): boolean {
  return signal === "STRONG_BUY" || signal === "BUY";
}
