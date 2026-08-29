const SW_URL = "/sw-neurotrend.js";

let wakeLock: WakeLockSentinel | null = null;
let swReady: ServiceWorkerRegistration | null = null;
let tickHandler: (() => void) | null = null;

export async function registerNeuroSw(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    swReady = reg;
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return reg;
  } catch {
    return null;
  }
}

function onSwMessage(ev: MessageEvent) {
  const data = ev.data as { type?: string } | undefined;
  if (data?.type === "NT_TICK") tickHandler?.();
}

export function onBackgroundTick(fn: () => void): () => void {
  tickHandler = fn;
  return () => {
    if (tickHandler === fn) tickHandler = null;
  };
}

export async function startBackground(intervalMs: number): Promise<void> {
  const reg =
    swReady ??
    (await navigator.serviceWorker?.ready.catch(() => null)) ??
    (await registerNeuroSw());
  if (!reg) return;

  const send = (sw: ServiceWorker | null | undefined) => {
    sw?.postMessage({ type: "START", intervalMs });
  };
  send(reg.active);
  send(navigator.serviceWorker.controller);
  if (!reg.active) {
    await navigator.serviceWorker.ready.catch(() => null);
    send(reg.active ?? navigator.serviceWorker.controller);
  }

  try {
    const sync = reg as ServiceWorkerRegistration & {
      periodicSync?: { register: (tag: string, opts: { minInterval: number }) => Promise<void> };
    };
    if (sync.periodicSync) {
      await sync.periodicSync.register("neurotrend-scan", {
        minInterval: Math.max(60_000, intervalMs),
      });
    }
  } catch {
    /* periodic sync optional */
  }

  await acquireWakeLock();
}

export async function stopBackground(): Promise<void> {
  releaseWakeLock();
  const reg = swReady ?? (await navigator.serviceWorker?.ready.catch(() => null));
  reg?.active?.postMessage({ type: "STOP" });
  navigator.serviceWorker?.controller?.postMessage({ type: "STOP" });
}

export async function acquireWakeLock(): Promise<void> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
  try {
    releaseWakeLock();
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}

export function releaseWakeLock(): void {
  try {
    void wakeLock?.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

export function isSwControlled(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.serviceWorker?.controller);
}
