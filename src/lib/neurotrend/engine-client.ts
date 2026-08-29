export type EngineSnap = {
  ok?: boolean;
  engine?: string;
  running?: boolean;
  error?: string | null;
  lastScanAt?: number;
  source?: string;
  live?: boolean;
  cash?: number;
  positions?: Record<string, unknown>;
  opportunities?: unknown[];
  prices?: Record<string, number>;
  trades?: unknown[];
  logs?: { ts: number; text: string; kind?: string }[];
  summary?: Record<string, number>;
  settings?: Record<string, unknown>;
};

export async function fetchEngineState(): Promise<EngineSnap | null> {
  try {
    const res = await fetch("/api/engine", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as EngineSnap;
    if (json.engine === "offline" || json.ok === false && !json.running) {
      if (!res.ok) return null;
    }
    if (!res.ok && json.engine === "offline") return null;
    return json;
  } catch {
    return null;
  }
}

export async function engineCommand(
  action: string,
  extra: Record<string, unknown> = {},
): Promise<EngineSnap> {
  const res = await fetch("/api/engine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
    signal: AbortSignal.timeout(20_000),
  });
  return (await res.json()) as EngineSnap;
}
