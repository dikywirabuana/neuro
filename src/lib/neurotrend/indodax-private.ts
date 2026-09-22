/** Client helpers for Indodax private API (keys stay in browser; signed via our proxy). */

export type PrivateResult = {
  ok?: boolean;
  error?: string;
  data?: {
    success?: number;
    error?: string;
    return?: Record<string, unknown>;
  };
};

/** Coins that allow fractional base qty on Indodax. Everything else → integer only. */
const FRACTIONAL_BASES = new Set([
  "btc",
  "eth",
  "sol",
  "bnb",
  "ltc",
  "bch",
  "xrp",
  "ada",
  "dot",
  "link",
  "avax",
  "near",
  "sui",
  "ton",
  "trx",
  "matic",
  "pol",
  "atom",
  "uni",
  "apt",
  "arb",
  "op",
  "hype",
  "taiko",
]);

export async function callPrivate(
  apiKey: string,
  apiSecret: string,
  method: string,
  params: Record<string, string | number | undefined> = {},
): Promise<PrivateResult> {
  const res = await fetch("/api/indodax/private", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ apiKey, apiSecret, method, params }),
  });
  const json = (await res.json()) as PrivateResult & { error?: string };
  if (!res.ok) {
    return { error: json.error ?? `HTTP ${res.status}` };
  }
  return json;
}

export async function getInfo(
  apiKey: string,
  apiSecret: string,
): Promise<{ balanceIdr: number; raw: PrivateResult }> {
  const raw = await callPrivate(apiKey, apiSecret, "getInfo");
  const ret = raw.data?.return as
    | { balance?: Record<string, string | number> }
    | undefined;
  const bal = Number(ret?.balance?.idr ?? 0);
  return { balanceIdr: Number.isFinite(bal) ? bal : 0, raw };
}

export type WalletAsset = {
  coin: string;
  pair: string;
  qty: number;
  hold: number;
  price: number;
  valueIdr: number;
};

/** Parse getInfo balances into sellable wallet rows. */
export function parseWallet(
  raw: PrivateResult,
  prices: Record<string, number>,
): WalletAsset[] {
  const ret = raw.data?.return as
    | {
        balance?: Record<string, string | number>;
        balance_hold?: Record<string, string | number>;
      }
    | undefined;
  const bal = ret?.balance ?? {};
  const holdMap = ret?.balance_hold ?? {};
  const coins = new Set([...Object.keys(bal), ...Object.keys(holdMap)]);
  const out: WalletAsset[] = [];
  for (const coin of coins) {
    const c = coin.toLowerCase();
    const qty = Number(bal[coin] ?? 0) || 0;
    const hold = Number(holdMap[coin] ?? 0) || 0;
    if (qty <= 0 && hold <= 0) continue;
    const pair = c === "idr" ? "idr" : `${c}_idr`;
    const price = c === "idr" ? 1 : Number(prices[pair] ?? 0) || 0;
    const valueIdr = c === "idr" ? qty : qty * price;
    out.push({ coin: c, pair, qty, hold, price, valueIdr });
  }
  out.sort((a, b) => {
    if (a.coin === "idr") return -1;
    if (b.coin === "idr") return 1;
    return b.valueIdr - a.valueIdr;
  });
  return out;
}

export function walletTotals(
  wallet: WalletAsset[],
  prices: Record<string, number>,
  fallbackCash = 0,
): { cash: number; total: number } {
  if (!wallet.length) return { cash: fallbackCash, total: fallbackCash };
  let cash = 0;
  let total = 0;
  for (const a of wallet) {
    if (a.coin === "idr") {
      cash += a.qty;
      total += a.qty;
      continue;
    }
    const px = Number(prices[`${a.coin}_idr`] || a.price || 0);
    if (px > 0) total += a.qty * px;
  }
  return { cash, total };
}

type PairMeta = {
  pair: string;
  priceRound: number;
  volumePrecision: number;
  minIdr: number;
  minBase: number;
};

const pairMeta = new Map<string, PairMeta>();
let pairMetaAt = 0;
let pairMetaPending: Promise<void> | null = null;

