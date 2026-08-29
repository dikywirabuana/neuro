import { createFileRoute } from "@tanstack/react-router";
import { createHmac } from "node:crypto";

type Body = {
  apiKey?: string;
  apiSecret?: string;
  method?: string;
  params?: Record<string, string | number | undefined>;
};

const ALLOWED = new Set([
  "getInfo",
  "openOrders",
  "trade",
  "cancelOrder",
  "getOrder",
  "orderHistory",
  "tradeHistory",
]);

function signBody(secret: string, body: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

export const Route = createFileRoute("/api/indodax/private")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const apiKey = String(body.apiKey ?? "").trim();
        const apiSecret = String(body.apiSecret ?? "").trim();
        const method = String(body.method ?? "").trim();
        const params = body.params ?? {};

        if (!apiKey || !apiSecret) {
          return Response.json(
            { error: "API key dan secret wajib diisi" },
            { status: 400 },
          );
        }
        if (!ALLOWED.has(method)) {
          return Response.json({ error: "Method tidak diizinkan" }, { status: 400 });
        }

        const nonce = Date.now() * 1000;
        const form = new URLSearchParams();
        form.set("method", method);
        form.set("nonce", String(nonce));
        for (const [k, v] of Object.entries(params)) {
          if (v === undefined || v === null || v === "") continue;
          form.set(k, String(v));
        }
        const payload = form.toString();
        const sign = signBody(apiSecret, payload);

        try {
          const res = await fetch("https://indodax.com/tapi", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Key: apiKey,
              Sign: sign,
              "User-Agent": "NeuroTrendAI/1.1-web",
            },
            body: payload,
            signal: AbortSignal.timeout(15_000),
          });
          const text = await res.text();
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            return Response.json(
              { error: "Respons Indodax tidak valid", raw: text.slice(0, 200) },
              { status: 502 },
            );
          }
          // Never echo secrets
          return Response.json({ ok: true, data });
        } catch (err) {
          return Response.json(
            {
              error: err instanceof Error ? err.message : "Gagal hubungi Indodax",
            },
            { status: 502 },
          );
        }
      },
    },
  },
});
