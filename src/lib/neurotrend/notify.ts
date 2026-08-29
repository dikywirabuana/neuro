/** Browser chime — no audio files. Unlock after a click (Start). */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

export function unlockAudio(): void {
  const c = audio();
  if (c && c.state === "suspended") void c.resume();
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  gain = 0.12,
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** 3-note naik — TAKE_PROFIT. */
export function playTpChime(): void {
  const c = audio();
  if (!c) return;
  void c.resume();
  const t = c.currentTime;
  tone(c, 659.25, t, 0.14, 0.14);
  tone(c, 830.61, t + 0.12, 0.16, 0.14);
  tone(c, 1046.5, t + 0.26, 0.28, 0.16);
}

export function notifyTakeProfit(pair: string, pnl: number): void {
  playTpChime();
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification("TAKE PROFIT", {
        body: `${pair.replace("_idr", "").toUpperCase()} · PnL Rp ${Math.round(pnl).toLocaleString("id-ID")}`,
        silent: true,
      });
    } catch {
      /* ignore */
    }
  }
}
