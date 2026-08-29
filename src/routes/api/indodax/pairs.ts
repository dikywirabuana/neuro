import { createFileRoute } from "@tanstack/react-router";

export type PairMeta = {
  pair: string;
  priceRound: number;
  volumePrecision: number;
  minIdr: number;
  minBase: number;
};

let cache: { at: number; rows: PairMeta[] } | null = null;

export const Route = createFileRoute("/api/indodax/pairs")({
  server: {
    handlers: {
      GET: async () => {
        if (cache && Date.now() - cache.at < 30 * 60_000) {
          return Response.json({ pairs: cache.rows, source: "cache" });
        }
        try {
          const res = await fetch("https://indodax.com/api/pairs", {
            headers: { "User-Agent": "NeuroTrendAI/1.1" },
            signal: AbortSignal.timeout(12_000),
          });
          if (!res.ok) throw new Error(`pairs ${res.status}`);
          const raw = (await res.json()) as Array<Record<string, unknown>>;
          const rows: PairMeta[] = [];
          for (const p of raw) {
            const pair = String(p.ticker_id ?? "").toLowerCase();
            if (!pair.endsWith("_idr")) continue;
            rows.push({
              pair,
              priceRound: Number(p.price_round ?? 0) || 0,
              volumePrecision: Number(p.volume_precision ?? 0) || 0,
              minIdr: Number(p.trade_min_base_currency ?? 10_000) || 10_000,
              minBase: Number(p.trade_min_traded_currency ?? 0) || 0,
            });
          }
          cache = { at: Date.now(), rows };
          return Response.json({ pairs: rows, source: "live" });
        } catch (e) {
          return Response.json({
            pairs: [],
            source: "error",
            error: e instanceof Error ? e.message : "pairs fail",
          });
        }
      },
    },
  },
});
