"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { api } from "@/lib/api"
import type { Game, TranslationProgress, Settings } from "@/lib/types"

// --- useGames ---

export function useGames(search?: string) {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const data = await api.games.list(search)
      setGames(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load games")
    } finally {
      setLoading(false)
    }
  }, [search])

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

// --- useTranslationProgress (SSE) ---

export function useTranslationProgress(gameId: number | null) {
  const [progress, setProgress] = useState<TranslationProgress>({
    progress: 0,
    translated: 0,
    total: 0,
  })
  const [status, setStatus] = useState<string>("idle")
  const [message, setMessage] = useState("")
  const eventSourceRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    if (gameId === null) return

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const url = api.translate.statusUrl(gameId)
    const es = new EventSource(url)
    eventSourceRef.current = es

    setStatus("connecting")

    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data)
      setProgress(data)
      setStatus(data.status || "running")
      if (data.message) setMessage(data.message)
    })

    es.addEventListener("complete", (e) => {
      const data = JSON.parse(e.data)
      setProgress(data)
      setStatus("completed")
      es.close()
    })

    es.addEventListener("error", (e) => {
      if (e instanceof MessageEvent) {
        const data = JSON.parse(e.data)
        setMessage(data.message || "Error")
      }
      setStatus("error")
      es.close()
    })

    es.addEventListener("cancelled", () => {
      setStatus("cancelled")
      es.close()
    })

    es.addEventListener("heartbeat", () => {
      // Keep alive
    })

    es.onerror = () => {
      // SSE connection error (server might not be streaming)
      es.close()
      setStatus("idle")
    }
  }, [gameId])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    disconnect()
    setProgress({ progress: 0, translated: 0, total: 0 })
    setStatus("idle")
    setMessage("")
  }, [disconnect])

  useEffect(() => {
    return () => disconnect()
  }, [disconnect])

  return { progress, status, message, connect, disconnect, reset }
}
