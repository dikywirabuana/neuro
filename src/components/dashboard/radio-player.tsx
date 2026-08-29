import { Pause, Play, Radio, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Station = {
  id: string;
  name: string;
  city: string;
  tag: string;
  url: string;
};

const STATIONS: Station[] = [
  {
    id: "elshinta",
    name: "Elshinta",
    city: "Jakarta",
    tag: "Berita",
    url: "https://stream-ssl.arenastreaming.com:8000/jakarta",
  },
  {
    id: "iradio",
    name: "I-Radio",
    city: "Jakarta",
    tag: "Hits",
    url: "https://stream.radiojar.com/4ywdgup3bnzuv",
  },
  {
    id: "hardrock",
    name: "Hard Rock",
    city: "Jakarta",
    tag: "Rock",
    url: "https://stream.radiojar.com/7csmg90fuqruv",
  },
  {
    id: "dengerin",
    name: "Dengerin",
    city: "Nasional",
    tag: "Indo",
    url: "https://stream.denger.in/",
  },
  {
    id: "koplo",
    name: "Mettaswara",
    city: "Nasional",
    tag: "Koplo",
    url: "https://mettaswara.com:8700/koplo",
  },
  {
    id: "campur",
    name: "Campursari",
    city: "Jakarta",
    tag: "Kenangan",
    url: "https://a8.siar.us/listen/campursari/stream",
  },
  {
    id: "dahlia",
    name: "Dahlia FM",
    city: "Bandung",
    tag: "Pop",
    url: "https://svara-stream.radioddns.net/bandung_dahliafm",
  },
];

const LS = "neurotrend-radio";

type Saved = { id: string; vol: number };

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return { id: STATIONS[0].id, vol: 0.55 };
    const j = JSON.parse(raw) as Saved;
    return {
      id: STATIONS.some((s) => s.id === j.id) ? j.id : STATIONS[0].id,
      vol: Math.min(1, Math.max(0, Number(j.vol) || 0.55)),
    };
  } catch {
    return { id: STATIONS[0].id, vol: 0.55 };
  }
}

export function RadioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [saved] = useState(loadSaved);
  const [stationId, setStationId] = useState(saved.id);
  const [playing, setPlaying] = useState(false);
  const [vol, setVol] = useState(saved.vol);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState<"idle" | "load" | "on" | "err">("idle");

  const station = STATIONS.find((s) => s.id === stationId) ?? STATIONS[0];
  const idx = STATIONS.findIndex((s) => s.id === station.id);

  useEffect(() => {
    localStorage.setItem(LS, JSON.stringify({ id: stationId, vol }));
  }, [stationId, vol]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = muted ? 0 : vol;
  }, [vol, muted]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.src = station.url;
    el.load();
    if (playing) {
      setStatus("load");
      void el.play().catch(() => {
        setPlaying(false);
        setStatus("err");
      });
    }
  }, [station.url]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      setStatus("idle");
      return;
    }
    setStatus("load");
    if (!el.src) el.src = station.url;
    void el.play()
      .then(() => {
        setPlaying(true);
        setStatus("on");
      })
      .catch(() => {
        setPlaying(false);
        setStatus("err");
      });
  };

  const next = () => {
    const n = STATIONS[(idx + 1) % STATIONS.length];
    setStationId(n.id);
    setPlaying(true);
    setStatus("load");
  };

  const pick = (id: string) => {
    setStationId(id);
    setPlaying(true);
    setStatus("load");
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur-md">
      <audio
        ref={audioRef}
        preload="none"
        onPlaying={() => {
          setPlaying(true);
          setStatus("on");
        }}
        onWaiting={() => setStatus("load")}
        onError={() => {
          setStatus("err");
          setPlaying(false);
        }}
      />
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-3 py-2 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <Radio className="h-4 w-4 text-[var(--color-accent)]" />
          </div>
          <button
            type="button"
            onClick={toggle}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-primary-fg)]"
            aria-label={playing ? "Jeda radio" : "Putar radio"}
          >
            {playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="ml-0.5 h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={next}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            aria-label="Saluran berikutnya"
          >
            <SkipForward className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {station.name}
              <span className="ml-1.5 text-[11px] font-normal text-[var(--color-muted)]">
                {station.city} · {station.tag}
              </span>
            </div>
            <div className="text-[11px] tabular text-[var(--color-subtle)]">
              {status === "on"
                ? "ON AIR"
                : status === "load"
                  ? "Menghubungkan…"
                  : status === "err"
                    ? "Sinyal putus — ganti saluran"
                    : "Radio lokal · tekan play"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="hidden h-9 w-9 shrink-0 items-center justify-center text-[var(--color-muted)] sm:flex"
            aria-label="Mute"
          >
            {muted || vol === 0 ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : vol}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVol(v);
              if (v > 0) setMuted(false);
            }}
            className="hidden w-24 accent-[var(--color-accent)] sm:block"
            aria-label="Volume"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {STATIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pick(s.id)}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] ${
                s.id === station.id
                  ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
