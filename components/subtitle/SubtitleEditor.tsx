"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import type { SubtitleSegment, SubtitleGlossaryEntry } from "@/lib/types"

interface SubtitleEditorProps {
  segments: SubtitleSegment[]
  currentTime: number
  onSeek?: (time: number) => void
  onSegmentsChange?: () => void
  glossary?: SubtitleGlossaryEntry[]
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`
}

function highlightGlossaryTerms(
  text: string,
  glossary: SubtitleGlossaryEntry[],
  field: "source" | "target"
): React.ReactNode {
  if (!glossary || glossary.length === 0) return text

  const terms = glossary
    .map(e => field === "source" ? e.source : e.target)
    .filter(t => t && t.length > 0)
    .sort((a, b) => b.length - a.length)

  if (terms.length === 0) return text

  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const regex = new RegExp(`(${escaped.join("|")})`, "gi")

  const parts = text.split(regex)
  if (parts.length <= 1) return text

  return parts.map((part, i) => {
    const entry = glossary.find(e => {
      const term = field === "source" ? e.source : e.target
      return term.toLowerCase() === part.toLowerCase()
    })
    if (entry) {
      const tooltip = field === "source"
        ? `${entry.source} → ${entry.target}`
        : `${entry.target} ← ${entry.source}`
      return (
        <mark
          key={i}
          className="bg-yellow-200/40 dark:bg-yellow-500/20 rounded-sm px-0.5 cursor-help relative group/mark"
          title={tooltip}
        >
          {part}
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] bg-popover border rounded shadow-sm whitespace-nowrap opacity-0 group-hover/mark:opacity-100 pointer-events-none z-50 transition-opacity">
            {tooltip}
          </span>
        </mark>
      )
    }
    return part
  })
}

export function SubtitleEditor({ segments, currentTime, onSeek, onSegmentsChange, glossary }: SubtitleEditorProps) {
  const { t } = useLocale()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState("")
  const [editField, setEditField] = useState<"original" | "translated">("translated")
  const [saving, setSaving] = useState(false)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Find active segment index
  const activeIdx = useMemo(() => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (currentTime >= segments[i].start_time && currentTime <= segments[i].end_time) return i
    }
    return -1
  }, [segments, currentTime])

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [activeIdx])

  const startEdit = (seg: SubtitleSegment, field: "original" | "translated") => {
    setEditingId(seg.id)
    setEditField(field)
    setEditText(field === "original" ? seg.original_text : seg.translated_text)
  }

  const saveEdit = async () => {
    if (editingId === null) return
    setSaving(true)
    try {
      await api.subtitle.updateSegment(editingId, {
        [editField === "original" ? "original_text" : "translated_text"]: editText,
      })
      onSegmentsChange?.()
    } catch {
      // ignore
    } finally {
      setSaving(false)
      setEditingId(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      saveEdit()
    } else if (e.key === "Escape") {
      setEditingId(null)
    }
  }


  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-background z-10 grid grid-cols-[80px_1fr_1fr] gap-2 px-3 py-2 border-b text-xs font-medium text-muted-foreground">
        <div>{t("subtitleDuration")}</div>
        <div>{t("subtitleOriginal")}</div>
        <div>{t("subtitleTranslation")}</div>
      </div>

      {/* Segments */}
      {segments.map((seg, idx) => {
        const isActive = idx === activeIdx
        const isLowConf = seg.confidence > 0 && seg.confidence < 0.7
        const isHovered = hoveredId === seg.id
        return (
          <div
            key={seg.id}
            ref={isActive ? activeRef : undefined}
            className={`group relative grid grid-cols-[80px_1fr_1fr] gap-2 px-3 py-1.5 border-b text-sm cursor-pointer transition-colors ${
              isActive
                ? "bg-primary/10 border-l-2 border-l-primary"
                : isLowConf
                  ? "bg-yellow-500/5 hover:bg-yellow-500/10"
                  : "hover:bg-accent/30"
            }`}
            onClick={() => onSeek?.(seg.start_time)}
            onMouseEnter={() => setHoveredId(seg.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Timestamp */}
            <div className="text-xs text-muted-foreground font-mono pt-0.5">
              {formatTime(seg.start_time)}
              {isLowConf && (
                <span className="block text-[10px] text-yellow-500" title={`${(seg.confidence * 100).toFixed(0)}%`}>
                  ⚠ {(seg.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>

            {/* Original */}
            <div
              className="min-h-[1.5em]"
              onDoubleClick={() => startEdit(seg, "original")}
            >
              {editingId === seg.id && editField === "original" ? (
                <textarea
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={saveEdit}
                  className="w-full bg-background border rounded px-1 py-0.5 text-sm resize-none"
                  rows={2}
                  disabled={saving}
                />
              ) : (
                <span className="whitespace-pre-wrap">{highlightGlossaryTerms(seg.original_text, glossary || [], "source")}</span>
              )}
            </div>

            {/* Translation */}
            <div
              className="min-h-[1.5em]"
              onDoubleClick={() => startEdit(seg, "translated")}
            >
              {editingId === seg.id && editField === "translated" ? (
                <textarea
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={saveEdit}
                  className="w-full bg-background border rounded px-1 py-0.5 text-sm resize-none"
                  rows={2}
                  disabled={saving}
                />
              ) : (
                <span className={`whitespace-pre-wrap ${seg.translated_text ? "text-foreground" : "text-muted-foreground italic"}`}>
                  {seg.translated_text ? highlightGlossaryTerms(seg.translated_text, glossary || [], "target") : "—"}
                </span>
              )}
            </div>

            {/* Hover action buttons */}
            {isHovered && editingId !== seg.id && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-background/90 backdrop-blur-sm border rounded-md px-1 py-0.5 shadow-sm">
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(seg, "original") }}
                  className="p-1 text-xs text-muted-foreground hover:text-primary rounded"
                  title={t("editSegment")}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                {seg.translated_text && (
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(seg, "translated") }}
                    className="p-1 text-xs text-muted-foreground hover:text-primary rounded"
                    title={t("subtitleTranslation")}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {segments.length === 0 && (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          {t("noSubtitles")}
        </div>
      )}
    </div>
  )
}