/** Known price_round when pairs API belum ke-load. */
const PRICE_ROUND_FALLBACK: Record<string, number> = {
  pepe_idr: 6,
  bonk_idr: 6,
  shib_idr: 6,
  floki_idr: 6,
  mog_idr: 6,
  ladys_idr: 6,
  lunc_idr: 6,
  cat_idr: 6,
  cheems_idr: 6,
  drx_idr: 6,
  molt_idr: 6,
  btrnew_idr: 6,
  idx_idr: 4,
  bank_idr: 3,
  zama_idr: 3,
  mew_idr: 2,
  turbo_idr: 2,
  game2_idr: 2,
};

export async function ensurePairMeta(): Promise<void> {
  if (pairMeta.size > 20 && Date.now() - pairMetaAt < 30 * 60_000) return;
  if (pairMetaPending) return pairMetaPending;
  pairMetaPending = (async () => {
    try {
      const res = await fetch("/api/indodax/pairs", {
        signal: AbortSignal.timeout(12_000),
      });
      const json = (await res.json()) as { pairs?: PairMeta[] };
      for (const row of json.pairs ?? []) {
        pairMeta.set(row.pair, row);
      }
      pairMetaAt = Date.now();
    } catch {
      /* fallback map */
    } finally {
      pairMetaPending = null;
    }
  })();
  return pairMetaPending;
}

export function getPairLimits(pair?: string): {
  minBase: number;
  minIdr: number;
  priceRound: number;
  qtyDecimals: number;
} {
  const p = pair?.toLowerCase();
  const meta = p ? pairMeta.get(p) : undefined;
  return {
    minBase: meta?.minBase && meta.minBase > 0 ? meta.minBase : 0,
    minIdr: meta?.minIdr && meta.minIdr > 0 ? meta.minIdr : 10_000,
    priceRound: meta?.priceRound ?? (p ? PRICE_ROUND_FALLBACK[p] ?? 0 : 0),
    qtyDecimals: qtyDecimals(p),
  };
}

export function priceDecimals(pair?: string, price?: number): number {
  const p = pair?.toLowerCase();
  if (p && pairMeta.get(p)?.priceRound != null) return pairMeta.get(p)!.priceRound;
  if (p && PRICE_ROUND_FALLBACK[p] != null) return PRICE_ROUND_FALLBACK[p];
  if (price != null) {
    if (price < 0.01) return 6;
    if (price < 1) return 3;
    if (price < 100) return 0;
    return 0;
  }
  return 0;
}

function baseOf(pair: string): string {
  return (pair.split("_")[0] ?? "btc").toLowerCase();
}

export function qtyDecimals(pairOrBase?: string, price?: number): number {
  if (!pairOrBase) return price != null && price >= 10_000 ? 8 : 0;
  const pair = pairOrBase.includes("_")
    ? pairOrBase.toLowerCase()
    : `${pairOrBase.toLowerCase()}_idr`;
  const base = baseOf(pair);
  if (FRACTIONAL_BASES.has(base)) return 8;
  const meta = pairMeta.get(pair);
  const minBase = meta?.minBase ?? 0;
  if (minBase > 0 && minBase < 1) {
    const frac = minBase.toFixed(8).replace(/0+$/, "").split(".")[1] ?? "";
    return Math.min(8, Math.max(4, frac.length));
  }
  if ((meta?.volumePrecision ?? 0) > 0) return meta!.volumePrecision;
  return 0;
}

export function allowsFractionalQty(pairOrBase: string, price?: number): boolean {
  return qtyDecimals(pairOrBase, price) > 0;
}

/** Format limit price sesuai price_round Indodax (pepe = 6 desimal). */
export function fmtPrice(price: number, pair?: string): string {
  if (!Number.isFinite(price) || price <= 0) return "0";
  const d = priceDecimals(pair, price);
  if (d <= 0) return String(Math.round(price));
  const tick = 10 ** -d;
  const rounded = Math.round(price / tick) * tick;
  return rounded.toFixed(d);
}

