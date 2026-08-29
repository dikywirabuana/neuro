import { createFileRoute } from "@tanstack/react-router";
import { heuristicDecide as runHeuristic } from "@/lib/neurotrend/heuristic";

type Candidate = {
  pair: string;
  score: number;
  signal: string;
  price: number;
  rangePos: number;
  volumeIdr: number;
  spreadPct: number;
  dayRangePct?: number;
  setup?: "BOUNCE" | "PULLBACK" | "BREAKOUT" | "NONE";
  setupReason?: string;
};

type Held = {
  pair: string;
  score: number;
  pnlPct: number;
  ageMin: number;
};

type Body = {
  regime?: string;
  allowEntry?: boolean;
  candidates?: Candidate[];
  held?: Held[];
  weights?: string;
  openPositions?: number;
  maxPositions?: number;
  minScore?: number;
  feeRate?: number;
  xaiApiKey?: string;
  geminiApiKey?: string;
  ping?: boolean;
  prefer?: "grok" | "gemini";
  cash?: number;
  equity?: number;
  dailyLoss?: number;
  maxNotional?: number;
  live?: boolean;
};

type Decision = {
  pair: string;
  action: "BUY" | "SKIP" | "SELL";
  confidence: number;
  reason: string;
  replace?: string;
  slPct?: number;
  tpPct?: number;
};

function heuristicDecide(
  candidates: Candidate[],
  allowEntry: boolean,
  openPositions: number,
  maxPositions: number,
  minScore = 85,
  feeRate = 0.0025,
  regime?: string,
): Decision[] {
  return runHeuristic(candidates, {
    allowEntry,
    openPositions,
    maxPositions,
    minScore,
    feeRate,
    regime: regime as "TREND_UP" | "TREND_DOWN" | "CHOP" | "UNKNOWN" | undefined,
  });
}

async function callGemini(
  apiKey: string,
  prompt: string,
  maxTokens = 500,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const models = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-flash-latest",
  ];
  let lastErr = "no model";
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: maxTokens,
              responseMimeType: "application/json",
            },
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        lastErr = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(errText) as { error?: { message?: string } };
          if (j.error?.message) lastErr = j.error.message;
        } catch {
          if (errText) lastErr = errText.slice(0, 140);
        }
        if (res.status === 404 || res.status === 400) continue;
        return { ok: false, error: lastErr };
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("\n")
        .trim();
      return { ok: true, text };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "timeout/network";
    }
  }
  return { ok: false, error: lastErr };
}

function grokErrorDetail(status: number, errText: string): string {
  try {
    const j = JSON.parse(errText) as {
      error?: string | { message?: string };
      code?: string;
      message?: string;
    };
    if (typeof j.error === "string" && j.error.trim()) return j.error;
    if (j.error && typeof j.error === "object" && j.error.message) {
      return j.error.message;
    }
    if (j.message) return j.message;
    if (j.code) return String(j.code);
  } catch {
    /* raw */
  }
  const slice = errText.replace(/\s+/g, " ").trim().slice(0, 180);
  return slice || `HTTP ${status}`;
}

const GROK_MODELS = ["grok-4.6", "grok-4.5", "grok-4", "grok-3"];

async function callGrok(
  apiKey: string,
  messages: { role: string; content: string }[],
  maxTokens = 500,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = apiKey
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  if (key.length < 12) return { ok: false, error: "Grok API key terlalu pendek" };

  let lastErr = "no model";
  for (const model of GROK_MODELS) {
    for (const withJson of [true, false]) {
      try {
        const body: Record<string, unknown> = {
          model,
          temperature: 0.15,
          max_tokens: maxTokens,
          messages,
        };
        if (withJson) body.response_format = { type: "json_object" };
        const res = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(25_000),
        });
        if (!res.ok) {
          lastErr = grokErrorDetail(res.status, await res.text().catch(() => ""));
          if (res.status === 401 || res.status === 403) {
            return { ok: false, error: lastErr };
          }
          continue;
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const text = data.choices?.[0]?.message?.content ?? "";
        if (!text.trim()) {
          lastErr = `${model} empty`;
          continue;
        }
        return { ok: true, text };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "timeout/network";
      }
    }
  }
  return { ok: false, error: lastErr };
}

function grokKeys(bodyKey?: string): string[] {
  const body = String(bodyKey ?? "")
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  const env = String(process.env.XAI_API_KEY ?? "").trim();
  const out: string[] = [];
  const push = (k: string) => {
    if (k.length > 12 && !out.includes(k)) out.push(k);
  };
  if (body.startsWith("xai-")) push(body);
  if (env.startsWith("xai-")) push(env);
  if (body) push(body);
  if (env) push(env);
  return out;
}

async function callGrokWithFallback(
  keys: string[],
  messages: { role: string; content: string }[],
  maxTokens = 500,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let lastErr = "no grok key";
  for (const k of keys) {
    const r = await callGrok(k, messages, maxTokens);
    if (r.ok) return r;
    lastErr = r.error;
  }
  return { ok: false, error: lastErr };
}

