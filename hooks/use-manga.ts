"use client"

import { useState, useEffect, useCallback } from "react"
import { api } from "@/lib/api"
import type { MangaItem, MangaTranslationResult, DetectorType } from "@/lib/types"

export function useMangaLibrary(search?: string) {
  const [items, setItems] = useState<MangaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const data = await api.manga.list(search)
      setItems(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load manga")
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { items, loading, error, refresh }
}

export function useManga(id: number | null) {
  const [manga, setManga] = useState<MangaItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    if (id === null) return
    setLoading(true)
    setError("")
    try {
      const data = await api.manga.get(id)
      setManga(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load manga")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { manga, loading, error, refresh }
}

export function useMangaTranslation(mangaId: number | null, page: number) {
  const [translation, setTranslation] = useState<MangaTranslationResult["translation"] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    if (mangaId === null) return
    setLoading(true)
    setError("")
    try {
      const data = await api.manga.getTranslation(mangaId, page)
      if (data.exists && data.translation) {
        setTranslation(data.translation)
      } else {
        setTranslation(null)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load translation")
    } finally {
      setLoading(false)
    }
  }, [mangaId, page])

  useEffect(() => {
    load()
  }, [load])

  const translate = useCallback(async (model?: string, detector?: DetectorType) => {
    if (mangaId === null) return
    setLoading(true)
    setError("")
    try {
      const result = await api.manga.translate(mangaId, page, model, detector)
      setTranslation(result.translation)
      return result
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Translation failed"
      setError(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [mangaId, page])

  return { translation, loading, error, load, translate }
}
