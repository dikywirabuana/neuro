import { createFileRoute } from "@tanstack/react-router";
import { INDODAX_UA } from "@/lib/neurotrend/http";

export const Route = createFileRoute("/api/indodax/tickers")({
  server: {
    handlers: {
      GET: async () => {
        const url = "https://indodax.com/api/tickers";
        let lastErr = "tickers";
        for (let i = 0; i < 2; i++) {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), 8_000);
          try {
            const res = await fetch(url, {
              headers: { "User-Agent": INDODAX_UA, accept: "application/json" },
              signal: ac.signal,
            });
            if (!res.ok) throw new Error(`Indodax ${res.status}`);
            const data = (await res.json()) as { tickers?: Record<string, unknown> };
            const tickers = data.tickers ?? data;
            const count = tickers && typeof tickers === "object" ? Object.keys(tickers).length : 0;
            if (count < 5) throw new Error("empty tickers");
            return Response.json({
              source: "live",
              count,
              tickers,
              ts: Date.now(),
            });
          } catch (err) {
            lastErr = err instanceof Error ? err.message : String(err);
          } finally {
            clearTimeout(timer);
          }
        }
        return Response.json({
          source: "error",
          count: 0,
          tickers: {},
          ts: Date.now(),
          warning: lastErr,
        });
      },
    },
  },
});
