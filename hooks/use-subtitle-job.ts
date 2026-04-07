"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { api } from "@/lib/api"
import type { SubtitleSet, SubtitleSegment, SubtitleStyleOptions } from "@/lib/types"

export interface SubtitleJobProgress {
  status: "idle" | "running" | "completed" | "error" | "cancelled"
  progress: number
  message: string
  error?: string
}

export function useSubtitleJob() {
  const [jobProgress, setJobProgress] = useState<SubtitleJobProgress>({
    status: "idle",
    progress: 0,
    message: "",
  })
  const eventSourceRef = useRef<EventSource | null>(null)
  const jobIdRef = useRef<string>("")

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  const listenToJob = useCallback((url: string, jobId: string) => {
    cleanup()
    jobIdRef.current = jobId
    setJobProgress({ status: "running", progress: 0, message: "" })

    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onopen = () => {
      console.log("[subtitle-job] SSE connected:", url)
    }

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const { event: evtType, data } = msg
        console.log("[subtitle-job] SSE event:", evtType, data)

        switch (evtType) {
          case "init":
            // init may arrive with status=completed (e.g. TM cache hit)
            if (data.status === "completed") {
              setJobProgress({ status: "completed", progress: 1, message: "" })
              cleanup()
            } else {
              setJobProgress({ status: "running", progress: data.progress ?? 0, message: data.message ?? "" })
            }
            break
          case "progress":
            setJobProgress({
              status: "running",
              progress: data.progress ?? 0,
              message: data.message ?? "",
            })
            break
          case "complete":
            setJobProgress({
              status: "completed",
              progress: 1,
              message: JSON.stringify(data),
            })
            cleanup()
            break
          case "error":
            setJobProgress({
              status: "error",
              progress: 0,
              message: "",
              error: data.message ?? "Unknown error",
            })
            cleanup()
            break
          case "cancelled":
            setJobProgress({
              status: "cancelled",
              progress: 0,
              message: "Cancelled",
            })
            cleanup()
            break
          case "heartbeat":
            break
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      // SSE fires onerror on normal stream close too — only treat as error if still running
      if (es.readyState === EventSource.CLOSED) {
        cleanup()
      }
    }
  }, [cleanup])

  const startSTT = useCallback(async (subtitleId: number, opts?: {
    provider?: string; model?: string; language?: string
  }) => {
    const result = await api.subtitle.startSTT({
      subtitle_id: subtitleId,
      provider: opts?.provider,
      model: opts?.model,
      language: opts?.language,
    })
    listenToJob(api.subtitle.sttStatusUrl(result.job_id), result.job_id)
    return result
  }, [listenToJob])

  const startTranslate = useCallback(async (subtitleId: number, opts?: {
    source_lang?: string; target_lang?: string; provider?: string; model?: string; context?: string
  }) => {
    const result = await api.subtitle.startTranslate(subtitleId, opts ?? {})
    listenToJob(api.subtitle.translateStatusUrl(result.job_id), result.job_id)
    return result
  }, [listenToJob])

  const startHardsub = useCallback(async (subtitleId: number, style?: Partial<SubtitleStyleOptions>) => {
    const result = await api.subtitle.startHardsub(subtitleId, style)
    listenToJob(api.subtitle.hardsubStatusUrl(result.job_id), result.job_id)
    return result
  }, [listenToJob])

  const cancelJob = useCallback(async () => {
    if (jobIdRef.current) {
      await api.subtitle.cancelJob(jobIdRef.current)
    }
    cleanup()
    setJobProgress({ status: "cancelled", progress: 0, message: "Cancelled" })
  }, [cleanup])

  const reset = useCallback(() => {
    cleanup()
    setJobProgress({ status: "idle", progress: 0, message: "" })
  }, [cleanup])

  useEffect(() => cleanup, [cleanup])

  return {
    jobProgress,
    startSTT,
    startTranslate,
    startHardsub,
    cancelJob,
    reset,
  }
}

/** Hook to load subtitle data for a media item. */
export function useSubtitles(mediaType: string, mediaId: number | null) {
  const [subtitles, setSubtitles] = useState<SubtitleSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    if (!mediaId) return
    setLoading(true)
    setError("")
    try {
      const { subtitles: data } = await api.subtitle.list(mediaType, mediaId)
      setSubtitles(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load subtitles")
    } finally {
      setLoading(false)
    }
  }, [mediaType, mediaId])

  useEffect(() => { refresh() }, [refresh])

  return { subtitles, loading, error, refresh }
}

/** Hook to load segments for a subtitle. */
export function useSubtitleSegments(subtitleId: number | null) {
  const [segments, setSegments] = useState<SubtitleSegment[]>([])
  const [subtitle, setSubtitle] = useState<SubtitleSet | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!subtitleId) return
    setLoading(true)
    try {
      const data = await api.subtitle.getSegments(subtitleId)
      setSegments(data.segments)
      setSubtitle(data.subtitle)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [subtitleId])

  useEffect(() => { refresh() }, [refresh])

  return { segments, subtitle, loading, refresh, setSegments }
}