function resolveGemini(bodyKey?: string): string {
  const fromBody = String(bodyKey ?? "").trim();
  if (fromBody.length > 10) return fromBody;
  return String(
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "",
  ).trim();
}

function repairJson(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
}

function extractSlice(text: string, open: "{" | "[", close: "}" | "]"): string | null {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizeParsed(j: unknown): {
  summary?: string;
  decisions?: Decision[];
} | null {
  if (!j) return null;
  if (Array.isArray(j)) return { decisions: j as Decision[] };
  if (typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  if (Array.isArray(o.decisions)) {
    return { summary: String(o.summary ?? ""), decisions: o.decisions as Decision[] };
  }
  if (o.pair && o.action) return { decisions: [o as unknown as Decision] };
  if (o.data && typeof o.data === "object") return normalizeParsed(o.data);
  return { summary: String(o.summary ?? ""), decisions: [] };
}

function salvageDecisions(raw: string): Decision[] {
  const out: Decision[] = [];
  const re =
    /"pair"\s*:\s*"([^"]+)"[\s\S]{0,180}?"action"\s*:\s*"(BUY|SKIP|SELL)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out.push({
      pair: m[1],
      action: m[2].toUpperCase() as "BUY" | "SKIP" | "SELL",
      confidence: 0.6,
      reason: "salvage",
    });
  }
  return out;
}

function parseDecisions(raw: string): {
  summary?: string;
  decisions?: Decision[];
} | null {
  const cleaned = String(raw ?? "").replace(/```json|```/g, "").trim();
  if (!cleaned) return null;
  const attempts = [cleaned];
  const obj = extractSlice(cleaned, "{", "}");
  const arr = extractSlice(cleaned, "[", "]");
  if (obj) attempts.push(obj);
  if (arr) attempts.push(`{"decisions":${arr}}`);

  for (const t of attempts) {
    try {
      const parsed = normalizeParsed(JSON.parse(repairJson(t)));
      if (parsed && (parsed.decisions?.length || parsed.summary)) return parsed;
    } catch {
      /* next */
    }
  }
  const salvage = salvageDecisions(cleaned);
  if (salvage.length) return { summary: "salvage parse", decisions: salvage };
  return null;
}

