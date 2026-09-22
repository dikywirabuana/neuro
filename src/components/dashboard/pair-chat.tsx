import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Opportunity, Position } from "@/lib/neurotrend/types";
import { formatNum } from "@/lib/utils";

type Msg = { id: string; role: "user" | "assistant"; text: string; source?: string };

const cache = new Map<string, Msg[]>();

function tickerOf(pair: string) {
  return pair.replace(/_idr$/i, "").toUpperCase();
}

const CHIPS = ["Sinyal sekarang?", "Tembus TP belum?", "SL aman?", "Hold atau jual?"];

export function PairChat({
  pair,
  price,
  opp,
  position,
  regime,
  xaiApiKey,
  geminiApiKey,
}: {
  pair: string;
  price: number;
  opp?: Opportunity;
  position?: Position | null;
  regime?: string;
  xaiApiKey: string;
  geminiApiKey: string;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(() => cache.get(pair) ?? []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs(cache.get(pair) ?? []);
  }, [pair]);

  useEffect(() => {
    cache.set(pair, msgs.slice(-40));
  }, [pair, msgs]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const snap = useMemo(() => {
    const pnlPct =
      position && price > 0
        ? ((price - position.entryPrice) / position.entryPrice) * 100
        : 0;
    return {
      pair,
      price,
      signal: opp?.signal,
      score: opp?.score,
      setup: opp?.setup,
      change24h: opp?.change24h,
      volumeIdr: opp?.volumeIdr,
      spreadPct: opp?.spreadPct,
      regime,
      position: position
        ? {
            qty: position.qty,
            entry: position.entryPrice,
            sl: position.stopLoss,
            tp: position.takeProfit,
            pnlPct,
            ageMin: (Date.now() - position.entryTime) / 60_000,
          }
        : null,
    };
  }, [pair, price, opp, position, regime]);

  async function send(raw?: string) {
    const message = (raw ?? text).trim();
    if (!message || busy) return;
    setText("");
    const user: Msg = { id: `${Date.now()}-u`, role: "user", text: message };
    setMsgs((m) => [...m, user]);
    setBusy(true);
    try {
      const history = [...msgs, user].slice(-6).map((m) => ({
        role: m.role,
        content: m.text,
      }));
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pair,
          message,
          history,
          snap,
          xaiApiKey,
          geminiApiKey,
        }),
      });
      const json = (await res.json()) as { text?: string; source?: string; error?: string };
      const reply = json.text || json.error || "Chat gagal.";
      setMsgs((m) => [
        ...m,
        {
          id: `${Date.now()}-a`,
          role: "assistant",
          text: reply,
          source: json.source,
        },
      ]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        {
          id: `${Date.now()}-e`,
          role: "assistant",
          text: e instanceof Error ? e.message : "Chat error",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel flex h-[420px] flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="text-sm font-medium">Chat {tickerOf(pair)}</div>
        <div className="text-[11px] tabular text-[var(--color-subtle)]">
          {price > 0 ? formatNum(price, price < 10 ? 4 : 0) : "—"}
          {position ? ` · PnL ${((price / position.entryPrice - 1) * 100).toFixed(2)}%` : ""}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm">
        {msgs.length === 0 ? (
          <div className="text-xs text-[var(--color-muted)]">
            Tanya soal pair ini: sinyal, TP/SL, hold atau jual.
            {position
              ? ` Posisi entry ${formatNum(position.entryPrice, 0)} · SL ${formatNum(position.stopLoss, 0)} · TP ${formatNum(position.takeProfit, 0)}.`
              : " Belum ada posisi."}
          </div>
        ) : null}
        {msgs.map((m) => (
          <div
            key={m.id}
            className={`max-w-[92%] rounded-lg px-2.5 py-1.5 ${
              m.role === "user"
                ? "ml-auto bg-[var(--color-accent)]/20 text-[var(--color-fg)]"
                : "bg-[var(--color-surface-2,#121821)] text-[var(--color-muted)]"
            }`}
          >
            {m.text}
            {m.source ? (
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--color-subtle)]">
                {m.source}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? (
          <div className="text-xs text-[var(--color-subtle)]">Menulis…</div>
        ) : null}
        <div ref={endRef} />
      </div>
      <div className="flex flex-wrap gap-1 border-t border-[var(--color-border)] px-2 pt-2">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] hover:text-white"
            onClick={() => void send(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Tanya ${tickerOf(pair)}…`}
          className="h-9"
        />
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          Kirim
        </Button>
      </form>
    </div>
  );
}
