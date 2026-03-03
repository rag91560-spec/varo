"use client"

import { useEffect, useRef } from "react"
import { api } from "@/lib/api"

const SYNC_INTERVAL = 60 * 60 * 1000 // 1 hour
const INITIAL_DELAY = 10 * 1000 // 10 seconds

export function SyncWorker() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const doSync = () => {
      api.sync.push().catch(() => {})
    }

    // Initial sync after delay
    const timeout = setTimeout(doSync, INITIAL_DELAY)

    // Periodic sync
    timerRef.current = setInterval(doSync, SYNC_INTERVAL)

    return () => {
      clearTimeout(timeout)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return null
}
