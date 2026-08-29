import { HoldCountdown } from "@/components/dashboard/hold-timer";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Position } from "@/lib/neurotrend/types";
import { formatNum } from "@/lib/utils";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

const TFS = [
  ["1", "1m"],
  ["15", "15m"],
  ["30", "30m"],
  ["60", "1h"],
  ["240", "4h"],
] as const;

const UP = "#26a69a";
const DN = "#ef5350";
const GRID = "#1e2733";
const MUTED = "#8b95a2";

function tfMs(tf: string): number {
  if (tf === "1D") return 86_400_000;
  const n = Number(tf);
  return (Number.isFinite(n) && n > 0 ? n : 15) * 60_000;
}

function ema(values: number[], period: number): (number | null)[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      acc += values[i];
      out.push(null);
      continue;
    }
    if (i === period - 1) {
      acc += values[i];
      prev = acc / period;
      out.push(prev);
      continue;
    }
    prev = values[i] * k + (prev as number) * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let ag = gain / period;
  let al = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function pathOf(
  series: (number | null)[],
  xOf: (i: number) => number,
  yOf: (v: number) => number,
): string {
  return series
    .map((v, i) => {
      if (v == null) return "";
      const cmd = i === 0 || series[i - 1] == null ? "M" : "L";
      return `${cmd}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`;
    })
    .join(" ");
}

