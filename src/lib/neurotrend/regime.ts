import type { Opportunity } from "./types";

export type MarketRegime = "TREND_UP" | "TREND_DOWN" | "CHOP" | "UNKNOWN";
export type AllowedSetup = "BOUNCE" | "PULLBACK" | "BREAKOUT";

export type RegimeReport = {
  regime: MarketRegime;
  allowEntry: boolean;
  breadth: number;
  avgRangePos: number;
  tightness: number;
  reason: string;
  allowedSetups: AllowedSetup[];
};

export type RegimeOpts = { mode?: "strict" | "whitelist" };

export function setupsForRegime(regime: MarketRegime): AllowedSetup[] {
  if (regime === "TREND_UP") return ["BREAKOUT", "BOUNCE"];
  if (regime === "CHOP") return ["BOUNCE", "BREAKOUT"];
  if (regime === "TREND_DOWN") return ["BOUNCE"];
  return [];
}

export function setupFitsRegime(
  setup: string | undefined,
  regime: MarketRegime,
): boolean {
  if (!setup) return false;
  return setupsForRegime(regime).includes(setup as AllowedSetup);
}

export function detectRegime(
  opps: Opportunity[],
  _opts: RegimeOpts = {},
): RegimeReport {
  if (!opps.length) {
    return {
      regime: "UNKNOWN",
      allowEntry: false,
      breadth: 0,
      avgRangePos: 0.5,
      tightness: 0,
      reason: "Tidak ada data — NO TRADE",
      allowedSetups: [],
    };
  }

  const top = opps.slice(0, Math.min(25, opps.length));
  const avgRangePos =
    top.reduce((s, o) => s + o.rangePos, 0) / Math.max(1, top.length);
  const avgSpread =
    top.reduce((s, o) => s + o.spreadPct, 0) / Math.max(1, top.length);
  const tightness = Math.min(1, Math.max(0, 1 - avgSpread / 1.2));
  const bounces = top.filter((o) => o.setup === "BOUNCE").length;
  const trends = top.filter(
    (o) => o.setup === "PULLBACK" || o.setup === "BREAKOUT",
  ).length;
  const setups = bounces + trends;
  const breadth = setups / top.length;

  let regime: MarketRegime = "CHOP";
  if (avgRangePos <= 0.26) regime = "TREND_DOWN";
  else if (avgRangePos >= 0.62 || (trends >= 4 && avgRangePos >= 0.55)) {
    regime = "TREND_UP";
  } else regime = "CHOP";

  const allowedSetups = setupsForRegime(regime);
  const matching = top.filter((o) =>
    setupFitsRegime(o.setup, regime),
  );
  const allowEntry = matching.some((o) => {
    if (o.signal !== "BUY" && o.signal !== "STRONG_BUY") return false;
    return true;
  });

  if (!allowEntry) {
    return {
      regime,
      allowEntry: true,
      breadth,
      avgRangePos,
      tightness,
      allowedSetups,
      reason: `${regime} · nunggu tape/dip (scan tetap jalan)`,
    };
  }

  return {
    regime,
    allowEntry: true,
    breadth,
    avgRangePos,
    tightness,
    allowedSetups,
    reason: `${regime} · ${matching.length} setup (${matching
      .slice(0, 3)
      .map((s) => `${s.pair.replace("_idr", "")} ${s.setup}`)
      .join(", ")})`,
  };
}
