import { createFileRoute } from "@tanstack/react-router";
import {
  Play,
  Square,
  RefreshCw,
  Settings2,
  TrendingUp,
  RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { isLiveEnabled } from "@/lib/neurotrend/types";
import { PLAYBOOKS, playbookOf } from "@/lib/neurotrend/playbook";
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
  } = useBotStore();

  const liveOn = isLiveEnabled(settings);

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
    a.pair.localeCompare(b.pair),
  );

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
            {aiSource === "grok" || grokStatus === "ok" ? (
              <Badge tone="buy">GROK PILOT</Badge>
            ) : aiSource === "gemini" ? (
              <Badge tone="buy">GEMINI</Badge>
            ) : (
              <Badge tone="muted">HEURISTIC</Badge>
            )}
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
          <Button
            type="button"
            variant="secondary"
            onClick={() => setTab("manual")}
          >
            Manual
          </Button>
          <Badge tone="buy">{playbookOf(settings.playbook).name}</Badge>
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
              Trik trade
            </div>
            <div className="text-[11px] text-[var(--color-subtle)]">
              {playbookOf(settings.playbook).note}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PLAYBOOKS.map((p) => {
              const on = settings.playbook === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    saveApiSettings({ playbook: p.id });
                    toast.success(`${p.name}: ${p.tagline}`);
                  }}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    on
                      ? "border-[var(--color-buy)] bg-[var(--color-buy)]/15 font-semibold"
                      : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)]/50"
                  }`}
                  title={p.tricks.join(" · ")}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
          <ul className="grid gap-1 text-[11px] text-[var(--color-muted)] sm:grid-cols-2">
            {playbookOf(settings.playbook).tricks.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
          {settings.playbook === "grid" && gridState?.pair ? (
            <div className="text-[11px] tabular text-[var(--color-accent)]">
              Pair {gridState.pair.replace("_idr", "").toUpperCase()} ·{" "}
              {(gridStepPct(settings.feeRate, settings.takeProfit) * 100).toFixed(1)}% step ·{" "}
              {gridState.adds} lot · last buy{" "}
              {gridState.lastBuyPx
                ? gridState.lastBuyPx.toLocaleString("id-ID")
                : "—"}
            </div>
          ) : null}
        </section>

        {openList.length > 0 ? (
          <section className="panel flex flex-wrap items-center gap-2 p-3 sm:p-4">
            <div className="mr-1 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
              Open pair
            </div>
            {openList.map((pos) => {
              const mark = prices[pos.pair] ?? pos.entryPrice;
              const pct = (mark / pos.entryPrice - 1) * 100;
              const up = pct >= 0;
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
                    holdMin={pos.setupHoldMin ?? 12}
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
          </div>
          {(() => {
            const pair = watchPair || openList[0]?.pair || "btc_idr";
            const pos = positions[pair];
            const pend = (pendingManual ?? []).find((p) => p.pair === pair);
            const mark =
              prices[pair] || pos?.entryPrice || opportunities.find((o) => o.pair === pair)?.price || 0;
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
                pair={pair}
                mark={mark}
                position={pos ?? null}
                limitPx={!pos ? limitPx : undefined}
                slPx={slFromPlan}
                tpPx={tpFromPlan}
                tf={watchTf || "15"}
                onTf={setWatchTf}
                gridLines={
                  settings.playbook === "grid" &&
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