export const Route = createFileRoute("/api/ai/decide")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const geminiKey = resolveGemini(body.geminiApiKey);
        const grokKeyList = grokKeys(body.xaiApiKey);

        if (body.ping) {
          const prefer = body.prefer === "gemini" ? "gemini" : "grok";
          const tryGrok = async () => {
            if (!grokKeyList.length) return null;
            const ping = await callGrokWithFallback(
              grokKeyList,
              [
                {
                  role: "user",
                  content: 'Reply exactly: {"ok":true,"engine":"grok"}',
                },
              ],
              40,
            );
            if (!ping.ok) {
              return {
                ok: false,
                source: "error",
                summary: `Grok gagal: ${ping.error}`,
              };
            }
            return {
              ok: true,
              source: "grok",
              summary: "Grok CONNECTED · pilot 100%",
            };
          };
          const tryGemini = async () => {
            if (!geminiKey) return null;
            const ping = await callGemini(
              geminiKey,
              'Reply exactly: {"ok":true,"engine":"gemini"}',
              40,
            );
            if (!ping.ok) {
              return {
                ok: false,
                source: "error",
                summary: `Gemini gagal: ${ping.error}`,
              };
            }
            return { ok: true, source: "gemini", summary: "Gemini CONNECTED" };
          };

          const first = prefer === "gemini" ? await tryGemini() : await tryGrok();
          if (first?.ok) return Response.json(first);
          const second = prefer === "gemini" ? await tryGrok() : await tryGemini();
          if (second) return Response.json(second);
          if (first) return Response.json(first);
          return Response.json({
            ok: false,
            source: "none",
            summary: "Isi Grok (xAI) API key di Settings, atau Connect Grok.",
          });
        }

        const candidates = Array.isArray(body.candidates)
          ? body.candidates.slice(0, 12)
          : [];
        const allowEntry = Boolean(body.allowEntry);
        const openPositions = Number(body.openPositions ?? 0);
        const maxPositions = Number(body.maxPositions ?? 1);
        const minScore = Number(body.minScore ?? 85);
        const feeRate = Number(body.feeRate ?? 0.0025);
        const regime = String(body.regime ?? "UNKNOWN");
        const weights = String(body.weights ?? "");
        const cash = Number(body.cash ?? 0);
        const equity = Number(body.equity ?? 0);
        const dailyLoss = Number(body.dailyLoss ?? 0);
        const maxNotional = Number(body.maxNotional ?? 25000);
        const live = Boolean(body.live);
        const held = Array.isArray(body.held) ? body.held.slice(0, 8) : [];
        const slotsLeft = Math.max(0, maxPositions - openPositions);

        const fallback = candidates.length
          ? heuristicDecide(
              candidates,
              allowEntry,
              openPositions,
              maxPositions,
              minScore,
              feeRate,
              regime,
            )
          : [];

        const system = `Kamu Grok, PILOT bot trading Indodax (IDR).
Playbook terbukti: regime dulu, baru trade.
- TREND_DOWN: semua SKIP. Jangan lawan dump.
- CHOP: hanya BOUNCE (mean reversion, panic yang sudah balik).
- TREND_UP: hanya PULLBACK atau BREAKOUT. Jangan kejar puncak.
Fee round-trip 0.50%. TP harus > fee+spread+0.7%. Diam > loss.
Jawab HANYA JSON valid.`;

        const prompt = `Pilot scan Indodax — hybrid terbukti.

live: ${live}
regime: ${regime}
allowEntry: ${allowEntry}
equity: ${Math.round(equity)} cash: ${Math.round(cash)}
open: ${openPositions}/${maxPositions} (sisa ${slotsLeft})
maxNotional/order: ${Math.round(maxNotional)}
dailyLoss: ${Math.round(dailyLoss)}
feeRate: ${feeRate}

Posisi dipegang:
${JSON.stringify(held)}

Universe:
${JSON.stringify(candidates)}

Aturan:
- TREND_DOWN atau allowEntry false → semua SKIP.
- CHOP → BUY hanya setup BOUNCE score tinggi.
- TREND_UP → BUY hanya PULLBACK / BREAKOUT.
- SELL posisi yang sudah hijau cukup atau rusak setup.
- BUY max ${Math.max(1, slotsLeft)}. Slot penuh: 1 rotasi + replace hanya jika score +10.
- slPct 1.4–2.2%. tpPct ≥ 1.3%. Spread > 0.75% = SKIP.
- Tidak yakin = SKIP.

Format:
{"summary":"satu kalimat taktik","pilot":true,"decisions":[{"pair":"xxx_idr","action":"BUY|SELL|SKIP","confidence":0.0,"reason":"singkat","replace":"opsional","slPct":0.016,"tpPct":0.014}]}`;

        let rawText = "";
        let source: "gemini" | "grok" | "heuristic" = "heuristic";

        if (grokKeyList.length) {
          const grok = await callGrokWithFallback(
            grokKeyList,
            [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
            900,
          );
          if (!grok.ok) {
            return Response.json({
              source: "error",
              pilot: false,
              decisions: [],
              summary: `Grok gagal: ${grok.error} — NO TRADE (bukan heuristic)`,
            });
          }
          rawText = grok.text;
          source = "grok";
        } else if (geminiKey) {
          const gem = await callGemini(geminiKey, `${system}\n\n${prompt}`, 800);
          if (!gem.ok) {
            return Response.json({
              source: "heuristic",
              decisions: fallback,
              summary: `Gemini error: ${gem.error} — fallback heuristic`,
            });
          }
          rawText = gem.text;
          source = "gemini";
        } else {
          return Response.json({
            source: "heuristic",
            decisions: fallback,
            summary: "Heuristic — Connect Grok agar AI 100% pilot",
          });
        }

        let parsed = parseDecisions(rawText);
        if (!parsed && source === "grok" && grokKeyList.length) {
          const retry = await callGrokWithFallback(
            grokKeyList,
            [
              { role: "system", content: "JSON only." },
              {
                role: "user",
                content: `Ulangi keputusan dalam JSON schema yang diminta. Pair: ${candidates.map((c) => c.pair).join(",")}`,
              },
            ],
            700,
          );
          if (retry.ok) parsed = parseDecisions(retry.text) ?? parsed;
        }

        if (!parsed) {
          if (source === "grok") {
            return Response.json({
              source: "error",
              pilot: false,
              decisions: [],
              summary: "Grok JSON rusak — NO TRADE",
            });
          }
          return Response.json({
            source,
            decisions: fallback,
            summary: `${source} JSON rusak — pakai keputusan scan (bukan hold)`,
          });
        }

        const decisions = (parsed.decisions ?? [])
          .filter(
            (d) =>
              d &&
              d.pair &&
              (d.action === "BUY" || d.action === "SKIP" || d.action === "SELL"),
          )
          .map((d) => ({
            pair: String(d.pair),
            action: d.action as "BUY" | "SKIP" | "SELL",
            confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0.5)),
            reason: String(d.reason ?? "").slice(0, 160),
            replace: d.replace ? String(d.replace) : undefined,
            slPct: Number(d.slPct) > 0 ? Number(d.slPct) : undefined,
            tpPct: Number(d.tpPct) > 0 ? Number(d.tpPct) : undefined,
          }));

        if (!decisions.length && source === "grok") {
          return Response.json({
            source: "grok",
            pilot: true,
            decisions: [],
            summary: parsed.summary || "Grok diam — NO TRADE",
          });
        }

        if (!decisions.length) {
          return Response.json({
            source,
            decisions: fallback,
            summary: parsed.summary || `${source} kosong — pakai keputusan scan`,
          });
        }

        return Response.json({
          source,
          pilot: source === "grok",
          decisions,
          summary: String(parsed.summary ?? "AI decision").slice(0, 240),
        });
      },
    },
  },
});
