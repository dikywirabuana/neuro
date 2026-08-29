import { Badge } from "@/components/ui/badge";
import type { ScoreWeights } from "@/lib/neurotrend/adaptive";
import { describeWeights } from "@/lib/neurotrend/adaptive";
import type { RegimeReport } from "@/lib/neurotrend/regime";

type Decision = {
  pair: string;
  action: "BUY" | "SKIP" | "SELL";
  confidence: number;
  reason: string;
};

export function AiPanel({
  regime,
  weights,
  aiSource,
  aiSummary,
  decisions,
  autoTrade,
}: {
  regime: RegimeReport | null;
  weights: ScoreWeights;
  aiSource: "gemini" | "grok" | "heuristic" | "idle";
  aiSummary: string;
  decisions: Decision[];
  autoTrade: boolean;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="panel space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium">AI brain</div>
          <Badge
            tone={
              aiSource === "gemini" || aiSource === "grok"
                ? "buy"
                : aiSource === "heuristic"
                  ? "warn"
                  : "muted"
            }
          >
            {aiSource === "gemini"
              ? "Gemini"
              : aiSource === "grok"
                ? "Grok"
                : aiSource === "heuristic"
                  ? "Heuristic"
                  : "Idle"}
          </Badge>
          <Badge tone={autoTrade ? "buy" : "muted"}>
            {autoTrade ? "AUTO" : "MANUAL"}
          </Badge>
        </div>
        <p className="text-sm text-[var(--color-muted)] leading-relaxed">
          {aiSummary || "Belum ada keputusan AI. Tekan Start / Scan."}
        </p>
        <div className="text-xs text-[var(--color-subtle)]">
          Adaptive score: {describeWeights(weights)}
        </div>
      </div>

      <div className="panel space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium">Market regime</div>
          {regime ? (
            <Badge
              tone={
                regime.regime === "TREND_UP"
                  ? "buy"
                  : regime.regime === "CHOP" || regime.regime === "TREND_DOWN"
                    ? "sell"
                    : "muted"
              }
            >
              {regime.regime}
            </Badge>
          ) : (
            <Badge tone="muted">—</Badge>
          )}
          {regime ? (
            <Badge tone={regime.allowEntry ? "buy" : "sell"}>
              {regime.allowEntry ? "ENTRY ON" : "ENTRY OFF"}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-[var(--color-muted)] leading-relaxed">
          {regime?.reason ?? "Scan dulu untuk deteksi regime."}
        </p>
        {regime ? (
          <div className="grid grid-cols-3 gap-2 text-xs text-[var(--color-subtle)] tabular">
            <div>avg range {(regime.avgRangePos * 100).toFixed(0)}%</div>
            <div>breadth {(regime.breadth * 100).toFixed(0)}%</div>
            <div>tight {(regime.tightness * 100).toFixed(0)}%</div>
          </div>
        ) : null}
      </div>

      <div className="panel lg:col-span-2 overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-4 py-3 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
          AI decisions
        </div>
        {!decisions.length ? (
          <div className="p-6 text-sm text-[var(--color-muted)]">
            Keputusan BUY/SKIP per pair muncul di sini.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {decisions.map((d) => (
              <li
                key={d.pair}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium tabular">{d.pair}</span>
                  <Badge tone={d.action === "BUY" ? "buy" : "muted"}>
                    {d.action}
                  </Badge>
                  <span className="text-xs text-[var(--color-subtle)] tabular">
                    {(d.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="text-xs text-[var(--color-muted)] sm:max-w-md sm:text-right">
                  {d.reason}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
