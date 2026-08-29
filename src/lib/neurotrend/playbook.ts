import type { MarketRegime } from "./regime";

export type PlaybookId =
  | "hybrid"
  | "sniper"
  | "bounce"
  | "trend"
  | "breakout"
  | "receh"
  | "major"
  | "hot"
  | "grid";

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

const MAJORS = [
  "btc_idr",
  "eth_idr",
  "xrp_idr",
  "sol_idr",
  "bnb_idr",
  "doge_idr",
  "ada_idr",
  "trx_idr",
  "ltc_idr",
  "link_idr",
  "dot_idr",
  "avax_idr",
  "matic_idr",
  "shib_idr",
  "pepe_idr",
];

export const PLAYBOOKS: Playbook[] = [
  {
    id: "hybrid",
    name: "Hybrid",
    tagline: "Ikut regime pasar",
    tricks: [
      "CHOP → bounce dari low",
      "TREND_UP → pullback / breakout",
      "TREND_DOWN → diam",
      "Hold TP/SL, tanpa rotasi",
    ],
    allowedSetups: ["BOUNCE", "PULLBACK", "BREAKOUT"],
    requireStrong: false,
    minScore: 68,
    minVolumeIdr: 400_000_000,
    maxSpreadPct: 0.65,
    maxPositions: 2,
    skipDown: true,
    note: "Default. Mesin pilih trik sesuai cuaca pasar.",
  },
  {
    id: "sniper",
    name: "Sniper",
    tagline: "Jarang, tapi bersih",
    tricks: [
      "Hanya STRONG_BUY",
      "1 posisi, buku tebal",
      "Spread ketat ≤ 0.35%",
      "Tidak kejar koin sepi",
    ],
    allowedSetups: ["BOUNCE", "PULLBACK", "BREAKOUT"],
    requireStrong: true,
    minScore: 74,
    minVolumeIdr: 1_200_000_000,
    maxSpreadPct: 0.35,
    maxPositions: 1,
    skipDown: true,
    note: "Paling pelit. Cocok modal kecil supaya fee tidak makan.",
  },
  {
    id: "bounce",
    name: "Bounce",
    tagline: "Beli panic yang sudah balik",
    tricks: [
      "Hanya zona bawah harian",
      "Wajib tick naik dulu",
      "SL di bawah low hari ini",
      "Tolak dump 24h dalam",
    ],
    allowedSetups: ["BOUNCE"],
    requireStrong: true,
    minScore: 72,
    minVolumeIdr: 800_000_000,
    maxSpreadPct: 0.45,
    maxPositions: 2,
    skipDown: true,
    note: "Mean-reversion. Jangan dipakai saat TREND_DOWN.",
  },
  {
    id: "trend",
    name: "Trend",
    tagline: "Ikut arus, jangan lawan",
    tricks: [
      "Hanya TREND_UP",
      "Beli pullback ke EMA",
      "Atau breakout volume",
      "Skip chop & dump",
    ],
    allowedSetups: ["PULLBACK", "BREAKOUT"],
    requireStrong: false,
    minScore: 68,
    minVolumeIdr: 500_000_000,
    maxSpreadPct: 0.55,
    maxPositions: 2,
    skipDown: true,
    note: "Kalau pasar datar/turun: diam. Tunggu trend naik.",
  },
  {
    id: "breakout",
    name: "Breakout",
    tagline: "Tembus high + volume",
    tricks: [
      "Break high harian",
      "Volume harus rame",
      "TP agak longgar",
      "Tidak beli breakdown",
    ],
    allowedSetups: ["BREAKOUT"],
    requireStrong: false,
    minScore: 70,
    minVolumeIdr: 700_000_000,
    maxSpreadPct: 0.5,
    maxPositions: 2,
    skipDown: true,
    note: "Momentum. Kalau gagal break, SL cepat.",
  },
  {
    id: "receh",
    name: "Receh",
    tagline: "Tipis, lancar, buku tebal",
    tricks: [
      "Hanya pair paling likuid",
      "Spread ≤ 0.30%",
      "TP kecil di atas fee",
      "1 entry / scan",
    ],
    allowedSetups: ["BOUNCE", "PULLBACK", "BREAKOUT"],
    requireStrong: true,
    minScore: 70,
    minVolumeIdr: 1_500_000_000,
    maxSpreadPct: 0.3,
    maxPositions: 2,
    skipDown: true,
    note: "Cari pergerakan halus. Bukan meme sepi.",
  },
  {
    id: "major",
    name: "Major",
    tagline: "BTC ETH XRP SOL & kawan",
    tricks: [
      "Whitelist koin besar",
      "Spread ketat, jarang slip",
      "Tidak ke meme listing",
      "Hold sampai TP/SL",
    ],
    allowedSetups: ["BOUNCE", "PULLBACK", "BREAKOUT"],
    requireStrong: false,
    minScore: 66,
    minVolumeIdr: 400_000_000,
    maxSpreadPct: 0.5,
    maxPositions: 2,
    pairAllow: MAJORS,
    skipDown: true,
    note: "Paling aman dari rug-pull / buku tipis.",
  },
  {
    id: "hot",
    name: "Hot tape",
    tagline: "Ikut keramaian orderbook",
    tricks: [
      "Volume paling besar dulu",
      "Boleh BUY biasa, bukan hanya strong",
      "2 posisi",
      "Tetap no-rotasi",
    ],
    allowedSetups: ["BOUNCE", "PULLBACK", "BREAKOUT"],
    requireStrong: false,
    minScore: 64,
    minVolumeIdr: 2_000_000_000,
    maxSpreadPct: 0.55,
    maxPositions: 2,
    skipDown: true,
    note: "Main di tape yang rame. Bukan koin sepi.",
  },
  {
    id: "grid",
    name: "Grid",
    tagline: "Beli turun, jual naik, ulang",
    tricks: [
      "1 pair likuid, lot min Rp 10rb",
      "Beli tiap turun 1 step (~1.2%)",
      "Jual 1 lot tiap naik 1 step",
      "Fee sudah dihitung di step",
    ],
    allowedSetups: ["BOUNCE", "PULLBACK", "BREAKOUT"],
    requireStrong: false,
    minScore: 50,
    minVolumeIdr: 500_000_000,
    maxSpreadPct: 0.55,
    maxPositions: 3,
    skipDown: false,
    note: "Range/chop. Pyramida turun, lepas naik. Jangan di crash keras.",
  },
];

export const DEFAULT_PLAYBOOK: PlaybookId = "hybrid";

export function playbookOf(id: string | undefined): Playbook {
  return PLAYBOOKS.find((p) => p.id === id) ?? PLAYBOOKS[0];
}

export function isPlaybookId(v: unknown): v is PlaybookId {
  return PLAYBOOKS.some((p) => p.id === v);
}

export function playbookAllowsPair(pb: Playbook, pair: string): boolean {
  if (!pb.pairAllow?.length) return true;
  return pb.pairAllow.includes(pair.toLowerCase());
}

export function playbookFitsSetup(
  pb: Playbook,
  setup: string | undefined,
  regime: MarketRegime,
): boolean {
  if (pb.id === "grid") return true;
  if (!setup || setup === "NONE") return false;
  if (pb.skipDown && regime === "TREND_DOWN") return false;
  if (pb.id === "bounce" && regime !== "CHOP") return false;
  if (pb.id === "trend" && regime !== "TREND_UP") return false;
  if (pb.id === "breakout" && regime === "CHOP") return false;
  return pb.allowedSetups.includes(setup as SetupKind);
}
