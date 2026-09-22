import { useEffect } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

function isStaleChunk(msg: string): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i.test(
    msg,
  );
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const msg = String(error?.message || "");
  const stale = isStaleChunk(msg);

  useEffect(() => {
    if (!stale || typeof window === "undefined") return;
    try {
      if (sessionStorage.getItem("nt-chunk-reload") === "1") return;
      sessionStorage.setItem("nt-chunk-reload", "1");
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => window.location.reload(), 500);
    return () => window.clearTimeout(t);
  }, [stale]);

  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-[#08090b] text-[#e8eaed]"
      }
    >
      <span className="text-red-500" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">
        {stale ? "Aplikasi diperbarui" : "Something went wrong"}
      </h1>
      <p className="max-w-md text-sm break-words text-zinc-400">
        {stale
          ? "File lama sudah diganti. Memuat ulang otomatis…"
          : msg || "An unexpected error occurred. Try reloading the page."}
      </p>
      <button
        type="button"
        className="mt-2 rounded-md bg-[#1db954] px-4 py-2 text-sm font-medium text-black"
        onClick={() => {
          try {
            sessionStorage.removeItem("nt-chunk-reload");
          } catch {
            /* ignore */
          }
          window.location.reload();
        }}
      >
        Muat ulang
      </button>
    </main>
  );
}
