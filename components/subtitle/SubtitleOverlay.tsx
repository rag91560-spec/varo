"use client"

import { useMemo, useRef, useEffect, useState, useCallback } from "react"
import type { SubtitleSegment, SubtitleStyleOptions } from "@/lib/types"

// ASS PlayResY — subtitle font sizes are defined relative to this
const ASS_PLAY_RES_Y = 1080

// Snap threshold (ratio) — snap to center when within this distance
const SNAP_THRESHOLD = 0.02

// Convert ASS &HAABBGGRR color to CSS rgba
function assColorToCss(assColor: string): string {
  const hex = assColor.replace(/^&H/i, "").padStart(8, "0")
  const a = parseInt(hex.slice(0, 2), 16)
  const b = parseInt(hex.slice(2, 4), 16)
  const g = parseInt(hex.slice(4, 6), 16)
  const r = parseInt(hex.slice(6, 8), 16)
  const alpha = (255 - a) / 255
  return `rgba(${r},${g},${b},${alpha})`
}

interface SubtitleOverlayProps {
  segments: SubtitleSegment[]
  currentTime: number
  displayMode: "original" | "translated" | "both"
  style?: SubtitleStyleOptions
  className?: string
  editable?: boolean
  onPositionChange?: (segmentId: number, posX: number, posY: number) => void
}

export function SubtitleOverlay({ segments, currentTime, displayMode, style, className = "", editable = false, onPositionChange }: SubtitleOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(480)
  const [dragging, setDragging] = useState(false)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const dragStartRef = useRef<{ offsetX: number; offsetY: number } | null>(null)

  // Measure parent container height for accurate font scaling
  useEffect(() => {
    const el = containerRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height || 480)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Binary search for active segment
  const activeSegment = useMemo(() => {
    if (!segments.length || currentTime < 0) return null
    let lo = 0, hi = segments.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (segments[mid].end_time < currentTime) lo = mid + 1
      else if (segments[mid].start_time > currentTime) hi = mid - 1
      else return segments[mid]
    }
    return null
  }, [segments, currentTime])

  // Reset drag state when active segment changes
  useEffect(() => {
    setDragging(false)
    setDragPos(null)
    dragStartRef.current = null
  }, [activeSegment?.id])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!editable || !containerRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const parent = containerRef.current.parentElement
    if (!parent) return

    const subtitleEl = containerRef.current
    const subtitleRect = subtitleEl.getBoundingClientRect()

    // Offset from cursor to subtitle element center
    dragStartRef.current = {
      offsetX: e.clientX - (subtitleRect.left + subtitleRect.width / 2),
      offsetY: e.clientY - (subtitleRect.top + subtitleRect.height / 2),
    }
    setDragging(true)
  }, [editable])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !dragStartRef.current || !containerRef.current) return
    const parent = containerRef.current.parentElement
    if (!parent) return

    const parentRect = parent.getBoundingClientRect()
    let x = (e.clientX - dragStartRef.current.offsetX - parentRect.left) / parentRect.width
    let y = (e.clientY - dragStartRef.current.offsetY - parentRect.top) / parentRect.height

    // Clamp to container
    x = Math.max(0.05, Math.min(0.95, x))
    y = Math.max(0.05, Math.min(0.95, y))

    // Snap to center
    if (Math.abs(x - 0.5) < SNAP_THRESHOLD) x = 0.5
    if (Math.abs(y - 0.5) < SNAP_THRESHOLD) y = 0.5

    setDragPos({ x, y })
  }, [dragging])

  const handleMouseUp = useCallback(() => {
    if (!dragging || !dragPos || !activeSegment) return
    setDragging(false)
    dragStartRef.current = null
    onPositionChange?.(activeSegment.id, dragPos.x, dragPos.y)
  }, [dragging, dragPos, activeSegment, onPositionChange])

  // Global mouse events for drag
  useEffect(() => {
    if (!dragging) return
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  if (!activeSegment) return <div ref={containerRef} className="hidden" />

  const original = activeSegment.original_text
  const translated = activeSegment.translated_text

  // Scale ASS font_size to preview container proportionally
  const scale = containerHeight / ASS_PLAY_RES_Y
  const fontSize = style ? `${Math.max(12, Math.round(style.font_size * scale))}px` : undefined
  const textColor = style ? assColorToCss(style.primary_color) : undefined
  const outlineColor = style ? assColorToCss(style.outline_color) : undefined
  const outlineWidth = style?.outline_width ?? 2
  const outlineSize = Math.max(1, Math.round(outlineWidth * scale))
  const textShadow = style && outlineColor && outlineWidth > 0
    ? `${outlineSize}px ${outlineSize}px 0 ${outlineColor}, -${outlineSize}px -${outlineSize}px 0 ${outlineColor}, ${outlineSize}px -${outlineSize}px 0 ${outlineColor}, -${outlineSize}px ${outlineSize}px 0 ${outlineColor}`
    : undefined

  // Determine position: per-segment custom pos or global alignment preset
  const hasDragPos = dragPos && dragging
  const hasCustomPos = activeSegment.pos_x != null && activeSegment.pos_y != null
  const useAbsolutePos = hasDragPos || hasCustomPos

  // Position styles
  let positionStyle: React.CSSProperties = {}
  let positionClass = ""

  if (useAbsolutePos) {
    const px = hasDragPos ? dragPos.x : activeSegment.pos_x!
    const py = hasDragPos ? dragPos.y : activeSegment.pos_y!
    positionStyle = {
      left: `${px * 100}%`,
      top: `${py * 100}%`,
      transform: "translate(-50%, -50%)",
    }
  } else {
    // Fallback: global alignment preset
    positionClass = style?.alignment === 8
      ? "top-4 left-1/2 -translate-x-1/2"
      : style?.alignment === 5
        ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        : "bottom-8 left-1/2 -translate-x-1/2"
  }

  const pointerClass = editable ? "pointer-events-auto" : "pointer-events-none"
  const cursorClass = editable ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""

  return (
    <>
      {/* Guide lines — visible only while dragging */}
      {dragging && (
        <>
          <div className="absolute top-1/2 left-0 w-full h-px bg-white/30 pointer-events-none z-30" />
          <div className="absolute left-1/2 top-0 h-full w-px bg-white/30 pointer-events-none z-30" />
        </>
      )}
      <div
        ref={containerRef}
        className={`absolute max-w-[90%] text-center ${pointerClass} ${cursorClass} ${positionClass} z-20 select-none ${className}`}
        style={positionStyle}
        onMouseDown={editable ? handleMouseDown : undefined}
      >
        {editable && hasCustomPos && !dragging && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-5 h-1.5 bg-white/40 rounded-full hover:bg-white/70 transition-colors" />
        )}
        <div className={`bg-black/75 px-4 py-2 rounded-lg inline-block ${dragging ? "ring-2 ring-blue-400/60" : ""}`}>
          {(displayMode === "original" || displayMode === "both") && original && (
            <p
              className="leading-relaxed whitespace-pre-wrap"
              style={{ fontSize, color: textColor || "#ffffff", textShadow }}
            >
              {original}
            </p>
          )}
          {(displayMode === "translated" || displayMode === "both") && translated && (
            <p
              className={`leading-relaxed whitespace-pre-wrap ${displayMode === "both" ? "mt-1 border-t border-white/20 pt-1" : ""}`}
              style={{ fontSize, color: textColor || "#ffff88", textShadow }}
            >
              {translated}
            </p>
          )}
        </div>
      </div>
    </>
  )
}
