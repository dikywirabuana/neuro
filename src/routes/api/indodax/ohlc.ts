import { createFileRoute } from "@tanstack/react-router";

export type OhlcBar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function symbolOf(pair: string): string {
  return pair.replace(/_/g, "").toUpperCase();
}

function tfSeconds(tf: string): number {
  if (tf === "1D") return 86_400;
  if (tf === "3D") return 259_200;
  if (tf === "1W") return 604_800;
  const n = Number(tf);
  return Number.isFinite(n) && n > 0 ? n * 60 : 900;
}

function parseBars(raw: unknown): OhlcBar[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const t = num(r.Time ?? r.time ?? r.t);
      const o = num(r.Open ?? r.open ?? r.o);
      const h = num(r.High ?? r.high ?? r.h);
      const l = num(r.Low ?? r.low ?? r.l);
      const c = num(r.Close ?? r.close ?? r.c);
      const v = num(r.Volume ?? r.volume ?? r.v);
      if (t <= 0 || c <= 0 || h <= 0 || l <= 0) return null;
      return { t: t > 1e12 ? t : t * 1000, o, h, l, c, v };
    })
    .filter((b): b is OhlcBar => Boolean(b))
    .sort((a, b) => a.t - b.t);
}

export const Route = createFileRoute("/api/indodax/ohlc")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const pair = String(url.searchParams.get("pair") ?? "")
          .toLowerCase()
          .trim();
        const tfRaw = String(url.searchParams.get("tf") ?? "15");
        const tf = ["1", "15", "30", "60", "240", "1D"].includes(tfRaw)
          ? tfRaw
          : "15";

        if (!pair || !pair.endsWith("_idr")) {
          return Response.json({ error: "pair required" }, { status: 400 });
        }

        const now = Math.floor(Date.now() / 1000);
        const barsWanted = 80;
        const from = now - tfSeconds(tf) * barsWanted;
        const symbol = symbolOf(pair);
        const endpoint = `https://indodax.com/tradingview/history_v2?from=${from}&to=${now}&tf=${encodeURIComponent(tf)}&symbol=${encodeURIComponent(symbol)}`;

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 8_000);
        try {
          const res = await fetch(endpoint, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              accept: "application/json",
            },
            signal: ac.signal,
          });
          if (!res.ok) throw new Error(`Indodax ${res.status}`);
          const raw = await res.json();
          const bars = parseBars(raw).slice(-barsWanted);
          return Response.json({
            pair,
            symbol,
            tf,
            bars,
            source: "live",
            ts: Date.now(),
          });
        } catch (err) {
          return Response.json({
            pair,
            symbol,
            tf,
            bars: [],
            source: "error",
            error: err instanceof Error ? err.message : "ohlc fail",
            ts: Date.now(),
          });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
