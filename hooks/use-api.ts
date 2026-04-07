"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { api } from "@/lib/api"
import { getLocale, translations } from "@/lib/i18n"
import type { TranslationKey } from "@/lib/i18n"
import type { Game, TranslationProgress, Settings, LicenseStatus } from "@/lib/types"

/** Resolve SSE message: prefer message_key (i18n) over raw message string.
 *  Reads current locale at call time so it stays in sync after locale changes. */
function _resolveSSEMessage(data: Record<string, unknown>): string {
  const key = data.message_key as string | undefined
  if (key) {
    const keyMap: Record<string, TranslationKey> = {
      tm_cache_applied: "tmCacheApplied",
      tm_cache_all_applied: "tmCacheAllApplied",
      tm_saved: "tmSaved",
      tm_save_failed: "tmSaveFailed",
    }
    const tKey = keyMap[key]
    if (tKey) {
      const locale = getLocale()
      let msg: string = translations[locale]?.[tKey] ?? translations.ko[tKey] ?? tKey
      const args = data.message_args as Record<string, unknown> | undefined
      if (args) {
        for (const [k, v] of Object.entries(args)) {
          msg = msg.replace(`{${k}}`, String(v))
        }
      }
      return msg
    }
  }
  return (data.message as string) || ""
}

// --- useGames ---

export function useGames(search?: string) {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState(search)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const data = await api.games.list(debouncedSearch)
      setGames(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load games")
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { games, loading, error, refresh }
}

// --- useGame ---

export function useGame(id: number | null) {
  const [game, setGame] = useState<Game | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    if (id === null) return
    setLoading(true)
    setError("")
    try {
      const data = await api.games.get(id)
      setGame(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load game")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { game, loading, error, refresh }
}

// --- useSettings ---

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.settings.get()
      setSettings(data)
    } catch {
      // Settings might not exist yet
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (data: Settings) => {
    const result = await api.settings.put(data)
    setSettings(result)
    return result
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { settings, loading, refresh, save }
}

// --- useLicenseStatus ---

export function useLicenseStatus() {
  const [license, setLicense] = useState<LicenseStatus>({ valid: false, plan: "", is_admin: false, verified_at: "" })
  const [loading, setLoading] = useState(true)
  const licenseRef = useRef(license)
  licenseRef.current = license

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.license.status()
      setLicense(data)
    } catch {
      // License check failed - stay invalid
    } finally {
      setLoading(false)
    }
  }, [])

  const verify = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.license.verify()
      setLicense(data)
      return data
    } catch {
      return licenseRef.current
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { license, loading, refresh, verify }
}

// --- useTranslationProgress (SSE) ---

export function useTranslationProgress(gameId: number | null) {
  const [progress, setProgress] = useState<TranslationProgress>({
    progress: 0,
    translated: 0,
    total: 0,
  })
  const [status, setStatus] = useState<string>("idle")
  const [message, setMessage] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    if (gameId === null) return
    stopPolling()
    let idleCount = 0

    const poll = async () => {
      try {
        const res = await fetch(api.translate.pollUrl(gameId))
        if (!res.ok) return
        const data = await res.json()

        if (data.status === "running") {
          idleCount = 0
          setProgress({
            progress: data.progress ?? 0,
            translated: data.translated ?? 0,
            total: data.total ?? 0,
          })
          setStatus("running")
          if (data.message) setMessage(data.message)
        } else if (data.status === "completed") {
          setProgress({
            progress: data.progress ?? 100,
            translated: data.translated ?? 0,
            total: data.total ?? 0,
          })
          setStatus("completed")
          if (data.message) setMessage(data.message)
          stopPolling()
        } else if (data.status === "error") {
          setMessage(data.error_message || data.message || "Error")
          setStatus("error")
          stopPolling()
        } else if (data.status === "cancelled") {
          setStatus("cancelled")
          stopPolling()
        } else {
          // idle — job might not be registered yet, wait a bit
          idleCount++
          if (idleCount > 20) {
            // 30s of idle = give up
            setStatus("idle")
            stopPolling()
          }
        }
      } catch { /* ignore network errors */ }
    }

    // Poll immediately, then every 1.5s
    poll()
    pollRef.current = setInterval(poll, 1500)
  }, [gameId, stopPolling])

  const connect = useCallback(() => {
    if (gameId === null) return
    setStatus("running")
    startPolling()
  }, [gameId, startPolling])

  const disconnect = useCallback(() => {
    stopPolling()
  }, [stopPolling])

  const reset = useCallback(() => {
    stopPolling()
    setProgress({ progress: 0, translated: 0, total: 0 })
    setStatus("idle")
    setMessage("")
  }, [stopPolling])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  return { progress, status, message, connect, disconnect, reset }
}
