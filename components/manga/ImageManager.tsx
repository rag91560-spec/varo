"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { XIcon, PlusIcon, Loader2Icon, Trash2Icon, GripVerticalIcon, SaveIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useLocale } from "@/hooks/use-locale"

interface ImageManagerProps {
  mangaId: number
  pageCount: number
  open: boolean
  onClose: () => void
  onUpdate: () => void
}

interface PageItem {
  page: number
  url: string
}

export function ImageManager({ mangaId, pageCount, open, onClose, onUpdate }: ImageManagerProps) {
  const { t } = useLocale()
  const [pages, setPages] = useState<PageItem[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // DnD state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Initialize pages from pageCount
  useEffect(() => {
    if (open) {
      const items: PageItem[] = []
      for (let i = 1; i <= pageCount; i++) {
        items.push({ page: i, url: api.manga.imageUrl(mangaId, i) })
      }
      setPages(items)
      setHasChanges(false)
    }
  }, [open, mangaId, pageCount])

  // --- Drag & Drop ---
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = "move"
    // Transparent drag image
    const el = e.currentTarget as HTMLElement
    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }

    setPages((prev) => {
      const items = [...prev]
      const [dragged] = items.splice(dragIndex, 1)
      items.splice(dropIndex, 0, dragged)
      return items
    })
    setHasChanges(true)
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex])

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  // --- Save reorder ---
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const order = pages.map((p) => p.page)
      await api.manga.reorder(mangaId, order)
      setHasChanges(false)
      onUpdate()
      onClose()
    } catch (e) {
      console.error("Reorder failed:", e)
    } finally {
      setSaving(false)
    }
  }, [pages, mangaId, onUpdate, onClose])

  // --- Delete image ---
  const handleDelete = useCallback(async (index: number) => {
    const item = pages[index]
    setDeleting(item.page)
    try {
      await api.manga.deleteImage(mangaId, item.page)
      onUpdate()
      // Refresh: re-fetch from server by closing and triggering update
      onClose()
    } catch (e) {
      console.error("Delete failed:", e)
    } finally {
      setDeleting(null)
    }
  }, [pages, mangaId, onUpdate, onClose])

  // --- Add images ---
  const handleAddFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const files = Array.from(e.target.files).sort((a, b) => a.name.localeCompare(b.name))
    setAdding(true)
    try {
      await api.manga.addImages(mangaId, files)
      onUpdate()
      onClose()
    } catch (err) {
      console.error("Add images failed:", err)
    } finally {
      setAdding(false)
      e.target.value = ""
    }
  }, [mangaId, onUpdate, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface border border-border-subtle rounded-2xl w-full max-w-2xl mx-4 shadow-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
          <h2 className="text-base font-semibold text-text-primary">{t("imageManagement")}</h2>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <Button size="sm" onClick={handleSave} loading={saving}>
                <SaveIcon className="size-4 mr-1" />
                {t("save")}
              </Button>
            )}
            <button onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-colors">
              <XIcon className="size-5" />
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {pages.map((item, index) => (
              <div
                key={`${item.page}-${index}`}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={cn(
                  "relative aspect-[3/4] rounded-lg overflow-hidden border-2 cursor-grab active:cursor-grabbing group transition-all",
                  dragIndex === index && "opacity-40",
                  dragOverIndex === index && dragIndex !== index && "border-accent scale-105",
                  dragOverIndex !== index && "border-transparent"
                )}
              >
                <img
                  src={`${item.url}?t=${Date.now()}`}
                  alt={`Page ${item.page}`}
                  className="w-full h-full object-cover pointer-events-none"
                  loading="lazy"
                />

                {/* Drag handle overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />

                {/* Grip icon */}
                <div className="absolute top-0.5 left-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GripVerticalIcon className="size-4 text-white drop-shadow" />
                </div>

                {/* Delete button */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(index) }}
                  className="absolute top-0.5 right-0.5 size-5 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-600"
                  disabled={deleting !== null}
                >
                  {deleting === item.page ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <Trash2Icon className="size-3" />
                  )}
                </button>

                {/* Page number */}
                <span className="absolute bottom-0.5 left-0.5 text-[10px] text-white bg-black/60 px-1 rounded">
                  {index + 1}
                </span>
              </div>
            ))}

            {/* Add button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "aspect-[3/4] rounded-lg border-2 border-dashed border-border-subtle",
                "flex flex-col items-center justify-center gap-1",
                "text-text-tertiary hover:border-accent/50 hover:text-accent transition-colors"
              )}
              disabled={adding}
            >
              {adding ? (
                <Loader2Icon className="size-5 animate-spin" />
              ) : (
                <>
                  <PlusIcon className="size-5" />
                  <span className="text-[10px]">{t("add")}</span>
                </>
              )}
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleAddFiles}
          className="hidden"
        />

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-subtle shrink-0 flex items-center justify-between">
          <span className="text-xs text-text-tertiary">
            {t("dragToReorder")} | {pages.length}{t("pageCount")}
          </span>
          {hasChanges && (
            <span className="text-xs text-accent">{t("hasChanges")}</span>
          )}
        </div>
      </div>
    </div>
  )
}
