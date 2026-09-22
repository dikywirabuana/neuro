import { createFileRoute } from "@tanstack/react-router";
import {
  Play,
  Square,
  RefreshCw,
  Settings2,
  TrendingUp,
  RotateCcw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ActivityLog } from "@/components/dashboard/activity-log";
import { AiPanel } from "@/components/dashboard/ai-panel";
import { EquityChart } from "@/components/dashboard/equity-chart";
import { HoldCountdown } from "@/components/dashboard/hold-timer";
import { MetricCard } from "@/components/dashboard/metric-card";
import { WatchChart } from "@/components/dashboard/candle-chart";
import { ChartSearch } from "@/components/dashboard/chart-search";
import { PortfolioPanel } from "@/components/dashboard/portfolio-panel";
import { RadioPlayer } from "@/components/dashboard/radio-player";
import { SettingsPanel } from "@/components/dashboard/settings-panel";
import { SignalsTable } from "@/components/dashboard/signals-table";
import { TradesTable } from "@/components/dashboard/trades-table";
import { WalletPanel } from "@/components/dashboard/wallet-panel";
import { ManualTradePanel } from "@/components/dashboard/manual-trade";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBotStore } from "@/lib/neurotrend/store";
import {
  acquireWakeLock,
  onBackgroundTick,
  registerNeuroSw,
} from "@/lib/neurotrend/background";
import { isLiveEnabled, timeExitHoursOf } from "@/lib/neurotrend/types";
import { playbookOf } from "@/lib/neurotrend/playbook";
import { gridLevels, gridStepPct } from "@/lib/neurotrend/grid";
import { formatIdr, formatPct } from "@/lib/utils";


export const Route = createFileRoute("/")({
  component: DashboardPage,
});

type Tab =
  | "ai"
  | "signals"
  | "manual"
  | "wallet"
  | "portfolio"
  | "trades"
  | "equity"
  | "settings"
  | "log";

