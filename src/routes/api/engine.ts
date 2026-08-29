import { createFileRoute } from "@tanstack/react-router";

const ENGINE = "http://127.0.0.1:8091";

async function fwd(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${ENGINE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(12_000),
    });
    const json = await res.json().catch(() => ({ ok: false, error: "engine json" }));
    return Response.json(json, { status: res.ok ? 200 : res.status });
  } catch (e) {
    return Response.json(
      {
        ok: false,
        engine: "offline",
        error: e instanceof Error ? e.message : "python engine offline",
      },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/engine")({
  server: {
    handlers: {
      GET: async () => fwd("/state"),
      POST: async ({ request }) => {
        const body = await request.text();
        return fwd("/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      },
    },
  },
});