/**
 * Format base qty for Indodax.
 * Integer hanya jika pair memang lot ≥ 1 (bank, gwei, pepe…).
 * Koin mahal (HYPE, BTC) / minBase < 1 → desimal.
 */
export function fmtQty(qty: number, pair?: string, price?: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return "0";
  const d = qtyDecimals(pair, price);
  if (d <= 0) {
    const whole = Math.floor(qty + 1e-12);
    return whole > 0 ? String(whole) : "0";
  }
  const f = Math.floor(qty * 10 ** d + 1e-12) / 10 ** d;
  if (f <= 0) return "0";
  return f.toFixed(d).replace(/\.?0+$/, "") || "0";
}

/** Round qty UP so min IDR / min lot tidak pecah setelah quantize. */
export function fmtQtyUp(qty: number, pair?: string, price?: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return "0";
  const d = qtyDecimals(pair, price);
  if (d <= 0) {
    const whole = Math.ceil(qty - 1e-12);
    return whole > 0 ? String(whole) : "0";
  }
  const tick = 10 ** d;
  const f = Math.ceil(qty * tick - 1e-12) / tick;
  if (f <= 0) return "0";
  return f.toFixed(d).replace(/\.?0+$/, "") || "0";
}

function parseQty(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function quantizeBaseQty(qty: number, pair: string): number {
  return parseQty(fmtQty(qty, pair));
}

export function quantizeBaseQtyUp(qty: number, pair: string, price?: number): number {
  return parseQty(fmtQtyUp(qty, pair, price));
}

/** Minimal IDR biar 1 lot + minBase lolos 10rb setelah ceil. */
export function minBuyIdr(pair: string, px: number): number {
  if (!(px > 0)) return 10_000;
  const limits = getPairLimits(pair);
  const d = qtyDecimals(pair, px);
  const lot = d <= 0 ? 1 : limits.minBase > 0 ? limits.minBase : 10 ** -d;
  const minBase = Math.max(limits.minBase || 0, lot);
  const fromLot = Math.ceil(minBase * px + 1);
  return Math.max(10_000, limits.minIdr || 10_000, fromLot);
}

export function planBuyQty(
  pair: string,
  px: number,
  idrBudget: number,
): { ok: true; qty: number; qtyStr: string; notional: number } | { ok: false; error: string } {
  if (!(px > 0) || !(idrBudget > 0)) {
    return { ok: false, error: "price/idr invalid" };
  }
  const limits = getPairLimits(pair);
  const need = minBuyIdr(pair, px);
  const spend = Math.max(idrBudget, need);
  let qty = quantizeBaseQtyUp(spend / px, pair, px);
  if (limits.minBase > 0 && qty < limits.minBase) {
    qty = quantizeBaseQtyUp(limits.minBase, pair, px);
  }
  let notional = qty * px;
  const d = qtyDecimals(pair, px);
  const tick = d <= 0 ? 1 : 10 ** -d;
  let guard = 0;
  while (notional < 10_000 && qty > 0 && guard < 8) {
    qty = quantizeBaseQtyUp(qty + tick, pair, px);
    notional = qty * px;
    guard += 1;
  }
  const qtyStr = fmtQtyUp(qty, pair, px);
  qty = parseQty(qtyStr);
  notional = qty * px;
  if (!(qty > 0)) {
    return {
      ok: false,
      error: `qty 0 setelah quantize. Naikkan size (min ~ Rp ${need.toLocaleString("id-ID")}).`,
    };
  }
  if (notional < 10_000) {
    return {
      ok: false,
      error: `notional Rp ${Math.round(notional)} < min Rp 10.000 setelah ceil lot.`,
    };
  }
  return { ok: true, qty, qtyStr, notional };
}

/**
 * Limit BUY — base qty only; altcoins integer.
 */
export async function placeBuy(
  apiKey: string,
  apiSecret: string,
  pair: string,
  price: number,
  idrAmount: number,
): Promise<PrivateResult> {
  const base = baseOf(pair);
  const px = Number(price);
  const idr = Number(idrAmount);
  if (!(px > 0) || !(idr > 0)) {
    return { error: "price/idr invalid" };
  }
  await ensurePairMeta();

  const limits = getPairLimits(pair);
  const minIdr = Math.max(10_000, limits.minIdr || 10_000);
  const plan = planBuyQty(pair, px, Math.max(idr, minIdr));
  if (!plan.ok) return { error: plan.error };
  if (plan.notional > idr * 1.25 && plan.notional > minBuyIdr(pair, px) * 1.02) {
    return {
      error: `qty ${plan.qtyStr} ≈ Rp ${Math.round(plan.notional)} melebihi budget Rp ${Math.round(idr)}.`,
    };
  }

  return callPrivate(apiKey, apiSecret, "trade", {
    pair,
    type: "buy",
    order_type: "limit",
    price: fmtPrice(px, pair),
    [base]: plan.qtyStr,
  });
}

/**
 * Limit SELL — always integer for altcoins (bank_idr etc).
 */
export async function placeSell(
  apiKey: string,
  apiSecret: string,
  pair: string,
  price: number,
  qty: number,
): Promise<PrivateResult> {
  const base = baseOf(pair);
  const px = Number(price);
  const q = Number(qty);
  if (!(px > 0) || !(q > 0)) {
    return { error: "price/qty invalid" };
  }
  await ensurePairMeta();

  const qtyStr = fmtQty(q, pair, px);
  const qz = parseQty(qtyStr);
  if (qz <= 0) {
    return {
      error: `qty sell invalid after integer quantize: raw=${q} → ${qtyStr}`,
    };
  }

  return callPrivate(apiKey, apiSecret, "trade", {
    pair,
    type: "sell",
    order_type: "limit",
    price: fmtPrice(px, pair),
    [base]: qtyStr, // e.g. "60" not "60.123"
  });
}

export function coinOfPair(pair: string): string {
  return baseOf(pair);
}

export function tradeOrderId(resp: PrivateResult): string {
  const ret = resp.data?.return;
  if (!ret) return "";
  const id = ret.order_id ?? ret.orderId;
  return id != null ? String(id) : "";
}

export type SettledOrder = {
  orderId: string;
  filled: boolean;
  remain: number;
  status: string;
};

export async function getOrderStatus(
  apiKey: string,
  apiSecret: string,
  pair: string,
  orderId: string,
): Promise<SettledOrder> {
  const raw = await callPrivate(apiKey, apiSecret, "getOrder", {
    pair,
    order_id: orderId,
  });
  if (raw.error || raw.data?.success === 0) {
    return {
      orderId,
      filled: false,
      remain: Number.POSITIVE_INFINITY,
      status: "unknown",
    };
  }
  const ret = (raw.data?.return ?? {}) as Record<string, unknown>;
  const status = String(ret.status ?? "").toLowerCase();
  const cancelled = status === "cancelled" || status === "canceled";
  const knownFilled =
    status === "filled" || status === "done" || status === "closed";

  const coin = baseOf(pair);
  const remainCoinRaw = ret[`remain_${coin}`];
  const remainCoin =
    remainCoinRaw != null && remainCoinRaw !== ""
      ? Number(remainCoinRaw)
      : Number.NaN;

  // remain_idr is often 0 on sells while coin remain is still open — never use it.
  let remain = Number.POSITIVE_INFINITY;
  if (Number.isFinite(remainCoin)) remain = remainCoin;
  else if (ret.remain != null && ret.remain !== "") {
    const n = Number(ret.remain);
    if (Number.isFinite(n)) remain = n;
  }

  const filled =
    !cancelled &&
    (knownFilled || (Number.isFinite(remainCoin) && remainCoin <= 0));
  return { orderId, filled, remain, status: status || "open" };
}

export async function waitUntilSettled(
  apiKey: string,
  apiSecret: string,
  pair: string,
  orderId: string,
  timeoutMs = 4500,
): Promise<SettledOrder> {
  const t0 = Date.now();
  let last: SettledOrder = {
    orderId,
    filled: false,
    remain: 1,
    status: "pending",
  };
  while (Date.now() - t0 < timeoutMs) {
    last = await getOrderStatus(apiKey, apiSecret, pair, orderId);
    if (last.filled || last.status === "cancelled" || last.status === "canceled") {
      return last;
    }
    await new Promise((r) => setTimeout(r, 450));
  }
  return last;
}

export async function getCoinBalances(
  apiKey: string,
  apiSecret: string,
  coin: string,
): Promise<{ avail: number; hold: number; ok: boolean; error?: string }> {
  const raw = await getInfo(apiKey, apiSecret);
  if (raw.raw.error || raw.raw.data?.success === 0) {
    return {
      avail: 0,
      hold: 0,
      ok: false,
      error: raw.raw.error || raw.raw.data?.error || "getInfo",
    };
  }
  const ret = raw.raw.data?.return as
    | {
        balance?: Record<string, string | number>;
        balance_hold?: Record<string, string | number>;
      }
    | undefined;
  const c = coin.toLowerCase();
  const avail = Number(ret?.balance?.[c] ?? 0) || 0;
  const hold = Number(ret?.balance_hold?.[c] ?? 0) || 0;
  return { avail, hold, ok: true };
}

function extractOrders(
  raw: PrivateResult,
  pair: string,
): { order_id: string; type: string }[] {
  const ret = raw.data?.return as Record<string, unknown> | undefined;
  if (!ret) return [];
  const list: unknown[] = [];
  if (Array.isArray(ret.orders)) list.push(...ret.orders);
  const keyed = ret[pair] ?? ret[pair.toLowerCase()];
  if (Array.isArray(keyed)) list.push(...keyed);
  const out: { order_id: string; type: string }[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as { order_id?: string | number; type?: string };
    if (o.order_id == null) continue;
    out.push({
      order_id: String(o.order_id),
      type: String(o.type ?? "sell").toLowerCase(),
    });
  }
  return out;
}

export type OpenOrder = {
  pair: string;
  orderId: string;
  type: "buy" | "sell";
  price: number;
  remain: number;
};

export async function listAllOpenOrders(
  apiKey: string,
  apiSecret: string,
): Promise<OpenOrder[]> {
  const raw = await callPrivate(apiKey, apiSecret, "openOrders", {});
  const ret = raw.data?.return as Record<string, unknown> | undefined;
  if (!ret) return [];
  const out: OpenOrder[] = [];
  const pushFrom = (pair: string, list: unknown[]) => {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id = o.order_id ?? o.orderId;
      if (id == null) continue;
      const typ = String(o.type ?? "sell").toLowerCase() === "buy" ? "buy" : "sell";
      const price = Number(o.price ?? 0) || 0;
      const remainKeys = Object.keys(o).filter((k) => k.startsWith("remain_"));
      let remain = Number(o.remain ?? 0) || 0;
      for (const k of remainKeys) {
        const n = Number(o[k]);
        if (Number.isFinite(n) && n > 0) remain = n;
      }
      out.push({
        pair: pair.toLowerCase(),
        orderId: String(id),
        type: typ,
        price,
        remain,
      });
    }
  };
  if (Array.isArray(ret.orders)) pushFrom("unknown", ret.orders);
  for (const [k, v] of Object.entries(ret)) {
    if (k === "orders") continue;
    if (Array.isArray(v) && k.includes("_")) pushFrom(k, v);
  }
  return out;
}

export async function cancelOneOrder(
  apiKey: string,
  apiSecret: string,
  pair: string,
  orderId: string,
  type: "buy" | "sell",
): Promise<PrivateResult> {
  return callPrivate(apiKey, apiSecret, "cancelOrder", {
    pair,
    order_id: orderId,
    type,
  });
}

export async function cancelOpenOrders(
  apiKey: string,
  apiSecret: string,
  pair: string,
): Promise<number> {
  const listed = await callPrivate(apiKey, apiSecret, "openOrders", { pair });
  const orders = extractOrders(listed, pair);
  let n = 0;
  for (const o of orders) {
    const r = await callPrivate(apiKey, apiSecret, "cancelOrder", {
      pair,
      order_id: o.order_id,
      type: o.type === "buy" ? "buy" : "sell",
    });
    if (r.data?.success === 1) n += 1;
  }
  return n;
}
