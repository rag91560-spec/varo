import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Game } from "./types"
import type { TranslationKey } from "./i18n"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getProgressPct(game: Game): number {
  return game.string_count > 0
    ? Math.round((game.translated_count / game.string_count) * 100)
    : 0
}

export type StatusIcon = "check" | "spinner" | "alert" | null

export function getStatusInfo(
  game: Game,
  t: (key: TranslationKey) => string
): { text: string; color: string; icon: StatusIcon; idle: boolean } {
  const pct = getProgressPct(game)
  if (game.status === "applied") return { text: t("statusApplied"), color: "var(--success)", icon: "check", idle: false }
  if (game.status === "translating") return { text: t("statusTranslating"), color: "var(--info)", icon: "spinner", idle: false }
  if (game.status === "translated" || pct === 100) return { text: t("statusTranslated"), color: "var(--accent)", icon: "check", idle: false }
  if (pct > 0) return { text: `${pct}%`, color: "var(--warning)", icon: null, idle: false }
  if (!game.engine) return { text: t("statusScanNeeded"), color: "var(--warning)", icon: "alert", idle: true }
  return { text: t("scanCompleted"), color: "rgba(58,58,61,0.8)", icon: null, idle: false }
}

/** Electron-aware confirm: uses native dialog in Electron, falls back to window.confirm */
export async function appConfirm(message: string): Promise<boolean> {
  if (window.electronAPI?.showConfirm) {
    return window.electronAPI.showConfirm(message)
  }
  return window.confirm(message)
}