function DashboardPage() {
  const [tab, setTab] = useState<Tab>("signals");
  const [plan, setPlan] = useState<{
    pair: string;
    limit: number;
    slPct: number;
    tpPct: number;
  } | null>(null);
  const [chartQ, setChartQ] = useState("");
  const {
    settings,
    running,
    wantRunning,
    lastScanAt,
    lastQuoteAt,
    source,
    opportunities,
    prices,
    positions,
    trades,
    equityHistory,
    summary,
    logs,
    error,
    realIdrBalance,
    wallet,
    walletAt,
    walletBusy,
    openOrders,
    apiStatus,
    grokStatus,
    regime,
    weights,
    aiSource,
    aiSummary,
    aiDecisions,
    autoTrade,
    scaleWithEquity,
    riskMode,
    riskStyle,
    equityTier,
    start,
    stop,
    resetPortfolio,
    scanOnce,
    ensureLiveQuotes,
    closePair,
    closeAllPairs,
    refreshWallet,
    sellWalletCoin,
    sellAllWallet,
    cancelExchangeOrder,
    cancelAllExchangeOrders,
    applySettingsAndReset,
    setRiskMode,
    setRiskStyle,
    saveApiSettings,
    testApiConnection,
    testGrokConnection,
    setAutoTrade,
    setScaleWithEquity,
    manualBuy,
    setStops,
    pendingManual,
    cancelPendingManual,
    watchPair,
    watchTf,
    setWatchPair,
    setWatchTf,
    manualSell,
    gridState,
    autoPlaybook,
    playbookWhy,
    setAutoPlaybook,
  } = useBotStore();

  const liveOn = isLiveEnabled(settings);

  useEffect(() => {
    try {
      sessionStorage.removeItem("nt-chunk-reload");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    ensureLiveQuotes();
    const t = window.setTimeout(() => {
      void scanOnce();
    }, 400);
    return () => clearTimeout(t);
  }, [ensureLiveQuotes, scanOnce]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void registerNeuroSw();
    const unsubTick = onBackgroundTick(() => {
      const s = useBotStore.getState();
      if (s.wantRunning) void s.scanOnce();
    });
    const boot = () => {
      const s = useBotStore.getState();
      if (s.wantRunning && !s.running && s.settings.initialIdr >= 10_000) {
        s.start();
      }
    };
    const unsubHydrate = useBotStore.persist.onFinishHydration(() => boot());
    if (useBotStore.persist.hasHydrated()) boot();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        boot();
        if (useBotStore.getState().wantRunning) void acquireWakeLock();
      }
    };
    window.addEventListener("pageshow", boot);
    window.addEventListener("focus", boot);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      unsubTick();
      unsubHydrate();
      window.removeEventListener("pageshow", boot);
      window.removeEventListener("focus", boot);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (tab === "wallet") void refreshWallet();
  }, [tab, refreshWallet]);

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const quoteAgeSec =
    lastQuoteAt != null
      ? Math.max(0, Math.round((nowTick - lastQuoteAt) / 1000))
      : null;
  const quotesLive =
    lastQuoteAt != null && quoteAgeSec != null && quoteAgeSec < 12;

  const tabs: { id: Tab; label: string }[] = [
    { id: "ai", label: "AI" },
    { id: "signals", label: "Signals" },
    { id: "manual", label: "Manual" },
    { id: "wallet", label: "Wallet" },
    { id: "portfolio", label: "Portfolio" },
    { id: "trades", label: "Trades" },
    { id: "equity", label: "Equity" },
    { id: "settings", label: "Settings" },
    { id: "log", label: "Log" },
  ];

  const openList = Object.values(positions).sort((a, b) =>
    b.entryTime - a.entryTime,
  );
  const openSig = openList.map((p) => p.pair).join(",");
  const prevOpenSig = useRef("");
  useEffect(() => {
    if (!openSig) {
      prevOpenSig.current = "";
      return;
    }
    if (openSig === prevOpenSig.current) return;
    const prev = new Set(prevOpenSig.current.split(",").filter(Boolean));
    const added = openList.map((p) => p.pair).filter((p) => !prev.has(p));
    prevOpenSig.current = openSig;
    const target = added[0] || openList[0]?.pair;
    if (target) {
      setWatchPair(target);
      setChartQ(target);
    }
  }, [openSig, setWatchPair]);

  return (
    <div className="min-h-dvh bg-[var(--color-bg)] pb-28 text-[var(--color-fg)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 pt-[var(--grok-banner-h,0px)] backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]">
              <TrendingUp className="h-4 w-4 text-[var(--color-accent)]" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight sm:text-base">
                NeuroTrend AI
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                Indodax · RSI/MACD/BB/EMA · scan 30s
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="buy">ALL PAIRS</Badge>
            <Badge tone={liveOn ? "sell" : "muted"}>
              {liveOn ? "LIVE" : "PAPER"}
            </Badge>
            <Badge tone={source === "live" ? "buy" : "warn"}>
              feed {source}
            </Badge>
            <Badge tone="muted">HEURISTIC</Badge>
            {riskMode === "manual" ? (
              <Badge tone="warn">MANUAL</Badge>
            ) : scaleWithEquity ? (
              <Badge tone="muted">SCALE EQ</Badge>
            ) : null}
            {running || wantRunning ? (
              <Badge tone="buy">{running ? "RUNNING · BG" : "LANJUT…"}</Badge>
            ) : (
              <Badge tone="muted">IDLE</Badge>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-sell)]/40 bg-[var(--color-sell)]/10 px-4 py-3 text-sm text-[var(--color-sell)]">
            {error}
          </div>
        ) : null}

        {settings.initialIdr < 10_000 ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-3 text-xs sm:text-sm">
            Modal masih kosong. Buka Settings, isi modal sendiri, lalu Simpan.
            Equity akan berkembang dari hasil trade.
          </div>
        ) : null}

        {liveOn ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-sell)]/40 bg-[var(--color-sell)]/10 px-4 py-3 text-xs sm:text-sm text-[var(--color-sell)]">
            LIVE aktif — order real. Hard cap {formatIdr(settings.maxNotional)} / order. Key TRADE only.
          </div>
        ) : null}

        <section className="flex flex-wrap items-center gap-2">
          {!running ? (
            <Button
              type="button"
              onClick={() => {
                if (settings.initialIdr < 10_000) {
                  toast.error("Isi modal di Settings dulu");
                  setTab("settings");
                  return;
                }
                start();
                toast.success("Autopilot ON · scan semua pair");
              }}
            >
              <Play className="h-4 w-4" />
              Start
            </Button>
          ) : (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                stop();
                toast.message("Autopilot stopped");
              }}
            >
              <Square className="h-4 w-4" />
              Stop
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void scanOnce();
              toast.message("Scan…");
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Scan
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setAutoTrade(!autoTrade);
              toast.message(autoTrade ? "Auto-trade OFF" : "Auto-trade ON");
            }}
          >
            Auto {autoTrade ? "ON" : "OFF"}
          </Button>
          <label className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-xs font-medium">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              checked={Boolean(settings.trade90Pct)}
              onChange={(e) => {
                const on = e.target.checked;
                saveApiSettings({ trade90Pct: on });
                toast.message(on ? "90% equity ON" : "90% equity OFF");
              }}
            />
            90% equity
          </label>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setTab("manual")}
          >
            Manual
          </Button>
          <Badge tone="buy">
            {playbookOf(settings.playbook).name}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (confirm("Reset portfolio paper?")) {
                resetPortfolio();
                toast.message("Portfolio reset");
              }
            }}
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setTab("settings")}
          >
            <Settings2 className="h-4 w-4" />
            Settings
          </Button>
          <div className="ml-auto text-xs text-[var(--color-muted)]">
            {lastScanAt
              ? `scan ${new Date(lastScanAt).toLocaleTimeString("id-ID")}`
              : "belum scan"}
            {regime ? ` · ${regime.regime}` : ""}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          <MetricCard
            label="Equity"
            value={formatIdr(summary.equity)}
            live={quotesLive}
            hint={
              liveOn
                ? `total aset${quotesLive ? ` · ${quoteAgeSec}s` : ""}`
                : quotesLive
                  ? `tick ${quoteAgeSec}s · Indodax`
                  : "menunggu quote…"
            }
          />
          <MetricCard
            label="Cash"
            value={formatIdr(summary.cash)}
            live={quotesLive}
          />
          <MetricCard
            label="Open"
            value={String(summary.openPositions)}
            hint={`max ${settings.maxPositions}`}
            live={quotesLive && summary.openPositions > 0}
          />
          <MetricCard
            label="Unrealized"
            value={formatIdr(summary.unrealizedPnl)}
            live={quotesLive && summary.openPositions > 0}
            tone={
              summary.unrealizedPnl > 0
                ? "up"
                : summary.unrealizedPnl < 0
                  ? "down"
                  : "default"
            }
          />
          <MetricCard
            label="Return"
            value={formatPct(summary.returnPct)}
            live={quotesLive}
            tone={
              summary.returnPct > 0
                ? "up"
                : summary.returnPct < 0
                  ? "down"
                  : "default"
            }
          />
          <MetricCard
            label="Win rate"
            value={`${(summary.winRate ?? 0).toFixed(0)}%`}
            hint={`${summary.tradeCount} trades`}
          />
          <MetricCard
            label="Max DD"
            value={`${(summary.maxDrawdown ?? 0).toFixed(1)}%`}
            tone={(summary.maxDrawdown ?? 0) > 8 ? "down" : "default"}
          />
          <MetricCard
            label="Daily loss"
            value={formatIdr(summary.dailyLoss ?? 0)}
            hint={`limit ${formatIdr(summary.dailyLossLimit ?? settings.initialIdr * 0.05)}`}
            tone={(summary.dailyLoss ?? 0) > 0 ? "down" : "default"}
          />
        </section>

        <section className="panel space-y-2 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
              Mesin trade
            </div>
            <div className="text-[11px] text-[var(--color-subtle)]">
              {playbookWhy || "Smart agresif"}
            </div>
          </div>
          <div className="rounded-full border border-[var(--color-buy)] bg-[var(--color-buy)]/15 px-2.5 py-1 text-xs font-semibold inline-block">
            {playbookOf(settings.playbook).name}
          </div>
          <ul className="grid gap-1 text-[11px] text-[var(--color-muted)] sm:grid-cols-2">
            {playbookOf(settings.playbook).tricks.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </section>

        {openList.length > 0 ? (
          <section className="panel flex flex-wrap items-center gap-2 p-3 sm:p-4">
            <div className="mr-1 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
              Open pair
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-subtle)]">
              <span>Lock +2% equity → jual semua</span>
              <span className="text-[var(--color-muted)]">Timeout:</span>
              {([0, 1, 2, 3] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    timeExitHoursOf(settings) === h
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-muted)]"
                  }`}
                  onClick={() => {
                    saveApiSettings({ timeExitHours: h });
                    toast.message(
                      h === 0
                        ? "Timeout OFF — hanya TP / SL"
                        : `Timeout ${h} jam — pair tertua dijual paksa`,
                    );
                  }}
                >
                  {h === 0 ? "Off" : `${h} jam`}
                </button>
              ))}
            </div>
            {openList.map((pos) => {
              const mark = prices[pos.pair] ?? pos.entryPrice;
              const pct = (mark / pos.entryPrice - 1) * 100;
              const up = pct >= 0;
              const oldestTs = Math.min(...openList.map((p) => p.entryTime));
              const hours = timeExitHoursOf(settings);
              const timed = hours > 0 && pos.entryTime === oldestTs;
              return (
                <div
                  key={pos.pair}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setWatchPair(pos.pair);
                    setChartQ(pos.pair);
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs cursor-pointer ${
                    watchPair === pos.pair
                      ? "ring-1 ring-[var(--color-accent)]"
                      : ""
                  } ${
                    up
                      ? "border-[var(--color-buy)]/25 bg-[var(--color-buy)]/10"
                      : "border-[var(--color-sell)]/25 bg-[var(--color-sell)]/10"
                  }`}
                >
                  <span className="font-semibold tabular">
                    {pos.pair.replace("_idr", "").toUpperCase()}
                  </span>
                  <span
                    className={`tabular ${
                      up
                        ? "text-[var(--color-buy)]"
                        : "text-[var(--color-sell)]"
                    }`}
                  >
                    {formatPct(pct)}
                  </span>
                  <HoldCountdown
                    entryTime={pos.entryTime}
                    compact
                    holdMin={timed ? hours * 60 : undefined}
                  />
                  <button
                    type="button"
                    className="rounded-full bg-[var(--color-sell)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-sell)] hover:bg-[var(--color-sell)]/25"
                    onClick={(e) => {
                      e.stopPropagation();
                      void (async () => {
                        toast.message(`Menjual ${pos.pair.replace("_idr", "").toUpperCase()}…`);
                        const ok = await closePair(pos.pair);
                        if (ok) {
                          toast.success(
                            `${pos.pair.replace("_idr", "").toUpperCase()} terjual — posisi ditutup`,
                          );
                        } else {
                          toast.error("Jual gagal — cek Log");
                        }
                      })();
                    }}
                  >
                    Jual
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="ml-auto text-xs font-medium text-[var(--color-sell)] underline-offset-2 hover:underline"
              onClick={() => {
                if (
                  confirm(`Jual semua ${openList.length} pair open?`)
                ) {
                  void closeAllPairs();
                }
              }}
            >
              Jual semua
            </button>
          </section>
        ) : null}

        <section className="space-y-2">
          <div className="panel flex flex-wrap items-end gap-2 p-3 sm:p-4">
            <ChartSearch
              onPick={(p) => {
                setWatchPair(p);
                setChartQ(p);
              }}
              activePair={watchPair}
              opportunities={opportunities}
              prices={prices}
            />
            <div className="text-[11px] text-[var(--color-subtle)] pb-2">
              Ketik ticker, pilih dari daftar. Jangan ketik _idr.
            </div>
            {openList.length > 0 ? (
              <div className="flex w-full flex-wrap items-center gap-1 pb-1">
                <span className="mr-1 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  Chart pair
                </span>
                {openList.map((pos) => {
                  const on = watchPair === pos.pair;
                  const markP = prices[pos.pair] ?? pos.entryPrice;
                  const pct = pos.entryPrice > 0 ? (markP / pos.entryPrice - 1) * 100 : 0;
                  return (
                    <button
                      key={`chart-${pos.pair}`}
                      type="button"
                      onClick={() => {
                        setWatchPair(pos.pair);
                        setChartQ(pos.pair);
                      }}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular ${
                        on
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white"
                          : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-white"
                      }`}
                    >
                      {pos.pair.replace("_idr", "").toUpperCase()}{" "}
                      <span className={pct >= 0 ? "text-[var(--color-buy)]" : "text-[var(--color-sell)]"}>
                        {formatPct(pct)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {(() => {
            const openPairs = openList.map((p) => p.pair);
            const primary =
              (watchPair && openPairs.includes(watchPair)
                ? watchPair
                : openPairs[0]) ||
              watchPair ||
              "btc_idr";
            const secondary = openPairs.find((p) => p !== primary);
            const chartPairs = secondary ? [primary, secondary] : [primary];

            const renderOne = (pair: string) => {
              const pos = positions[pair];
              const pend = (pendingManual ?? []).find((p) => p.pair === pair);
              const mark =
                prices[pair] ||
                pos?.entryPrice ||
                opportunities.find((o) => o.pair === pair)?.price ||
                0;
              const planHere = plan?.pair === pair ? plan : null;
              const limitPx = pend?.limitPx || planHere?.limit || 0;
              const slFromPlan =
                !pos && limitPx > 0 && (planHere?.slPct || pend?.slPct)
                  ? limitPx * (1 - (planHere?.slPct || pend?.slPct || 0))
                  : undefined;
              const tpFromPlan =
                !pos && limitPx > 0 && (planHere?.tpPct || pend?.tpPct)
                  ? limitPx * (1 + (planHere?.tpPct || pend?.tpPct || 0))
                  : undefined;
              return (
                <WatchChart
                  key={pair}
                  pair={pair}
                  mark={mark}
                  position={pos ?? null}
                  limitPx={!pos ? limitPx : undefined}
                  slPx={slFromPlan}
                  tpPx={tpFromPlan}
                  tf={watchTf || "15"}
                  onTf={setWatchTf}
                  gridLines={
                    gridState?.pair === pair &&
                    gridState.anchor > 0
                      ? gridLevels(
                          gridState.anchor,
                          gridStepPct(settings.feeRate, settings.takeProfit),
                        )
                      : undefined
                  }
                />
              );
            };

            return (
              <div
                className={`grid gap-3 ${
                  chartPairs.length > 1 ? "lg:grid-cols-2" : ""
                }`}
              >
                {chartPairs.map((p) => renderOne(p))}
              </div>
            );
          })()}
        </section>

        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] pb-px">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-t-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-[var(--color-surface)] text-[var(--color-fg)] border border-b-transparent border-[var(--color-border)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <section className="min-h-[280px]">
          {tab === "ai" && (
            <AiPanel
              regime={regime}
              weights={weights}
              aiSource={aiSource}
              aiSummary={aiSummary}
              decisions={aiDecisions}
              autoTrade={autoTrade}
            />
          )}
          {tab === "signals" && (
            <SignalsTable
              rows={opportunities}
              focusLabel="Hybrid: bounce (chop) · pullback/breakout (tren) · klik baris = chart"
              onPick={(p) => {
                setWatchPair(p);
                setChartQ(p);
              }}
              activePair={watchPair}
            />
          )}
          {tab === "manual" && (
            <ManualTradePanel
              opportunities={opportunities}
              prices={prices}
              cash={summary.cash}
              maxNotional={settings.maxNotional}
              positions={positions}
              wallet={wallet}
              watchPair={watchPair}
              live={liveOn}
              gridState={gridState}
              feeRate={settings.feeRate}
              takeProfit={settings.takeProfit}
              onBuy={manualBuy}
              onSell={manualSell}
              onSetStops={setStops}
              pendingManual={pendingManual}
              onCancelLimit={cancelPendingManual}
              onWatch={(p) => {
                setWatchPair(p.pair);
                setPlan(p);
              }}
            />
          )}
          {tab === "wallet" && (
            <WalletPanel
              wallet={wallet}
              openOrders={openOrders}
              walletAt={walletAt}
              apiStatus={apiStatus}
              busy={walletBusy}
              trades={trades}
              positions={positions}
              opportunities={opportunities}
              onRefresh={refreshWallet}
              onSellCoin={sellWalletCoin}
              onSellAll={sellAllWallet}
              onCancelOrder={cancelExchangeOrder}
              onCancelAllOrders={cancelAllExchangeOrders}
            />
          )}
          {tab === "portfolio" && (
            <PortfolioPanel
              positions={positions}
              prices={prices}
              onSellPair={closePair}
              onSellAll={closeAllPairs}
            />
          )}
          {tab === "trades" && <TradesTable trades={trades} />}
          {tab === "equity" && <EquityChart history={equityHistory} />}
          {tab === "settings" && (
            <SettingsPanel
              settings={settings}
              realIdrBalance={realIdrBalance}
              apiStatus={apiStatus}
              grokStatus={grokStatus}
              scaleWithEquity={scaleWithEquity}
              riskMode={riskMode}
              riskStyle={riskStyle}
              equityTier={equityTier}
              liveEquity={summary.equity}
              onApplyRisk={applySettingsAndReset}
              onSaveApi={saveApiSettings}
              onTestApi={testApiConnection}
              onTestGrok={testGrokConnection}
              onScaleWithEquity={setScaleWithEquity}
              onRiskMode={setRiskMode}
              onRiskStyle={setRiskStyle}
              autoPlaybook={autoPlaybook}
              playbookWhy={playbookWhy}
              onAutoPlaybook={setAutoPlaybook}
            />
          )}
          {tab === "log" && <ActivityLog logs={logs} />}
        </section>

        <footer className="pb-6 text-center text-[11px] text-[var(--color-subtle)]">
          {summary.tradeCount} trades · semua pair · cap {formatIdr(settings.maxNotional)} · not financial advice
        </footer>
      </main>
      <RadioPlayer />
    </div>
  );
}
