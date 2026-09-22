import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyOptimalToSettings,
  hardCapForCapital,
  packFromStyle,
  type OptimalPack,
  type RiskStyle,
} from "@/lib/neurotrend/capital-preset";
import type { BotSettings, TradingMode } from "@/lib/neurotrend/types";
import { PLAYBOOKS } from "@/lib/neurotrend/playbook";
import { formatIdr, formatIdrReal } from "@/lib/utils";

type CapitalMode = "optimal" | "manual";

function pctToDecimal(p: number): number {
  return Math.max(0.001, (p || 0) / 100);
}
function decimalToPctInput(d: number): string {
  return String(Math.round((d || 0) * 1000) / 10);
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function SettingsPanel({
  settings,
  realIdrBalance,
  apiStatus,
  grokStatus: _grokStatus,
  scaleWithEquity,
  riskMode,
  riskStyle,
  equityTier,
  liveEquity,
  onApplyRisk,
  onSaveApi,
  onTestApi,
  onTestGrok: _onTestGrok,
  onScaleWithEquity,
  onRiskMode,
  onRiskStyle,
  autoPlaybook,
  playbookWhy,
  onAutoPlaybook,
}: {
  settings: BotSettings;
  realIdrBalance: number | null;
  apiStatus: "unknown" | "ok" | "fail";
  grokStatus: "unknown" | "ok" | "fail";
  scaleWithEquity: boolean;
  riskMode: CapitalMode;
  riskStyle: RiskStyle;
  equityTier: OptimalPack | null;
  liveEquity: number;
  onApplyRisk: (
    s: BotSettings,
    opts?: { riskMode?: CapitalMode; riskStyle?: RiskStyle },
  ) => void;
  onSaveApi: (s: Partial<BotSettings>) => void;
  onTestApi: () => Promise<boolean>;
  onTestGrok: () => Promise<boolean>;
  onScaleWithEquity: (v: boolean) => void;
  onRiskMode: (mode: CapitalMode) => void;
  onRiskStyle: (style: RiskStyle) => void;
  autoPlaybook?: boolean;
  playbookWhy?: string;
  onAutoPlaybook?: (v: boolean) => void;
}) {
  const [draft, setDraft] = useState<BotSettings>(settings);
  const [testing, setTesting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const capitalMode = riskMode === "manual" ? "manual" : "optimal";

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const pack = useMemo(
    () => packFromStyle(draft.initialIdr, riskStyle),
    [draft.initialIdr, riskStyle],
  );
  const livePack = useMemo(
    () => equityTier ?? packFromStyle(liveEquity || draft.initialIdr, riskStyle),
    [equityTier, liveEquity, draft.initialIdr, riskStyle],
  );

  const setMode = (m: TradingMode) => {
    setDraft((d) => {
      const next = {
        ...d,
        tradingMode: m,
        paperOnly: m !== "live",
        iUnderstandLive: m === "live" ? d.iUnderstandLive : false,
      };
      if (capitalMode !== "optimal") return next;
      return applyOptimalToSettings(next, next.initialIdr, { style: riskStyle });
    });
  };

  const setCapitalModeUi = (mode: CapitalMode) => {
    onRiskMode(mode);
    if (mode === "optimal") {
      setDraft((d) => applyOptimalToSettings(d, d.initialIdr, { style: riskStyle }));
      toast.message("Mode Optimal — risk auto dari modal/tier");
    } else {
      toast.message("Mode Manual — max pair & risk bebas");
    }
  };

  const numField = (
    id: string,
    label: string,
    value: number | string,
    onChange: (n: number) => void,
    opts?: { step?: string; min?: string; max?: string; hint?: string },
  ) => (
    <div className="space-y-1.5" key={id}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        step={opts?.step ?? "1"}
        min={opts?.min}
        max={opts?.max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {opts?.hint ? (
        <p className="text-[11px] text-[var(--color-subtle)]">{opts.hint}</p>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 border border-[var(--color-buy)]/30 bg-[var(--color-buy)]/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium">Universe</div>
          <span className="rounded-full border border-[var(--color-buy)]/40 bg-[var(--color-buy)]/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-buy)]">
            Semua pair
          </span>
        </div>
        <p className="text-xs text-[var(--color-muted)] leading-relaxed">
          Scan pair likuid. Otak hybrid: CHOP = bounce, TREND = pullback/breakout,
          dump = diam. TP harus kalahkan fee. Cap max 25% modal / order.
        </p>
      </div>

      <div className="panel space-y-3 border border-[var(--color-border)] p-4 sm:p-5">
        <div>
          <div className="text-sm font-medium">Cloud AI — mati</div>
          <p className="mt-1 text-xs text-[var(--color-muted)] leading-relaxed">
            Grok / Gemini tidak dipanggil. Bot pakai mesin heuristic (gratis).
            API key cloud tidak terpakai, tidak ada biaya token.
          </p>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-elevated)]/40 px-3 py-2 text-xs text-[var(--color-subtle)]">
          Mode: HEURISTIC · BOUNCE / BREAKOUT · tanpa rotasi
        </div>
      </div>

      <div className="panel space-y-4 p-4 sm:p-5">
        <div>
          <div className="text-sm font-medium">Modal & risk</div>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Optimal = auto dari modal. Manual = bebas. Grok tetap boleh override
            taktik per scan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={capitalMode === "optimal" ? "default" : "secondary"}
            onClick={() => setCapitalModeUi("optimal")}
          >
            Optimal
          </Button>
          <Button
            type="button"
            size="sm"
            variant={capitalMode === "manual" ? "default" : "secondary"}
            onClick={() => setCapitalModeUi("manual")}
          >
            Manual
          </Button>
          {capitalMode === "optimal" ? (
            <label className="ml-auto flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                checked={scaleWithEquity}
                onChange={(e) => onScaleWithEquity(e.target.checked)}
              />
              Scale dengan equity
            </label>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-accent)]"
            checked={Boolean(draft.trade90Pct)}
            onChange={(e) => {
              const on = e.target.checked;
              setDraft((d) => ({ ...d, trade90Pct: on }));
              onSaveApi({ trade90Pct: on });
              toast.message(
                on
                  ? "90% equity ON — 1 order ≈ 90% modal"
                  : "90% equity OFF — size kembali ke cap biasa",
              );
            }}
          />
          Trade 90% equity per order
        </label>

        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["safe", "Aman", "2 pair · jarang entry"],
              ["balanced", "Seimbang", "3 pair · sedang"],
              ["aggressive", "Agresif ★", "pilihan terbaik · 4–5 pair"],
            ] as const
          ).map(([key, title, hint]) => {
            const p = packFromStyle(draft.initialIdr || 10_000_000, key);
            const on = riskStyle === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onRiskStyle(key);
                  setDraft((d) =>
                    applyOptimalToSettings(d, d.initialIdr, { style: key }),
                  );
                  toast.message(`${title} dipasang — tekan Simpan`);
                }}
                className={`rounded-[var(--radius-md)] border p-3 text-left transition ${
                  on
                    ? "border-[var(--color-buy)] bg-[var(--color-buy)]/10"
                    : "border-[var(--color-border)] hover:border-[var(--color-accent)]/50"
                }`}
              >
                <div className="text-sm font-semibold">{title}</div>
                <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">{hint}</div>
                <div className="mt-2 text-[11px] tabular text-[var(--color-subtle)]">
                  risk {(p.riskPerTrade * 100).toFixed(1)}% · pos {p.maxPositions} ·{" "}
                  {formatIdr(p.maxNotional)}/order
                </div>
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-[var(--color-subtle)]">
            Mesin trade
          </div>
          {PLAYBOOKS.map((p) => (
            <div
              key={p.id}
              className="rounded-[var(--radius-md)] border border-[var(--color-buy)] bg-[var(--color-buy)]/10 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{p.name}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-buy)]">
                  aktif
                </div>
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                {p.tagline}
              </div>
              <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--color-subtle)]">
                {p.tricks.map((t) => (
                  <li key={t}>· {t}</li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-[var(--color-muted)]">{p.note}</p>
            </div>
          ))}
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-accent)]/30 bg-[var(--color-accent-dim)]/20 p-3 space-y-1">
          <div className="text-xs text-[var(--color-subtle)]">Aktif sekarang</div>
          <div className="text-sm font-medium text-[var(--color-accent)]">
            {capitalMode === "manual"
              ? `Manual · ${draft.maxPositions} pair`
              : livePack.label}
          </div>
          <div className="text-xs text-[var(--color-muted)]">
            risk {(draft.riskPerTrade * 100).toFixed(1)}% · SL{" "}
            {(draft.stopLoss * 100).toFixed(1)}% · TP{" "}
            {(draft.takeProfit * 100).toFixed(1)}% · max pos {draft.maxPositions}
            · cap {formatIdr(draft.maxNotional)}/order
          </div>
          <div className="text-[11px] text-[var(--color-subtle)]">
            Circuit: rugi global {(draft.globalStopPct * 100).toFixed(0)}% → jual
            yang kena SL · untung global {(draft.globalTakePct * 100).toFixed(0)}% →
            jual semua + stop entry
          </div>
          <div className="pt-1 space-y-1.5">
            <div className="text-[11px] text-[var(--color-subtle)]">
              Timeout pair tertua
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([0, 1, 2, 3] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    (draft.timeExitHours || 0) === h
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-muted)]"
                  }`}
                  onClick={() => setDraft((d) => ({ ...d, timeExitHours: h }))}
                >
                  {h === 0 ? "Off" : `${h} jam`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="initialIdr">Modal (IDR)</Label>
          <Input
            id="initialIdr"
            type="number"
            inputMode="numeric"
            min={10000}
            step={1000}
            placeholder="Kosong — isi modal sendiri"
            value={draft.initialIdr > 0 ? draft.initialIdr : ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                setDraft((d) => ({ ...d, initialIdr: 0 }));
                return;
              }
              const v = Math.max(0, Math.round(Number(raw)) || 0);
              setDraft((d) =>
                v >= 10_000
                  ? applyOptimalToSettings({ ...d, initialIdr: v }, v, {
                      style: riskStyle,
                    })
                  : { ...d, initialIdr: v },
              );
            }}
          />
          <p className="text-[11px] text-[var(--color-subtle)]">
            Isi modal — risk, pair, SL/TP, dan cap order langsung ikut.
          </p>
          {realIdrBalance != null && realIdrBalance >= 10_000 ? (
            <button
              type="button"
              className="text-[11px] font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
              onClick={() => {
                const v = Math.round(realIdrBalance);
                setDraft((d) =>
                  applyOptimalToSettings({ ...d, initialIdr: v }, v, {
                    style: riskStyle,
                  }),
                );
                toast.message(`Modal diisi dari wallet ${formatIdrReal(v)}`);
              }}
            >
              Pakai saldo wallet {formatIdrReal(realIdrBalance)}
            </button>
          ) : null}
        </div>

        {capitalMode === "manual" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {numField("maxPositions", "Max positions", draft.maxPositions, (n) =>
              setDraft((d) => ({
                ...d,
                maxPositions: clamp(Math.round(n) || 1, 1, 5),
              })),
              { min: "1", max: "5" },
            )}
            {numField(
              "riskPct",
              "Risk / trade (%)",
              decimalToPctInput(draft.riskPerTrade),
              (n) => setDraft((d) => ({ ...d, riskPerTrade: pctToDecimal(n) })),
              { step: "0.1" },
            )}
            {numField(
              "slPct",
              "Stop loss (%)",
              decimalToPctInput(draft.stopLoss),
              (n) => setDraft((d) => ({ ...d, stopLoss: pctToDecimal(n) })),
              { step: "0.1" },
            )}
            {numField(
              "tpPct",
              "Take profit (%)",
              decimalToPctInput(draft.takeProfit),
              (n) => setDraft((d) => ({ ...d, takeProfit: pctToDecimal(n) })),
              { step: "0.1" },
            )}
            {numField(
              "minScore",
              "Min score",
              draft.minScoreToBuy,
              (n) =>
                setDraft((d) => ({
                  ...d,
                  minScoreToBuy: clamp(Math.round(n) || 55, 40, 99),
                })),
            )}
            {numField(
              "maxNotional",
              "Max notional / order (IDR)",
              draft.maxNotional,
              (n) =>
                setDraft((d) => ({
                  ...d,
                  maxNotional: Math.min(
                    hardCapForCapital(d.initialIdr),
                    Math.max(10_000, Math.round(n) || 10_000),
                  ),
                })),
            )}
            {numField(
              "scanSec",
              "Scan interval (detik)",
              draft.scanIntervalSec,
              (n) =>
                setDraft((d) => ({
                  ...d,
                  scanIntervalSec: clamp(Math.round(n) || 30, 15, 300),
                })),
            )}
          </div>
        ) : (
          <div className="text-xs text-[var(--color-muted)]">
            Tier: <strong>{pack.label}</strong> · risk{" "}
            {(pack.riskPerTrade * 100).toFixed(1)}% · maxPos {pack.maxPositions} ·{" "}
            {formatIdr(pack.maxNotional)}/order
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={draft.tradingMode !== "live" ? "default" : "secondary"}
            onClick={() => setMode("paper")}
          >
            PAPER
          </Button>
          <Button
            type="button"
            size="sm"
            variant={draft.tradingMode === "live" ? "default" : "secondary"}
            onClick={() => setMode("live")}
          >
            LIVE
          </Button>
        </div>
        {draft.tradingMode === "live" ? (
          <label className="flex items-center gap-2 text-xs text-[var(--color-sell)]">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={draft.iUnderstandLive}
              onChange={(e) =>
                setDraft((d) => ({ ...d, iUnderstandLive: e.target.checked }))
              }
            />
            Saya paham order REAL. Key TRADE only, jangan Withdraw.
          </label>
        ) : null}

        <Button
          type="button"
          onClick={() => {
            if (draft.initialIdr < 10_000) {
              toast.error("Isi modal dulu (min Rp 10.000)");
              return;
            }
            const next =
              capitalMode === "optimal"
                ? applyOptimalToSettings(draft, draft.initialIdr, {
                    style: riskStyle,
                  })
                : {
                    ...draft,
                    paperOnly: draft.tradingMode !== "live",
                    maxPositions: clamp(Math.round(draft.maxPositions) || 1, 1, 5),
                  };
            onApplyRisk(next, { riskMode: capitalMode, riskStyle });
            toast.success(
              `Tersimpan · max ${next.maxPositions} pair · ${formatIdr(next.maxNotional)}/order`,
            );
          }}
        >
          Simpan setingan & reset portfolio
        </Button>
      </div>

      <div className="panel space-y-4 p-4 sm:p-5">
        <div>
          <div className="text-sm font-medium">Indodax API</div>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Key lokal di browser. View + Trade saja.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apiKey">API Key</Label>
          <Input
            id="apiKey"
            value={draft.apiKey}
            autoComplete="off"
            onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value.trim() }))}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <Label htmlFor="apiSecret">Secret</Label>
            <button
              type="button"
              className="text-xs text-[var(--color-muted)]"
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? "Hide" : "Show"}
            </button>
          </div>
          <Input
            id="apiSecret"
            type={showSecret ? "text" : "password"}
            value={draft.apiSecret}
            autoComplete="off"
            onChange={(e) =>
              setDraft((d) => ({ ...d, apiSecret: e.target.value.trim() }))
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => {
              onSaveApi({ apiKey: draft.apiKey, apiSecret: draft.apiSecret });
              toast.success("Indodax key disimpan");
            }}
          >
            Simpan API
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={testing}
            onClick={async () => {
              onSaveApi({ apiKey: draft.apiKey, apiSecret: draft.apiSecret });
              setTesting(true);
              const ok = await onTestApi();
              setTesting(false);
              if (ok) toast.success("Indodax OK");
              else toast.error("Indodax gagal");
            }}
          >
            {testing ? "Testing…" : "Test Indodax"}
          </Button>
          <span className="text-xs text-[var(--color-muted)]">
            Status: {apiStatus === "ok" ? "OK" : apiStatus === "fail" ? "Gagal" : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
