"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import type { SubtitleSegment } from "@/lib/types"
import { api } from "@/lib/api"
import { MinusIcon, PlusIcon, SearchIcon, Scissors } from "lucide-react"

interface SubtitleTimelineProps {
  segments: SubtitleSegment[]
  duration: number
  currentTime: number
  selectedSegmentId?: number | null
  subtitleId?: number | null
  onSeek: (time: number) => void
  onSegmentSelect?: (segmentId: number | null) => void
  onSegmentTimingChange?: (segmentId: number, startTime: number, endTime: number) => void
  onSegmentCreate?: (startTime: number, endTime: number) => void
  onSegmentDelete?: (segmentId: number) => void
  onSegmentSplit?: (segmentId: number, splitTime: number) => void
  mediaId?: number
  mediaType?: "video" | "audio"
}

const MIN_ZOOM = 10   // px per second
const MAX_ZOOM = 200
const DEFAULT_ZOOM = 40
const MIN_SEGMENT_DURATION = 0.2
const SNAP_THRESHOLD = 0.15 // seconds — magnetic snap distance

function formatTimecode(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00.0"
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`
}

function formatTimecodeShort(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00"
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

/** Find the gap at a given time, bounded by adjacent segments or 0/duration */
function findGapAt(time: number, segments: SubtitleSegment[], duration: number): { start: number; end: number } | null {
  const sorted = [...segments].sort((a, b) => a.start_time - b.start_time)
  // Check if time is inside any segment
  for (const seg of sorted) {
    if (time >= seg.start_time && time <= seg.end_time) return null
  }
  // Find bounding gap
  let gapStart = 0
  let gapEnd = duration
  for (const seg of sorted) {
    if (seg.end_time <= time) {
      gapStart = seg.end_time
    }
    if (seg.start_time > time) {
      gapEnd = seg.start_time
      break
    }
  }
  if (gapEnd - gapStart < MIN_SEGMENT_DURATION) return null
  return { start: gapStart, end: gapEnd }
}

/** Magnetic snap to edges: playhead, segment boundaries */
function magneticSnap(
  value: number,
  anchors: number[],
  threshold: number,
): { snapped: number; anchor: number | null } {
  let closest = value
  let closestDist = Infinity
  let hitAnchor: number | null = null
  for (const a of anchors) {
    const d = Math.abs(value - a)
    if (d < threshold && d < closestDist) {
      closest = a
      closestDist = d
      hitAnchor = a
    }
  }
  return { snapped: closest, anchor: hitAnchor }
}

/** Find segment under playhead */
function segmentAtTime(time: number, segments: SubtitleSegment[]): SubtitleSegment | null {
  return segments.find(s => time >= s.start_time && time <= s.end_time) ?? null
}

function WaveformCanvas({ peaks, zoom, duration }: { peaks: number[]; zoom: number; duration: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || peaks.length === 0) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const width = duration * zoom
    const height = canvas.height
    canvas.width = width

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = "rgba(99, 102, 241, 0.15)" // indigo with low opacity

    const barWidth = width / peaks.length
    const mid = height / 2

    for (let i = 0; i < peaks.length; i++) {
      const peakHeight = peaks[i] * mid * 0.9
      const x = i * barWidth
      ctx.fillRect(x, mid - peakHeight, Math.max(barWidth - 0.5, 0.5), peakHeight * 2)
    }
  }, [peaks, zoom, duration])

  return (
    <canvas
      ref={canvasRef}
      height={80}
      className="absolute top-5 left-0 bottom-0 pointer-events-none opacity-60"
      style={{ width: duration * zoom, height: "calc(100% - 20px)" }}
    />
  )
}

export function SubtitleTimeline({
  segments,
  duration,
  currentTime,
  selectedSegmentId,
  subtitleId,
  onSeek,
  onSegmentSelect,
  onSegmentTimingChange,
  onSegmentCreate,
  onSegmentDelete,
  onSegmentSplit,
  mediaId,
  mediaType,
}: SubtitleTimelineProps) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM) // px per second
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<{
    type: "move" | "left" | "right"
    segmentId: number
    origStart: number
    origEnd: number
    startX: number
  } | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [snapLine, setSnapLine] = useState<number | null>(null) // visual snap indicator
  const [hoverTime, setHoverTime] = useState<number | null>(null)

  // Load waveform data
  useEffect(() => {
    if (!mediaId || !mediaType) return
    const samples = Math.min(Math.max(Math.round(duration * 10), 500), 5000)
    api.subtitle.getWaveform(mediaType, mediaId, samples)
      .then(r => setWaveformPeaks(r.peaks))
      .catch(() => {}) // Waveform is optional, fail silently
  }, [mediaId, mediaType, duration])

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    segmentId: number | null
    time: number
  } | null>(null)

  const totalWidth = Math.max(duration * zoom, 600)

  // Build snap anchors: all segment edges + playhead
  const snapAnchors = useMemo(() => {
    const anchors = new Set<number>()
    anchors.add(currentTime)
    for (const seg of segments) {
      anchors.add(seg.start_time)
      anchors.add(seg.end_time)
    }
    anchors.add(0)
    anchors.add(duration)
    return [...anchors]
  }, [segments, currentTime, duration])

  // Auto-scroll to playhead
  useEffect(() => {
    if (!autoScroll || !scrollRef.current || dragging) return
    const el = scrollRef.current
    const playheadX = currentTime * zoom
    const viewLeft = el.scrollLeft
    const viewRight = viewLeft + el.clientWidth
    if (playheadX < viewLeft + 40 || playheadX > viewRight - 40) {
      el.scrollLeft = playheadX - el.clientWidth * 0.3
    }
  }, [currentTime, zoom, autoScroll, dragging])

  // Ctrl+Wheel zoom (centered on cursor)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const el = scrollRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const oldZoom = zoom
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom - e.deltaY * 0.15))
      // Keep cursor position stable
      const timeAtCursor = (el.scrollLeft + cursorX) / oldZoom
      setZoom(newZoom)
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft = timeAtCursor * newZoom - cursorX
        }
      })
    }
  }, [zoom])

  // Track mouse position for hover time display
  const handleTrackMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
    setHoverTime(Math.max(0, Math.min(duration, x / zoom)))
  }, [dragging, duration, zoom])

  const handleTrackMouseLeave = useCallback(() => {
    setHoverTime(null)
  }, [])

  // Click on empty area → seek + deselect
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if (dragging) return
    if (!trackRef.current) return
    if ((e.target as HTMLElement).closest("[data-segment]")) return
    const rect = trackRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
    const time = Math.max(0, Math.min(duration, x / zoom))
    onSeek(time)
    setAutoScroll(true)
    onSegmentSelect?.(null)
  }, [dragging, duration, zoom, onSeek, onSegmentSelect])

  // Double-click on empty area → create segment (CapCut-style: fit into available gap)
  const handleTrackDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!trackRef.current || !onSegmentCreate) return
    if ((e.target as HTMLElement).closest("[data-segment]")) return
    const rect = trackRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
    const clickTime = Math.max(0, Math.min(duration, x / zoom))

    // Find the gap at click position
    const gap = findGapAt(clickTime, segments, duration)
    if (!gap) return // No gap here

    // Create segment: center around click, max 2s, clamp to gap
    const halfDur = Math.min(1, (gap.end - gap.start) / 2)
    let start = Math.max(gap.start, clickTime - halfDur)
    let end = Math.min(gap.end, clickTime + halfDur)
    // Ensure minimum duration
    if (end - start < MIN_SEGMENT_DURATION) {
      start = gap.start
      end = Math.min(gap.end, gap.start + MIN_SEGMENT_DURATION)
    }
    // Round to 0.1s
    start = Math.round(start * 10) / 10
    end = Math.round(end * 10) / 10
    if (end <= start) return
    onSegmentCreate(start, end)
  }, [duration, zoom, segments, onSegmentCreate])

  // Right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
    const time = Math.max(0, Math.min(duration, x / zoom))
    const segEl = (e.target as HTMLElement).closest("[data-segment]")
    const segmentId = segEl ? Number(segEl.getAttribute("data-segment-id")) : null
    setContextMenu({ x: e.clientX, y: e.clientY, segmentId, time })
  }, [duration, zoom])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const timer = setTimeout(() => {
      window.addEventListener("click", close)
      window.addEventListener("contextmenu", close)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("click", close)
      window.removeEventListener("contextmenu", close)
    }
  }, [contextMenu])

  // Keyboard shortcuts (CapCut-style)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return

      const sel = selectedSegmentId ? segments.find(s => s.id === selectedSegmentId) : null

      switch (e.key) {
        case "Delete":
        case "Backspace":
          if (sel && onSegmentDelete) {
            e.preventDefault()
            onSegmentDelete(sel.id)
          }
          break

        // B or Ctrl+B — split at playhead (CapCut style: auto-find segment under playhead)
        case "b":
        case "B":
          if (onSegmentSplit) {
            e.preventDefault()
            // First try selected segment, then auto-detect segment under playhead
            const target = sel && currentTime > sel.start_time && currentTime < sel.end_time
              ? sel
              : segmentAtTime(currentTime, segments)
            if (target) {
              onSegmentSplit(target.id, currentTime)
            }
          }
          break

        // S still works as alias for split (backward compat)
        case "s":
        case "S":
          if (onSegmentSplit) {
            e.preventDefault()
            const target = sel && currentTime > sel.start_time && currentTime < sel.end_time
              ? sel
              : segmentAtTime(currentTime, segments)
            if (target) {
              onSegmentSplit(target.id, currentTime)
            }
          }
          break

        case "i":
        case "I":
          if (sel && onSegmentTimingChange) {
            e.preventDefault()
            const { snapped } = magneticSnap(currentTime, snapAnchors.filter(a => a !== sel.start_time), SNAP_THRESHOLD)
            const newStart = Math.round(snapped * 10) / 10
            if (newStart < sel.end_time - MIN_SEGMENT_DURATION) {
              onSegmentTimingChange(sel.id, newStart, sel.end_time)
            }
          }
          break
        case "o":
        case "O":
          if (sel && onSegmentTimingChange) {
            e.preventDefault()
            const { snapped } = magneticSnap(currentTime, snapAnchors.filter(a => a !== sel.end_time), SNAP_THRESHOLD)
            const newEnd = Math.round(snapped * 10) / 10
            if (newEnd > sel.start_time + MIN_SEGMENT_DURATION) {
              onSegmentTimingChange(sel.id, sel.start_time, newEnd)
            }
          }
          break
        case "Escape":
          onSegmentSelect?.(null)
          setContextMenu(null)
          break
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedSegmentId, segments, currentTime, snapAnchors, onSegmentDelete, onSegmentSplit, onSegmentTimingChange, onSegmentSelect])

  // Drag handlers with magnetic snapping
  const startDrag = useCallback((
    e: React.MouseEvent,
    type: "move" | "left" | "right",
    seg: SubtitleSegment,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging({
      type,
      segmentId: seg.id,
      origStart: seg.start_time,
      origEnd: seg.end_time,
      startX: e.clientX,
    })
    setAutoScroll(false)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const seg = segments.find((s) => s.id === dragging.segmentId)
    if (!seg) return

    // Build anchors excluding this segment's own edges
    const anchors = snapAnchors.filter(a => a !== dragging.origStart && a !== dragging.origEnd)

    const sorted = [...segments].sort((a, b) => a.start_time - b.start_time)
    const idx = sorted.findIndex((s) => s.id === dragging.segmentId)
    const prevEnd = idx > 0 ? sorted[idx - 1].end_time : 0
    const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].start_time : duration

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragging.startX
      const dt = dx / zoom

      let newStart = dragging.origStart
      let newEnd = dragging.origEnd

      if (dragging.type === "left") {
        const raw = dragging.origStart + dt
        const { snapped, anchor } = magneticSnap(raw, anchors, SNAP_THRESHOLD)
        newStart = Math.max(prevEnd, Math.min(snapped, newEnd - MIN_SEGMENT_DURATION))
        newStart = Math.max(0, newStart)
        newStart = Math.round(newStart * 10) / 10
        setSnapLine(anchor)
      } else if (dragging.type === "right") {
        const raw = dragging.origEnd + dt
        const { snapped, anchor } = magneticSnap(raw, anchors, SNAP_THRESHOLD)
        newEnd = Math.max(newStart + MIN_SEGMENT_DURATION, Math.min(snapped, nextStart))
        newEnd = Math.min(duration, newEnd)
        newEnd = Math.round(newEnd * 10) / 10
        setSnapLine(anchor)
      } else {
        const segDuration = dragging.origEnd - dragging.origStart
        const rawStart = dragging.origStart + dt
        const { snapped: snappedStart, anchor: a1 } = magneticSnap(rawStart, anchors, SNAP_THRESHOLD)
        const { snapped: snappedEnd, anchor: a2 } = magneticSnap(rawStart + segDuration, anchors, SNAP_THRESHOLD)
        // Prefer whichever edge snapped
        if (a1 !== null) {
          newStart = Math.max(prevEnd, Math.min(snappedStart, nextStart - segDuration))
        } else if (a2 !== null) {
          newStart = Math.max(prevEnd, Math.min(snappedEnd - segDuration, nextStart - segDuration))
        } else {
          newStart = Math.max(prevEnd, Math.min(rawStart, nextStart - segDuration))
        }
        newStart = Math.max(0, Math.min(newStart, duration - segDuration))
        newStart = Math.round(newStart * 10) / 10
        newEnd = Math.round((newStart + segDuration) * 10) / 10
        setSnapLine(a1 ?? a2)
      }

      onSegmentTimingChange?.(dragging.segmentId, newStart, newEnd)
    }

    const onUp = () => {
      setDragging(null)
      setSnapLine(null)
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [dragging, segments, duration, zoom, snapAnchors, onSegmentTimingChange])

  // Split at playhead button handler
  const handleSplitAtPlayhead = useCallback(() => {
    if (!onSegmentSplit) return
    const sel = selectedSegmentId ? segments.find(s => s.id === selectedSegmentId) : null
    const target = sel && currentTime > sel.start_time && currentTime < sel.end_time
      ? sel
      : segmentAtTime(currentTime, segments)
    if (target) {
      onSegmentSplit(target.id, currentTime)
    }
  }, [selectedSegmentId, segments, currentTime, onSegmentSplit])

  // Ruler ticks
  const ticks = useMemo(() => {
    const result: { time: number; major: boolean }[] = []
    if (duration <= 0) return result
    let interval = 1
    if (zoom < 15) interval = 30
    else if (zoom < 25) interval = 10
    else if (zoom < 50) interval = 5
    else if (zoom < 100) interval = 2

    for (let t = 0; t <= duration; t += interval) {
      result.push({ time: t, major: true })
    }
    if (interval >= 2) {
      for (let t = interval / 2; t <= duration; t += interval) {
        result.push({ time: t, major: false })
      }
    }
    return result
  }, [duration, zoom])

  // Can we split right now?
  const canSplit = useMemo(() => {
    const sel = selectedSegmentId ? segments.find(s => s.id === selectedSegmentId) : null
    const target = sel && currentTime > sel.start_time && currentTime < sel.end_time
      ? sel
      : segmentAtTime(currentTime, segments)
    return !!target
  }, [selectedSegmentId, segments, currentTime])

  return (
    <div className="flex flex-col border-t bg-card" style={{ height: 160 }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b text-xs text-muted-foreground">
        {/* Zoom controls */}
        <button
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 10))}
          className="p-0.5 hover:text-foreground transition-colors"
          title="Zoom out"
        >
          <MinusIcon className="size-3" />
        </button>
        <div className="w-14 h-1 bg-muted rounded-full relative cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
            setZoom(Math.round(MIN_ZOOM + ratio * (MAX_ZOOM - MIN_ZOOM)))
          }}
        >
          <div
            className="absolute inset-y-0 left-0 bg-primary/60 rounded-full"
            style={{ width: `${((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%` }}
          />
        </div>
        <button
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 10))}
          className="p-0.5 hover:text-foreground transition-colors"
          title="Zoom in"
        >
          <PlusIcon className="size-3" />
        </button>
        <span className="font-mono text-[10px] w-10 text-center">{zoom}px/s</span>

        <div className="w-px h-3.5 bg-muted mx-1" />

        {/* Split button */}
        <button
          onClick={handleSplitAtPlayhead}
          disabled={!canSplit}
          className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
            canSplit
              ? "hover:bg-accent hover:text-foreground"
              : "opacity-30 cursor-not-allowed"
          }`}
          title="플레이헤드에서 분할 (B)"
        >
          <Scissors className="size-3" />
          <span className="text-[10px]">분할</span>
        </button>

        <div className="w-px h-3.5 bg-muted mx-1" />

        {/* Delete button */}
        <button
          onClick={() => {
            if (selectedSegmentId && onSegmentDelete) onSegmentDelete(selectedSegmentId)
          }}
          disabled={!selectedSegmentId}
          className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
            selectedSegmentId
              ? "hover:bg-destructive/10 hover:text-destructive"
              : "opacity-30 cursor-not-allowed"
          }`}
          title="선택 세그먼트 삭제 (Del)"
        >
          삭제
        </button>

        <div className="flex-1" />

        {/* Shortcut hints */}
        <span className="text-[10px] text-muted-foreground/50 hidden lg:inline">
          Dbl-click: 추가 | B: 분할 | Del: 삭제 | I/O: 시작/끝점
        </span>

        <div className="w-px h-3.5 bg-muted mx-1" />

        {/* Timecode display */}
        <span className="font-mono text-[10px] tabular-nums">
          {formatTimecodeShort(currentTime)} / {formatTimecodeShort(duration)}
        </span>
      </div>

      {/* Scrollable timeline */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden relative"
        onWheel={handleWheel}
        onScroll={() => {
          if (dragging) return
          setAutoScroll(false)
        }}
      >
        <div
          ref={trackRef}
          className="relative h-full select-none"
          style={{ width: totalWidth }}
          onClick={handleTrackClick}
          onDoubleClick={handleTrackDoubleClick}
          onContextMenu={handleContextMenu}
          onMouseMove={handleTrackMouseMove}
          onMouseLeave={handleTrackMouseLeave}
        >
          {/* Ruler */}
          <div className="absolute top-0 left-0 right-0 h-5 border-b border-muted">
            {ticks.map(({ time, major }) => (
              <div
                key={`${time}-${major}`}
                className="absolute top-0"
                style={{ left: time * zoom }}
              >
                <div
                  className={`w-px ${major ? "h-4 bg-muted-foreground/40" : "h-2 bg-muted-foreground/20"}`}
                />
                {major && (
                  <span className="absolute top-0 left-1 text-[9px] text-muted-foreground/60 whitespace-nowrap select-none">
                    {formatTimecodeShort(time)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Segment track area */}
          <div className="absolute top-5 bottom-0 left-0 right-0">
            {/* Waveform background */}
            {waveformPeaks.length > 0 && (
              <WaveformCanvas peaks={waveformPeaks} zoom={zoom} duration={duration} />
            )}

            {/* Gap hover indicator — shows where a new segment would be created */}
            {hoverTime !== null && !dragging && (
              <div
                className="absolute top-0 bottom-0 w-px bg-muted-foreground/20 pointer-events-none z-10"
                style={{ left: hoverTime * zoom }}
              >
                <span className="absolute -top-4 -translate-x-1/2 text-[9px] text-muted-foreground/60 bg-card px-1 rounded whitespace-nowrap">
                  {formatTimecode(hoverTime)}
                </span>
              </div>
            )}

            {/* Segment blocks */}
            {segments.map((seg) => {
              const left = seg.start_time * zoom
              const width = Math.max((seg.end_time - seg.start_time) * zoom, 4)
              const isSelected = selectedSegmentId === seg.id
              const isDragging = dragging?.segmentId === seg.id
              const original = (seg.original_text || "").slice(0, 60)
              const translated = (seg.translated_text || "").slice(0, 60)

              return (
                <div
                  key={seg.id}
                  data-segment
                  data-segment-id={seg.id}
                  className={`absolute top-1.5 bottom-1.5 rounded-sm cursor-pointer group transition-colors ${
                    isSelected
                      ? "bg-primary/40 ring-1 ring-primary shadow-sm"
                      : isDragging
                        ? "bg-primary/35 ring-1 ring-primary/50"
                        : "bg-primary/20 hover:bg-primary/30"
                  }`}
                  style={{ left, width }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSegmentSelect?.(seg.id)
                  }}
                  onMouseDown={(e) => {
                    if (!(e.target as HTMLElement).hasAttribute("data-handle")) {
                      startDrag(e, "move", seg)
                    }
                  }}
                >
                  {/* Left resize handle */}
                  <div
                    data-handle
                    className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-foreground/20 transition-colors rounded-l-sm"
                    onMouseDown={(e) => startDrag(e, "left", seg)}
                  />
                  {/* Right resize handle */}
                  <div
                    data-handle
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-foreground/20 transition-colors rounded-r-sm"
                    onMouseDown={(e) => startDrag(e, "right", seg)}
                  />
                  {/* Text preview */}
                  {width > 30 && (
                    <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 pointer-events-none select-none overflow-hidden">
                      {original && (
                        <div className="text-[10px] text-foreground/70 truncate leading-tight">
                          {original}
                        </div>
                      )}
                      {translated && (
                        <div className="text-[10px] text-primary/80 truncate leading-tight mt-px">
                          {translated}
                        </div>
                      )}
                      {!original && !translated && (
                        <div className="text-[10px] text-muted-foreground/40 truncate leading-tight italic">
                          empty
                        </div>
                      )}
                    </div>
                  )}
                  {/* Timing tooltip on hover */}
                  <div className="absolute -bottom-5 left-0 text-[9px] text-muted-foreground/60 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {formatTimecode(seg.start_time)} — {formatTimecode(seg.end_time)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Magnetic snap line */}
          {snapLine !== null && dragging && (
            <div
              className="absolute top-0 bottom-0 w-px bg-yellow-400/80 z-30 pointer-events-none"
              style={{ left: snapLine * zoom }}
            />
          )}

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none"
            style={{ left: currentTime * zoom }}
          >
            {/* Playhead head — triangle */}
            <div
              className="absolute -top-0 -left-[5px] w-0 h-0 pointer-events-none"
              style={{
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "7px solid rgb(239 68 68)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] min-w-[180px] py-1 bg-popover border rounded-md shadow-lg text-sm"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            top: Math.min(contextMenu.y, window.innerHeight - 120),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.segmentId ? (
            <>
              <button
                className="w-full px-3 py-1.5 text-left hover:bg-accent text-xs flex items-center justify-between"
                onClick={() => {
                  if (contextMenu.segmentId && onSegmentSplit) {
                    const seg = segments.find(s => s.id === contextMenu.segmentId)
                    if (seg && currentTime > seg.start_time && currentTime < seg.end_time) {
                      onSegmentSplit(seg.id, currentTime)
                    }
                  }
                  setContextMenu(null)
                }}
              >
                <span>플레이헤드에서 분할</span>
                <kbd className="text-[10px] text-muted-foreground bg-muted px-1 rounded">B</kbd>
              </button>
              <button
                className="w-full px-3 py-1.5 text-left hover:bg-accent text-xs text-destructive flex items-center justify-between"
                onClick={() => {
                  if (contextMenu.segmentId && onSegmentDelete) {
                    onSegmentDelete(contextMenu.segmentId)
                  }
                  setContextMenu(null)
                }}
              >
                <span>삭제</span>
                <kbd className="text-[10px] text-muted-foreground bg-muted px-1 rounded">Del</kbd>
              </button>
            </>
          ) : (
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-accent text-xs flex items-center justify-between"
              onClick={() => {
                if (onSegmentCreate) {
                  const clickTime = contextMenu.time
                  const gap = findGapAt(clickTime, segments, duration)
                  if (gap) {
                    const halfDur = Math.min(1, (gap.end - gap.start) / 2)
                    let start = Math.max(gap.start, clickTime - halfDur)
                    let end = Math.min(gap.end, clickTime + halfDur)
                    start = Math.round(start * 10) / 10
                    end = Math.round(end * 10) / 10
                    if (end > start) onSegmentCreate(start, end)
                  }
                }
                setContextMenu(null)
              }}
            >
              <span>여기에 자막 추가</span>
              <kbd className="text-[10px] text-muted-foreground bg-muted px-1 rounded">Dbl-click</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
