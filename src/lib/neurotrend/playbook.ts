import type { MarketRegime } from "./regime";

export type PlaybookId = "smart";

export type SetupKind = "BOUNCE" | "PULLBACK" | "BREAKOUT";

export type Playbook = {
  id: PlaybookId;
  name: string;
  tagline: string;
  tricks: string[];
  allowedSetups: SetupKind[];
  requireStrong: boolean;
  minScore: number;
  minVolumeIdr: number;
  maxSpreadPct: number;
  maxPositions: number;
  pairAllow?: string[];
  skipDown: boolean;
  note: string;
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "smart",
    name: "Smart Agresif",
    tagline: "Satu mesin · momentum + dip",
    tricks: [
      "Tape rame + tidak crash → BUY",
      "Dip RSI/zona bawah yang sudah berhenti jatuh",
      "Skip BTC/ETH · 2 pair · 35% modal",
      "TP ~2% setelah fee · SL 1.8%",
    ],
    allowedSetups: ["BOUNCE", "BREAKOUT"],
    requireStrong: false,
    minScore: 56,
    minVolumeIdr: 80_000_000,
    maxSpreadPct: 0.7,
    maxPositions: 2,
    skipDown: false,
    note: "Satu strategi. Tidak ganti-ganti mode tiap scan.",
  },
];

export const DEFAULT_PLAYBOOK: PlaybookId = "smart";

export function playbookOf(_id?: string): Playbook {
  return PLAYBOOKS[0];
}

export function isPlaybookId(v: unknown): v is PlaybookId {
  return v === "smart";
}

export function playbookAllowsPair(_pb: Playbook, pair: string): boolean {
  return !/^(btc|eth|bnb)_idr$/.test(pair.toLowerCase());
}

export function playbookFitsSetup(
  _pb: Playbook,
  setup: string | undefined,
  _regime: MarketRegime,
): boolean {
  return setup === "BOUNCE" || setup === "BREAKOUT";
}

export function pickPlaybook(
  regime: MarketRegime,
  _opps: {
    pair: string;
    setup?: string;
    signal?: string;
    spreadPct: number;
    volumeIdr: number;
    rangePos: number;
    change24h?: number;
  }[],
): { id: PlaybookId; reason: string; score: number } {
  return {
    id: "smart",
    reason: `Smart agresif · ${regime}`,
    score: 100,
  };
}
