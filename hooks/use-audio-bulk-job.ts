"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { AudioBulkJobStatus, AudioItem } from "@/lib/types"

const INITIAL: AudioBulkJobStatus = {
  status: "idle",
  progress: 0,
  done: 0,
  total: 0,
  current_title: "",
}

export function useAudioBulkJob() {
  const [jobProgress, setJobProgress] = useState<AudioBulkJobStatus>(INITIAL)
  const eventSourceRef = useRef<EventSource | null>(null)
  const jobIdRef = useRef<string>("")

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  const listenToJob = useCallback(
    (url: string, jobId: string, total: number) => {
      cleanup()
      jobIdRef.current = jobId
      setJobProgress({
        status: "running",
        progress: 0,
        done: 0,
        total,
        current_title: "",
      })

      const es = new EventSource(url)
      eventSourceRef.current = es

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          const { event: evtType, data } = msg

          switch (evtType) {
            case "init": {
              const d = data ?? {}
              setJobProgress((prev) => ({
                ...prev,
                status: d.status === "completed" ? "completed" : "running",
                done: d.done ?? prev.done,
                total: d.total ?? prev.total,
              }))
              break
            }
            case "progress": {
              const d = data ?? {}
              const tot = d.total ?? total ?? 1
              const done = d.done ?? 0
              setJobProgress((prev) => ({
                ...prev,
                status: "running",
                done,
                total: tot,
                progress: tot > 0 ? done / tot : 0,
                current_title: d.current_title ?? prev.current_title,
              }))
              break
            }
            case "complete": {
              const d = data ?? {}
              setJobProgress((prev) => ({
                ...prev,
                status: "completed",
                progress: 1,
                done: d.done ?? prev.total,
                total: d.total ?? prev.total,
                results: d.results,
                item_updates: (d.item_updates ?? []) as AudioItem[],
              }))
              cleanup()
              break
            }
            case "error": {
              const d = data ?? {}
              setJobProgress((prev) => ({
                ...prev,
                status: "error",
                error: d.message ?? "Unknown error",
              }))
              cleanup()
              break
            }
            case "cancelled": {
              const d = data ?? {}
              setJobProgress((prev) => ({
                ...prev,
                status: "cancelled",
                results: d.results ?? prev.results,
                item_updates: (d.item_updates ?? prev.item_updates) as AudioItem[] | undefined,
              }))
              cleanup()
              break
            }
            case "heartbeat":
              break
          }
        } catch {
          // ignore parse errors
        }
      }

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          cleanup()
        }
      }
    },
    [cleanup],
  )

  const startBulkJob = useCallback(
    async (body: {
      audio_ids: number[]
      mode?: "auto" | "script" | "auto_caption"
      source_lang?: string
      target_lang?: string
      provider?: string
      api_key?: string
      model?: string
      stt_provider?: string
      stt_api_key?: string
      use_category_glossary?: boolean
    }) => {
      const result = await api.audio.bulkTranslate(body)
      listenToJob(
        api.audio.bulkTranslateStatusUrl(result.job_id),
        result.job_id,
        result.total,
      )
      return result
    },
    [listenToJob],
  )

  const cancelJob = useCallback(async () => {
    if (jobIdRef.current) {
      try {
        await api.audio.bulkTranslateCancel(jobIdRef.current)
      } catch {
        // ignore — server will still be set via SSE
      }
    }
    cleanup()
    setJobProgress((prev) => ({ ...prev, status: "cancelled" }))
  }, [cleanup])

  const reset = useCallback(() => {
    cleanup()
    jobIdRef.current = ""
    setJobProgress(INITIAL)
  }, [cleanup])

  useEffect(() => cleanup, [cleanup])

  return {
    jobProgress,
    startBulkJob,
    cancelJob,
    reset,
  }
}
