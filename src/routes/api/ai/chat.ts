import { createFileRoute } from "@tanstack/react-router";

type Snap = {
  pair: string;
  price: number;
  signal?: string;
  score?: number;
  setup?: string;
  change24h?: number;
  volumeIdr?: number;
  spreadPct?: number;
  position?: {
    qty: number;
    entry: number;
    sl: number;
    tp: number;
    pnlPct: number;
    ageMin: number;
  } | null;
  regime?: string;
};

type Body = {
  pair?: string;
  message?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  snap?: Snap;
  xaiApiKey?: string;
  geminiApiKey?: string;
};

function heuristicReply(message: string, snap: Snap | undefined): string {
  const pair = (snap?.pair || "pair").replace(/_idr$/i, "").toUpperCase();
  const px = snap?.price ?? 0;
  const pos = snap?.position;
  const q = message.toLowerCase();

  const lines: string[] = [];
  lines.push(`${pair} sekarang ${px > 0 ? px.toLocaleString("id-ID") : "—"}.`);
  if (snap?.signal) {
    lines.push(`Sinyal scanner: ${snap.signal} (score ${snap.score ?? "—"})${snap.setup ? ` · ${snap.setup}` : ""}.`);
  }
  if (snap?.regime) lines.push(`Regime pasar: ${snap.regime}.`);
  if (pos) {
    const side = pos.pnlPct >= 0 ? "hijau" : "merah";
    lines.push(
      `Posisi open: entry ${pos.entry.toLocaleString("id-ID")} · PnL ${pos.pnlPct.toFixed(2)}% (${side}) · hold ${pos.ageMin.toFixed(0)} mnt.`,
    );
    lines.push(
      `SL ${pos.sl.toLocaleString("id-ID")} · TP ${pos.tp.toLocaleString("id-ID")}.`,
    );
    if (/tp|take|target|jual|sell/.test(q)) {
      if (px >= pos.tp) lines.push("Harga sudah di/atas TP — bot harus GRID_TP / TAKE_PROFIT. Kalau belum, cek Auto + log EXIT.");
      else {
        const need = ((pos.tp / Math.max(px, 1) - 1) * 100).toFixed(2);
        lines.push(`Belum TP. Butuh naik ~${need}% lagi ke target.`);
      }
    }
    if (/sl|stop|cut|rugi/.test(q)) {
      if (px <= pos.sl) lines.push("Harga sudah tembus SL — seharusnya exit STOP_LOSS.");
      else {
        const room = ((1 - pos.sl / Math.max(px, 1)) * 100).toFixed(2);
        lines.push(`SL masih ${room}% di bawah harga sekarang.`);
      }
    }
  } else {
    lines.push("Belum ada posisi di pair ini.");
    if (/beli|buy|entry/.test(q)) {
      lines.push(
        snap?.signal === "STRONG_BUY" || snap?.signal === "BUY"
          ? "Sinyal mendukung entry. Pakai Manual/Grid dengan SL/TP, atau Start + Auto."
          : "Sinyal belum kuat. Jangan FOMO — tunggu score/BUY.",
      );
    }
  }
  if (/kenapa|why|hold/.test(q) && pos) {
    lines.push(
      pos.pnlPct >= 0
        ? "Hold karena belum TP dan SL belum kena."
        : "Hold karena SL belum tembus. Kalau tidak mau hold, jual manual.",
    );
  }
  return lines.join(" ");
}

async function callGemini(apiKey: string, prompt: string): Promise<string | null> {
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];
  for (const model of models) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 18_000);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
          }),
          signal: ac.signal,
        },
      );
      clearTimeout(t);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("\n")
        .trim();
      if (text) return text;
    } catch {
      /* next */
    }
  }
  return null;
}

async function callGrok(apiKey: string, prompt: string): Promise<string | null> {
  const key = apiKey.replace(/^Bearer\s+/i, "").trim();
  if (key.length < 12) return null;
  for (const model of ["grok-4", "grok-3"]) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 18_000);
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 400,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: ac.signal,
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch {
      /* next */
    }
  }
  return null;
}

export const Route = createFileRoute("/api/ai/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const msg = String(body.message ?? "").trim().slice(0, 500);
        if (!msg) return Response.json({ error: "message required" }, { status: 400 });

        const snap = body.snap;
        const ticker = (snap?.pair || body.pair || "").replace(/_idr$/i, "").toUpperCase();
        const ctx = JSON.stringify(snap ?? {}, null, 0).slice(0, 1200);
        const prompt = `Kamu asisten trader Indodax. Jawab singkat Bahasa Indonesia (max 80 kata). Hanya bahas pair ${ticker || "ini"}.
Data live: ${ctx}
Riwayat: ${(body.history ?? []).slice(-4).map((h) => `${h.role}: ${h.content}`).join(" | ")}
Pertanyaan: ${msg}
Jangan janji profit. Kalau data tidak cukup, bilang terus terang.`;

        const grokKey = String(body.xaiApiKey || process.env.XAI_API_KEY || "").trim();
        const gemKey = String(body.geminiApiKey || process.env.GEMINI_API_KEY || "").trim();

        let text: string | null = null;
        let source = "heuristic";
        if (grokKey.length > 12) {
          text = await callGrok(grokKey, prompt);
          if (text) source = "grok";
        }
        if (!text && gemKey.length > 10) {
          text = await callGemini(gemKey, prompt);
          if (text) source = "gemini";
        }
        if (!text) {
          text = heuristicReply(msg, snap);
          source = "heuristic";
        }
        return Response.json({ text, source, pair: snap?.pair || body.pair });
      },
    },
  },
});
