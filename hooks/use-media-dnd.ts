"use client"

import { useCallback, useRef, useState } from "react"

// --- Module-level drag state (avoids dataTransfer serialization issues) ---

export interface DragPayload {
  type: "game" | "video" | "audio" | "manga"
  id: number
}

let _draggedItem: DragPayload | null = null

export function getDraggedItem() {
  return _draggedItem
}

const MIME = "application/x-media-item"

// --- useDragItem: makes an element draggable ---

export function useDragItem(type: DragPayload["type"], id: number) {
  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      const payload: DragPayload = { type, id }
      _draggedItem = payload
      e.dataTransfer.setData(MIME, JSON.stringify(payload))
      // Backwards compat for game library
      if (type === "game") {
        e.dataTransfer.setData("application/x-game-id", String(id))
      }
      e.dataTransfer.effectAllowed = "move"
    },
    [type, id],
  )

  const onDragEnd = useCallback(() => {
    _draggedItem = null
  }, [])

  return { onDragStart, onDragEnd, draggable: true }
}

// --- useDropTarget: makes a folder/category item a drop target ---

export function useDropTarget(onDrop: (item: DragPayload) => void) {
  const [isOver, setIsOver] = useState(false)

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      // Only accept internal media items, not external files
      if (!e.dataTransfer.types.includes(MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      setIsOver(true)
    },
    [],
  )

  const onDragLeave = useCallback(() => {
    setIsOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsOver(false)
      const item = _draggedItem
      if (!item) return
      onDrop(item)
      _draggedItem = null
    },
    [onDrop],
  )

  return { isOver, onDragOver, onDragLeave, onDrop: handleDrop }
}

// --- useMergeTarget: hover 500ms on another card → merge indicator ---

export function useMergeTarget(
  onMerge: (draggedId: number) => void,
  delayMs = 500,
) {
  const [showMerge, setShowMerge] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      if (!timerRef.current && !showMerge) {
        timerRef.current = setTimeout(() => {
          setShowMerge(true)
          timerRef.current = null
        }, delayMs)
      }
    },
    [delayMs, showMerge],
  )

  const onDragLeave = useCallback(() => {
    clearTimer()
    setShowMerge(false)
  }, [clearTimer])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      clearTimer()
      setShowMerge(false)
      const item = _draggedItem
      if (!item) return
      onMerge(item.id)
      _draggedItem = null
    },
    [onMerge, clearTimer],
  )

  return { showMerge, onDragOver, onDragLeave, onDrop: handleDrop }
}
