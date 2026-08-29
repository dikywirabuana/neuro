import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Tampilan = nominal real. 25000 → Rp 25.000 */
export const DISPLAY_IDR_SCALE = 1;

function idrString(n: number, digits = 0): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

/** IDR tampilan = nominal real (order & UI sama). */
export function formatIdr(n: number, digits = 0): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return idrString(0, digits);
  return idrString(v, digits);
}

/** Alias — sama dengan formatIdr. */
export function formatIdrReal(n: number, digits = 0): string {
  return formatIdr(n, digits);
}

export function formatNum(n: number, digits = 0): string {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

export function formatPct(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}
