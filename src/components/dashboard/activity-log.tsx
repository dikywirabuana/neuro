export function ActivityLog({
  logs,
}: {
  logs: { ts: number; text: string; kind: string }[];
}) {
  if (!logs.length) {
    return (
      <div className="panel p-6 text-sm text-[var(--color-muted)]">
        Log aktivitas bot muncul di sini.
      </div>
    );
  }

  return (
    <div className="panel max-h-80 overflow-y-auto p-3 sm:p-4">
      <ul className="space-y-2 font-mono text-xs sm:text-sm">
        {logs.map((l, i) => (
          <li
            key={`${l.ts}-${i}`}
            className={
              l.kind === "entry"
                ? "text-[var(--color-buy)]"
                : l.kind === "exit"
                  ? "text-[var(--color-warn)]"
                  : l.kind === "live"
                    ? "text-[var(--color-fg)]"
                    : l.kind === "ai"
                      ? "text-[var(--color-accent)]"
                      : l.kind === "error"
                        ? "text-[var(--color-sell)]"
                        : "text-[var(--color-muted)]"
            }
          >
            <span className="text-[var(--color-subtle)]">
              {new Date(l.ts).toLocaleTimeString("id-ID")}
            </span>{" "}
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
