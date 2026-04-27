"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Loader2Icon, Trash2Icon, CheckIcon, XIcon, RefreshCwIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useLocale } from "@/hooks/use-locale"
import type { MangaTranslationEntry } from "@/lib/types"

interface RegionEditorProps {
  mangaId: number
  page: number
  entries: MangaTranslationEntry[]
  onChange: (entries: MangaTranslationEntry[]) => void
}

interface DraftRegion {
  x: number; y: number; width: number; height: number
  status: "drawing" | "translating" | "done" | "error"
  original?: string
  translated?: string
  error?: string
}

const COLORS = ["#3b82f6","#10b981","#ef4444","#f59e0b","#8b5cf6","#ec4899"]

export function RegionEditor({ mangaId, page, entries, onChange }: RegionEditorProps) {
  const { t } = useLocale()
  const containerRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<DraftRegion | null>(null)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const toRatio = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    }
  }, [])

  // ─── Draw new region ───────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement) !== containerRef.current) return
    e.preventDefault()
    const { x, y } = toRatio(e.clientX, e.clientY)
    setDrawStart({ x, y })
    setDraft({ x, y, width: 0, height: 0, status: "drawing" })
    setSelectedIdx(null)
  }, [toRatio])

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!drawStart) return
    const { x, y } = toRatio(e.clientX, e.clientY)
    setDraft({
      x: Math.min(drawStart.x, x),
      y: Math.min(drawStart.y, y),
      width: Math.abs(x - drawStart.x),
      height: Math.abs(y - drawStart.y),
      status: "drawing",
    })
  }, [drawStart, toRatio])

  const onMouseUp = useCallback(async () => {
    if (!drawStart || !draft) { setDrawStart(null); return }
    setDrawStart(null)

    if (draft.width < 0.02 || draft.height < 0.02) {
      setDraft(null)
      return
    }

    // Start OCR+translate
    const region = { x: draft.x, y: draft.y, width: draft.width, height: draft.height }
    setDraft(prev => prev ? { ...prev, status: "translating" } : null)

    try {
      const result = await api.manga.translateRegion(mangaId, page, region)
      setDraft(prev => prev ? {
        ...prev,
        status: "done",
        original: result.original,
        translated: result.translated,
      } : null)
      // Auto-add to entries (already saved by backend)
      onChange([...entries, result])
      setDraft(null)
    } catch (e) {
      setDraft(prev => prev ? {
        ...prev,
        status: "error",
        error: e instanceof Error ? e.message : t("translationFailed"),
      } : null)
    }
  }, [draft, drawStart, mangaId, page, entries, onChange])

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  const deleteEntry = (idx: number) => {
    onChange(entries.filter((_, i) => i !== idx))
    if (selectedIdx === idx) setSelectedIdx(null)
  }

  const retryDraft = () => setDraft(null)

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 select-none"
      style={{ cursor: drawStart ? "crosshair" : "crosshair" }}
      onMouseDown={onMouseDown}
    >
      {/* Hint */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
        <div className="px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-sm text-white text-[11px] font-medium">
          {t("dragToAutoTranslate")}
        </div>
      </div>

      {/* Confirmed regions */}
      {entries.map((entry, i) => {
        const color = COLORS[i % COLORS.length]
        const isSelected = selectedIdx === i
        return (
          <div
            key={i}
            className={cn(
              "absolute border-2 rounded transition-all cursor-pointer group",
              isSelected ? "z-20" : "z-10"
            )}
            style={{
              left: `${entry.x * 100}%`,
              top: `${entry.y * 100}%`,
              width: `${entry.width * 100}%`,
              height: `${entry.height * 100}%`,
              borderColor: color,
              background: `${color}22`,
            }}
            onMouseDown={(e) => { e.stopPropagation(); setSelectedIdx(isSelected ? null : i) }}
          >
            {/* Number badge */}
            <span
              className="absolute -top-5 left-0 text-[10px] font-bold text-white px-1.5 py-0.5 rounded-sm"
              style={{ background: color }}
            >
              {i + 1}
            </span>

            {/* Translated text preview */}
            {!isSelected && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[10px] text-white font-medium px-1 text-center line-clamp-3 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  {entry.translated}
                </span>
              </div>
            )}

            {/* Selected: edit panel */}
            {isSelected && (
              <div
                className="absolute left-full top-0 ml-2 z-30 bg-surface border border-border rounded-lg shadow-xl p-3 w-52 text-left"
                onMouseDown={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-text-primary">{t("region")} {i + 1}</span>
                  <button onClick={() => deleteEntry(i)} className="text-destructive hover:opacity-70">
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
                {entry.original && (
                  <p className="text-[10px] text-text-tertiary mb-1.5 line-clamp-2 leading-relaxed">{entry.original}</p>
                )}
                <p className="text-xs font-medium text-text-primary leading-relaxed">{entry.translated}</p>
              </div>
            )}
          </div>
        )
      })}

      {/* Draft region being drawn / translating */}
      {draft && draft.width > 0.005 && (
        <div
          className="absolute z-25 border-2 border-dashed border-white rounded pointer-events-none"
          style={{
            left: `${draft.x * 100}%`,
            top: `${draft.y * 100}%`,
            width: `${draft.width * 100}%`,
            height: `${draft.height * 100}%`,
            background: "rgba(255,255,255,0.1)",
          }}
        >
          {/* Status overlay */}
          {draft.status === "translating" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded">
              <Loader2Icon className="size-5 text-white animate-spin" />
            </div>
          )}
          {draft.status === "error" && (
            <div
              className="absolute top-full left-0 mt-1 z-30 bg-surface border border-destructive rounded-lg shadow-xl p-2 min-w-36 pointer-events-auto"
              onMouseDown={e => e.stopPropagation()}
            >
              <p className="text-[10px] text-destructive mb-1.5">{draft.error}</p>
              <div className="flex gap-1">
                <button onClick={retryDraft} className="flex-1 flex items-center justify-center gap-1 text-[11px] px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-text-secondary">
                  <RefreshCwIcon className="size-3" /> {t("retry")}
                </button>
                <button onClick={() => setDraft(null)} className="px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary">
                  <XIcon className="size-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
