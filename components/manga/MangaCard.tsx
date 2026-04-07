"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { MangaItem, MediaCategory } from "@/lib/types"
import { CheckIcon, FolderIcon } from "lucide-react"
import { useLocale } from "@/hooks/use-locale"
import { useDragItem, useMergeTarget } from "@/hooks/use-media-dnd"

interface MangaCardProps {
  manga: MangaItem
  onClick: () => void
  onDelete?: (id: number) => void
  onChangeThumbnail?: (id: number) => void
  selectable?: boolean
  selected?: boolean
  onSelect?: (checked: boolean) => void
  categories?: MediaCategory[]
  onMoveToCategory?: (categoryId: number | null) => void
  onMergeDrop?: (draggedId: number) => void
}

export function MangaCard({
  manga,
  onClick,
  onDelete,
  onChangeThumbnail,
  selectable,
  selected,
  onSelect,
  categories,
  onMoveToCategory,
  onMergeDrop,
}: MangaCardProps) {
  const { t } = useLocale()
  const [showMenu, setShowMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  // DnD: drag source
  const drag = useDragItem("manga", manga.id)

  // DnD: merge target
  const mergeHandler = useCallback(
    (draggedId: number) => { if (draggedId !== manga.id) onMergeDrop?.(draggedId) },
    [manga.id, onMergeDrop],
  )
  const merge = useMergeTarget(mergeHandler)
  const mergeProps = onMergeDrop
    ? { onDragOver: merge.onDragOver, onDragLeave: merge.onDragLeave, onDrop: merge.onDrop }
    : {}

  // Translation progress
  const translatedPages = manga.translated_pages ?? 0
  const totalPages = manga.page_count
  const progressPct = totalPages > 0 ? Math.min((translatedPages / totalPages) * 100, 100) : 0
  const isFullyTranslated = translatedPages >= totalPages && totalPages > 0

  // Close context menu on outside click
  useEffect(() => {
    if (!showMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [showMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onMoveToCategory || !categories) return
    e.preventDefault()
    e.stopPropagation()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setShowMenu(true)
  }

  return (
    <>
      <div
        className={cn(
          "group relative aspect-[3/4] rounded-xl overflow-hidden cursor-pointer",
          "border transition-all duration-200",
          merge.showMerge
            ? "border-accent ring-2 ring-accent/50 animate-pulse"
            : selected
              ? "border-accent shadow-md shadow-accent/20 ring-1 ring-accent/30"
              : "border-transparent hover:border-accent hover:shadow-[0_0_12px_var(--accent-muted)] hover:scale-[1.03]",
        )}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        draggable={drag.draggable}
        onDragStart={drag.onDragStart}
        onDragEnd={drag.onDragEnd}
        {...mergeProps}
      >
        {/* Cover image fills entire card */}
        {manga.thumbnail_path ? (
          <img
            src={api.manga.thumbnailUrl(manga.id)}
            alt={manga.title}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 w-full h-full bg-surface-elevated flex items-center justify-center text-text-tertiary">
            <svg className="size-12 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </div>
        )}

        {/* Bottom gradient overlay */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />

        {/* Bottom text: title + page count */}
        <div className="absolute inset-x-0 bottom-0 px-2.5 pb-3 pt-6 pointer-events-none">
          <h3 className="text-[13px] font-semibold text-white truncate leading-tight" title={manga.title}>
            {manga.title}
          </h3>
          <p className="text-[10px] text-white/70 mt-0.5">
            {manga.page_count}p
          </p>
        </div>

        {/* Translation progress bar */}
        {translatedPages > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-[3px]">
            <div
              className={cn(
                "h-full transition-all",
                isFullyTranslated ? "bg-success" : "bg-accent"
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}

        {/* Selection checkbox */}
        {selectable && (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect?.(!selected) }}
            className={cn(
              "absolute top-2 left-2 size-5 rounded border-2 flex items-center justify-center transition-all z-10",
              selected
                ? "bg-accent border-accent text-white"
                : "border-white/60 bg-black/30 opacity-0 group-hover:opacity-100 hover:border-white"
            )}
          >
            {selected && <CheckIcon className="size-3.5" strokeWidth={3} />}
          </button>
        )}

        {/* Selected overlay */}
        {selected && (
          <div className="absolute inset-0 bg-accent/10 pointer-events-none" />
        )}

        {/* Merge overlay */}
        {merge.showMerge && (
          <div className="absolute inset-0 bg-accent/20 flex items-center justify-center pointer-events-none z-20">
            <span className="bg-accent text-white text-xs font-bold px-3 py-1.5 rounded-lg">
              {t("createGroup") || "그룹 만들기"}
            </span>
          </div>
        )}
      </div>

      {/* Context menu for moving to category */}
      {showMenu && onMoveToCategory && categories && (
        <div
          ref={menuRef}
          className="fixed z-[100] min-w-[160px] rounded-lg border border-border-subtle bg-surface shadow-xl py-1"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
            {t("moveToCategory") || "Move to"}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMoveToCategory(null)
              setShowMenu(false)
            }}
            className={cn(
              "w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-overlay-4",
              !manga.category_id ? "text-accent font-medium" : "text-text-secondary"
            )}
          >
            {t("uncategorized")}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={(e) => {
                e.stopPropagation()
                onMoveToCategory(cat.id)
                setShowMenu(false)
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-overlay-4",
                manga.category_id === cat.id ? "text-accent font-medium" : "text-text-secondary"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
