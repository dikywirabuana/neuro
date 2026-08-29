import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EquityPoint } from "@/lib/neurotrend/types";
import { formatIdr } from "@/lib/utils";

export function EquityChart({ history }: { history: EquityPoint[] }) {
  if (history.length < 2) {
    return (
      <div className="panel flex h-64 items-center justify-center p-6 text-sm text-[var(--color-muted)]">
        Equity curve muncul setelah beberapa cycle scan.
      </div>
    );
  }

  const data = history.map((h) => ({
    t: new Date(h.ts).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    equity: h.equity,
  }));

  return (
    <div className="panel p-4 sm:p-5">
      <div className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
        Equity curve
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6b9e8a" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#6b9e8a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#242a30" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fill: "#8b929a", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              tick={{ fill: "#8b929a", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={72}
              tickFormatter={(v: number) =>
                v >= 1_000_000
                  ? `${(v / 1_000_000).toFixed(1)}M`
                  : v >= 1000
                    ? `${(v / 1000).toFixed(0)}k`
                    : String(Math.round(v))
              }
            />
            <Tooltip
              contentStyle={{
                background: "#161a1e",
                border: "1px solid #242a30",
                borderRadius: 12,
                color: "#e8eaed",
              }}
              formatter={(value: number) => [formatIdr(value), "Equity"]}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="#6b9e8a"
              strokeWidth={2}
              fill="url(#eqFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
