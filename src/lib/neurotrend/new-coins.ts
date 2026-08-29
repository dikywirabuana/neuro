/**
 * Universe: SEMUA pair *_idr di Indodax.
 * Skip stablecoin. FART/meme/listing dapat boost, bukan lock.
 */

export type ScanFocus = "all" | "new_coins" | "whitelist";

export const FIXED_PAIR = "fartcoin_idr";
export const VELVET_MANDATORY = false;
export const FART_MANDATORY = false;
export const NEW_LISTING_PAIR = "velvet_idr";

export const SKIP_PAIRS = new Set([
  "usdt_idr",
  "usdc_idr",
  "idrt_idr",
  "dai_idr",
  "busd_idr",
  "tusd_idr",
  "usdd_idr",
  "fdusd_idr",
  "pyusd_idr",
  "usd1_idr",
]);

export function isStablePair(pair: string): boolean {
  return SKIP_PAIRS.has(pair.toLowerCase());
}

export function isTradeablePair(pair: string): boolean {
  const p = pair.toLowerCase();
  return p.endsWith("_idr") && !isStablePair(p);
}

/** @deprecated — semua pair IDR (non-stable) tradeable */
export function isWhitelistedPair(pair: string): boolean {
  return isTradeablePair(pair);
}

export function isFixedPair(pair: string): boolean {
  return pair.toLowerCase() === FIXED_PAIR;
}

export function whitelistLabel(): string {
  return "SEMUA PAIR INDODAX";
}

export const MAJOR_PAIRS = new Set([
  "btc_idr",
  "eth_idr",
  "bnb_idr",
  "sol_idr",
  "ada_idr",
  "trx_idr",
  "ton_idr",
  "dot_idr",
  "ltc_idr",
  "bch_idr",
  "link_idr",
  "avax_idr",
  "matic_idr",
  "pol_idr",
  "uni_idr",
  "atom_idr",
  "near_idr",
  "apt_idr",
  "sui_idr",
  "arb_idr",
  "op_idr",
  "xrp_idr",
]);

export const RECENT_LISTINGS: Record<string, number> = {
  onl_idr: Date.parse("2026-08-11T08:00:00Z"),
  velvet_idr: Date.parse("2026-07-21T07:00:00Z"),
  fartcoin_idr: Date.parse("2024-10-18T00:00:00Z"),
};

const MEME_HINTS = [
  "fart",
  "pepe",
  "doge",
  "shib",
  "bonk",
  "floki",
  "mog",
  "brett",
  "wif",
  "meme",
  "neiro",
  "trump",
  "pengu",
  "popcat",
  "moodeng",
  "goat",
  "chill",
  "andy",
  "ladys",
  "bome",
];

export function isMajorPair(pair: string): boolean {
  return MAJOR_PAIRS.has(pair.toLowerCase());
}

export function isMemeName(pair: string): boolean {
  const base = pair.toLowerCase().replace(/_idr$/, "");
  return MEME_HINTS.some((m) => base.includes(m));
}

export function listingAgeDays(pair: string, now = Date.now()): number | null {
  const ts = RECENT_LISTINGS[pair.toLowerCase()];
  if (!ts) return null;
  return (now - ts) / (24 * 60 * 60 * 1000);
}

export function isRecentListing(pair: string, now = Date.now()): boolean {
  const age = listingAgeDays(pair, now);
  return age != null && age >= 0 && age <= 90;
}

export function isNewCoinCandidate(
  pair: string,
  dayRangePct?: number,
  _volumeIdr?: number,
  now?: number,
): boolean {
  if (!isTradeablePair(pair)) return false;
  if (isRecentListing(pair, now)) return true;
  if (isMemeName(pair)) return true;
  if ((dayRangePct ?? 0) >= 12) return true;
  return false;
}

export function listingPriority(_pair: string, _now = Date.now()): number {
  return 0;
}

export function minScoreForOpportunity(
  _tag: string | undefined,
  _pair: string,
  baseMin: number,
): number {
  return baseMin;
}

export function newCoinBoost(_pair: string, _now?: number): number {
  return 0;
}

export function newCoinTag(pair: string, dayRangePct?: number): string {
  const p = pair.toLowerCase();
  if (isRecentListing(p)) {
    const age = listingAgeDays(p) ?? 99;
    return age <= 14 ? "LISTING" : "BARU";
  }
  if (isMemeName(p)) return "MEME";
  if ((dayRangePct ?? 0) >= 12) return "VOLATILE";
  if (isMajorPair(p)) return "MAJOR";
  return "SCAN";
}

export function minVolumeForPair(pair: string, defaultMin: number): number {
  if (isRecentListing(pair) || isMemeName(pair)) {
    return Math.min(defaultMin, 8_000_000);
  }
  return defaultMin;
}