export function WatchChart({
  pair,
  mark,
  position,
  limitPx,
  slPx,
  tpPx,
  tf,
  onTf,
  gridLines,
}: {
  pair: string;
  mark: number;
  position?: Position | null;
  limitPx?: number;
  slPx?: number;
  tpPx?: number;
  tf: string;
  onTf: (tf: string) => void;
  gridLines?: number[];
}) {
  const [bars, setBars] = useState<Bar[]>([]);
  const [status, setStatus] = useState<"load" | "ok" | "empty">("load");
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(
    null,
  );
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!pair) return;
    let live = true;
    const load = async () => {
      setStatus((s) => (s === "ok" ? s : "load"));
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8_000);
      try {
        const res = await fetch(
          `/api/indodax/ohlc?pair=${encodeURIComponent(pair)}&tf=${tf}`,
          { signal: ac.signal },
        );
        const json = (await res.json()) as { bars?: Bar[] };
        if (!live) return;
        const next = Array.isArray(json.bars) ? json.bars : [];
        setBars(next);
        setStatus(next.length ? "ok" : "empty");
      } catch {
        if (live) {
          setBars([]);
          setStatus("empty");
        }
      } finally {
        clearTimeout(timer);
      }
    };
    void load();
    const poll = tf === "1" ? 8_000 : 20_000;
    const id = setInterval(() => void load(), poll);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [pair, tf]);

  useEffect(() => {
    if (!(mark > 0) || !pair) return;
    setBars((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      const bucket = tfMs(tf);
      const copy = prev.slice();
      if (Date.now() - last.t < bucket) {
        copy[copy.length - 1] = {
          ...last,
          c: mark,
          h: Math.max(last.h, mark),
          l: Math.min(last.l, mark) || mark,
        };
      } else {
        copy.push({
          t: Date.now(),
          o: last.c,
          h: Math.max(last.c, mark),
          l: Math.min(last.c, mark),
          c: mark,
          v: 0,
        });
        if (copy.length > 100) copy.shift();
      }
      return copy;
    });
  }, [mark, pair, tf]);

  const closes = useMemo(() => bars.map((b) => b.c), [bars]);
  const ema9 = useMemo(() => ema(closes, 9), [closes]);
  const ema21 = useMemo(() => ema(closes, 21), [closes]);
  const lastRsi = useMemo(() => rsi(closes, 14), [closes]);

  const W = 860;
  const H = 420;
  const padL = 12;
  const padR = 78;
  const padT = 16;
  const volH = 62;
  const timeH = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - volH - timeH - 8;

  const entry = position?.entryPrice;
  const sl = position?.stopLoss ?? slPx;
  const tp = position?.takeProfit ?? tpPx;
  const limit = limitPx && limitPx > 0 ? limitPx : undefined;
  const levels = [entry, sl, tp, limit, mark, ...(gridLines ?? [])].filter(
    (n): n is number => typeof n === "number" && n > 0,
  );
  const lo = bars.length
    ? Math.min(...bars.map((b) => b.l), ...levels)
    : mark || 0;
  const hiPx = bars.length
    ? Math.max(...bars.map((b) => b.h), ...levels)
    : mark || 1;
  const span = Math.max(hiPx - lo, (hiPx || 1) * 0.004, 1e-9);
  const padPx = span * 0.04;
  const yLo = lo - padPx;
  const yHi = hiPx + padPx;
  const ySpan = yHi - yLo || 1;
  const yOf = (px: number) => padT + ((yHi - px) / ySpan) * plotH;
  const n = Math.max(bars.length, 1);
  const gap = plotW / n;
  const bodyW = Math.max(2.2, Math.min(9, gap * 0.7));
  const xOf = (i: number) => padL + i * gap + gap / 2;
  const maxVol = Math.max(1, ...bars.map((b) => b.v));
  const volY = padT + plotH + 10;
  const last = bars[bars.length - 1];
  const first = bars[0];
  const pxNow = mark || last?.c || 0;
  const chg =
    first && first.o > 0 ? ((pxNow - first.o) / first.o) * 100 : 0;
  const up = chg >= 0;
  const hoverBar = hover ? bars[hover.i] : null;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el || !bars.length) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const i = Math.max(0, Math.min(bars.length - 1, Math.floor((x - padL) / gap)));
    setHover({ i, x: xOf(i), y });
  };

  if (!pair) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-xl border border-[var(--color-border)] bg-[#0b0f14] text-xs text-[var(--color-muted)]">
        Pilih koin untuk melihat chart
      </div>
    );
  }

  const ticker = pair.replace("_idr", "").toUpperCase();
  const gridPx = [0, 0.25, 0.5, 0.75, 1].map((p) => yHi - ySpan * p);

  return (
    <div className="overflow-hidden rounded-xl border border-[#1e2733] bg-[#0b0f14]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1e2733] px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div className="text-base font-semibold tracking-wide">{ticker}/IDR</div>
          <span
            className={`text-lg font-semibold tabular ${
              up ? "text-[#26a69a]" : "text-[#ef5350]"
            }`}
          >
            {formatNum(pxNow, pxNow < 10 ? 4 : 0)}
          </span>
          <span
            className={`text-xs tabular ${
              up ? "text-[#26a69a]" : "text-[#ef5350]"
            }`}
          >
            {chg >= 0 ? "+" : ""}
            {chg.toFixed(2)}%
          </span>
          {lastRsi != null ? (
            <span className="text-[11px] tabular text-[#8b95a2]">
              RSI {lastRsi.toFixed(0)}
            </span>
          ) : null}
          <span className="text-[11px] text-[#f5c542]">EMA9</span>
          <span className="text-[11px] text-[#7eb6ff]">EMA21</span>
          {position ? (
            <HoldCountdown
              entryTime={position.entryTime}
              holdMin={position.setupHoldMin ?? 12}
            />
          ) : null}
        </div>
        <div className="flex gap-0.5 rounded-md bg-[#121821] p-0.5">
          {TFS.map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => onTf(t)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium ${
                tf === t
                  ? "bg-[#1e2a3a] text-white"
                  : "text-[#8b95a2] hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {status === "load" && !bars.length ? (
        <div className="flex h-[420px] items-center justify-center text-xs text-[#8b95a2]">
          Memuat candle…
        </div>
      ) : status === "empty" ? (
        <div className="flex h-[420px] flex-col items-center justify-center gap-2 text-xs text-[#8b95a2]">
          <div>Chart belum ke-load. Coba timeframe lain atau refresh.</div>
          {mark > 0 ? (
            <div className="tabular text-white">Last {formatNum(mark, mark < 10 ? 4 : 0)}</div>
          ) : null}
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-[420px] w-full"
            role="img"
            aria-label={`Candlestick ${pair}`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <rect width={W} height={H} fill="#0b0f14" />

            {gridPx.map((px) => {
              const y = yOf(px);
              return (
                <g key={px}>
                  <line
                    x1={padL}
                    x2={W - padR}
                    y1={y}
                    y2={y}
                    stroke={GRID}
                    strokeWidth={1}
                  />
                  <text
                    x={W - padR + 6}
                    y={y + 3}
                    fill={MUTED}
                    fontSize="10"
                    fontFamily="ui-monospace, monospace"
                  >
                    {formatNum(px, px < 10 ? 4 : 0)}
                  </text>
                </g>
              );
            })}

            {bars.map((b, i) => {
              const x = xOf(i);
              const bull = b.c >= b.o;
              const color = bull ? UP : DN;
              const h = Math.max(1, (b.v / maxVol) * volH);
              return (
                <rect
                  key={`v-${b.t}`}
                  x={x - bodyW / 2}
                  y={volY + volH - h}
                  width={bodyW}
                  height={h}
                  fill={color}
                  opacity={0.35}
                />
              );
            })}

            {bars.map((b) => {
              const i = bars.indexOf(b);
              const x = xOf(i);
              const bull = b.c >= b.o;
              const color = bull ? UP : DN;
              const yH = yOf(b.h);
              const yL = yOf(b.l);
              const yO = yOf(b.o);
              const yC = yOf(b.c);
              const top = Math.min(yO, yC);
              const bodyH = Math.max(1.4, Math.abs(yC - yO));
              return (
                <g key={b.t}>
                  <line
                    x1={x}
                    x2={x}
                    y1={yH}
                    y2={yL}
                    stroke={color}
                    strokeWidth={1.15}
                  />
                  <rect
                    x={x - bodyW / 2}
                    y={top}
                    width={bodyW}
                    height={bodyH}
                    fill={color}
                    rx={0.4}
                  />
                </g>
              );
            })}

            <path
              d={pathOf(ema9, xOf, yOf)}
              fill="none"
              stroke="#f5c542"
              strokeWidth={1.25}
              opacity={0.9}
            />
            <path
              d={pathOf(ema21, xOf, yOf)}
              fill="none"
              stroke="#7eb6ff"
              strokeWidth={1.15}
              opacity={0.85}
            />

            {bars.length > 1
              ? [0, Math.floor(bars.length / 2), bars.length - 1].map((i) => {
                  const b = bars[i];
                  if (!b) return null;
                  return (
                    <text
                      key={`t-${b.t}`}
                      x={xOf(i)}
                      y={H - 6}
                      textAnchor="middle"
                      fill={MUTED}
                      fontSize="10"
                      fontFamily="ui-monospace, monospace"
                    >
                      {new Date(b.t).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </text>
                  );
                })
              : null}

            {pxNow > 0 ? (
              <g>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={yOf(pxNow)}
                  y2={yOf(pxNow)}
                  stroke={up ? UP : DN}
                  strokeDasharray="4 3"
                  strokeWidth={1}
                  opacity={0.8}
                />
                <rect
                  x={W - padR + 2}
                  y={yOf(pxNow) - 8}
                  width={72}
                  height={16}
                  rx={3}
                  fill={up ? UP : DN}
                />
                <text
                  x={W - padR + 38}
                  y={yOf(pxNow) + 3.5}
                  textAnchor="middle"
                  fill="#0b0f14"
                  fontSize="10"
                  fontWeight={700}
                  fontFamily="ui-monospace, monospace"
                >
                  {formatNum(pxNow, pxNow < 10 ? 4 : 0)}
                </text>
              </g>
            ) : null}

            {(gridLines ?? []).map((g) => (
              <line
                key={`g-${g}`}
                x1={padL}
                x2={W - padR}
                y1={yOf(g)}
                y2={yOf(g)}
                stroke="#3d4a5c"
                strokeDasharray="2 5"
                strokeWidth={1}
              />
            ))}

            {limit ? (
              <LevelLine y={yOf(limit)} x1={padL} x2={W - padR} color="#7eb6ff" label="LIMIT" value={limit} />
            ) : null}
            {entry ? (
              <LevelLine y={yOf(entry)} x1={padL} x2={W - padR} color="#f5c542" label="ENTRY" value={entry} />
            ) : null}
            {sl ? (
              <LevelLine y={yOf(sl)} x1={padL} x2={W - padR} color={DN} label="SL" value={sl} />
            ) : null}
            {tp ? (
              <LevelLine y={yOf(tp)} x1={padL} x2={W - padR} color={UP} label="TP" value={tp} />
            ) : null}

            {hover && hoverBar ? (
              <g>
                <line
                  x1={hover.x}
                  x2={hover.x}
                  y1={padT}
                  y2={padT + plotH + volH}
                  stroke="#4a5568"
                  strokeDasharray="3 3"
                />
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={yOf(hoverBar.c)}
                  y2={yOf(hoverBar.c)}
                  stroke="#4a5568"
                  strokeDasharray="3 3"
                />
              </g>
            ) : null}
          </svg>

          {hoverBar ? (
            <div className="pointer-events-none absolute left-3 top-2 rounded-md bg-[#121821]/95 px-2.5 py-1.5 text-[11px] tabular shadow-lg ring-1 ring-white/10">
              <div className="text-[#8b95a2]">
                {new Date(hoverBar.t).toLocaleString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "2-digit",
                  month: "short",
                })}
              </div>
              <div>
                O {formatNum(hoverBar.o, hoverBar.o < 10 ? 4 : 0)} · H{" "}
                {formatNum(hoverBar.h, hoverBar.h < 10 ? 4 : 0)} · L{" "}
                {formatNum(hoverBar.l, hoverBar.l < 10 ? 4 : 0)} · C{" "}
                <span className={hoverBar.c >= hoverBar.o ? "text-[#26a69a]" : "text-[#ef5350]"}>
                  {formatNum(hoverBar.c, hoverBar.c < 10 ? 4 : 0)}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function PairCandleChart({
  position,
  mark,
}: {
  position: Position;
  mark: number;
}) {
  const [tf, setTf] = useState("15");
  return (
    <WatchChart
      pair={position.pair}
      mark={mark}
      position={position}
      tf={tf}
      onTf={setTf}
    />
  );
}

function LevelLine({
  y,
  x1,
  x2,
  color,
  label,
  value,
}: {
  y: number;
  x1: number;
  x2: number;
  color: string;
  label: string;
  value: number;
}) {
  if (!Number.isFinite(y)) return null;
  return (
    <g>
      <line
        x1={x1}
        x2={x2}
        y1={y}
        y2={y}
        stroke={color}
        strokeDasharray="5 4"
        strokeWidth={1}
        opacity={0.8}
      />
      <text
        x={x1 + 4}
        y={y - 4}
        fill={color}
        fontSize="9"
        fontFamily="ui-monospace, monospace"
      >
        {label} {formatNum(value, value < 10 ? 4 : 0)}
      </text>
    </g>
  );
}
