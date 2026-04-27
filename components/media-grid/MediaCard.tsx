"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { FilmIcon, MusicIcon, Trash2Icon, ClockIcon, FolderIcon, CheckIcon, ImagePlusIcon } from "lucide-react"
import { useLocale } from "@/hooks/use-locale"
import type { MediaCategory } from "@/lib/types"
import { useDragItem, useMergeTarget } from "@/hooks/use-media-dnd"

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return ""
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return ""
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

interface MediaCardProps {
  id?: number
  title: string
  thumbnail?: string
  mediaType: "video" | "audio"
  duration?: number
  size?: number
  categoryId?: number | null
  categories?: MediaCategory[]
  isActive?: boolean
  selectable?: boolean
  selected?: boolean
  onSelect?: (checked: boolean) => void
  onClick: () => void
  onDelete?: () => void
  onChangeThumbnail?: () => void
  onMoveToCategory?: (categoryId: number | null) => void
  onMergeDrop?: (draggedId: number) => void
}

export function MediaCard({
  id,
  title,
  thumbnail,
  mediaType,
  duration,
  size,
  categoryId,
  categories,
  isActive,
  selectable,
  selected,
  onSelect,
  onClick,
  onDelete,
  onChangeThumbnail,
  onMoveToCategory,
  onMergeDrop,
}: MediaCardProps) {
  const { t } = useLocale()
  const isVideo = mediaType === "video"
  const FallbackIcon = isVideo ? FilmIcon : MusicIcon
  const [showMenu, setShowMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  // DnD: drag source
  const drag = useDragItem(mediaType, id ?? 0)
  const dragProps = id
    ? { draggable: drag.draggable, onDragStart: drag.onDragStart, onDragEnd: drag.onDragEnd }
    : {}

  // DnD: merge target
  const mergeHandler = useCallback(
    (draggedId: number) => { if (draggedId !== id) onMergeDrop?.(draggedId) },
    [id, onMergeDrop],
  )
  const merge = useMergeTarget(mergeHandler)
  const mergeProps = onMergeDrop && id
    ? { onDragOver: merge.onDragOver, onDragLeave: merge.onDragLeave, onDrop: merge.onDrop }
    : {}

  const currentCatName = categories?.find((c) => c.id === categoryId)?.name

  // Close menu on outside click
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

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect?.(!selected)
  }

  return (
    <>
      <div
        className={cn(
          "group relative rounded-xl overflow-hidden cursor-pointer",
          "bg-surface border",
          merge.showMerge
            ? "border-accent ring-2 ring-accent/50 animate-pulse"
            : selected
              ? "border-accent shadow-md shadow-accent/20 ring-1 ring-accent/30"
              : isActive
                ? "border-accent shadow-md shadow-accent/10"
                : "border-border-subtle hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5",
          "transition-all duration-200"
        )}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        {...dragProps}
        {...mergeProps}
      >
        {/* Thumbnail */}
        <div className={cn(
          "bg-surface-elevated relative overflow-hidden",
          isVideo ? "aspect-video" : "aspect-square"
        )}>
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-tertiary">
              <FallbackIcon className="size-10 opacity-20" />
            </div>
          )}

          {/* Selection checkbox */}
          {selectable && (
            <button
              onClick={handleCheckboxClick}
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

          {/* Duration badge */}
          {!!duration && duration > 0 && (
            <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1">
              <ClockIcon className="size-3" />
              {formatDuration(duration)}
            </div>
          )}

          {/* Size badge */}
          {!!size && size > 0 && (
            <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
              {formatSize(size)}
            </div>
          )}

          {/* Delete button */}
          {onDelete && !selected && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-black/60 hover:bg-error/80 text-white p-1.5 rounded-lg transition-all"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          )}

          {/* Change thumbnail button */}
          {onChangeThumbnail && !selected && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onChangeThumbnail()
              }}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-black/60 hover:bg-accent/80 text-white p-2 rounded-full transition-all z-10"
              title={t("changeThumbnail")}
            >
              <ImagePlusIcon className="size-4" />
            </button>
          )}

          {/* Active indicator */}
          {isActive && !selected && (
            <div className="absolute top-2 left-2">
              <span className="size-2.5 rounded-full bg-accent animate-pulse inline-block" />
            </div>
          )}

          {/* Selected overlay */}
          {selected && (
            <div className="absolute inset-0 bg-accent/10 pointer-events-none" />
          )}

          {/* Merge overlay */}
          {merge.showMerge && (
            <div className="absolute inset-0 bg-accent/20 flex items-center justify-center pointer-events-none z-20">
              <span className="bg-accent text-white text-xs font-bold px-3 py-1.5 rounded-lg">
                {t("createGroup")}
              </span>
            </div>
          )}
        </div>

        {/* Title + category */}
        <div className="p-2.5">
          <h3 className="text-sm font-medium text-text-primary truncate" title={title}>
            {title}
          </h3>
          {currentCatName && (
            <p className="text-[10px] text-text-tertiary mt-0.5 flex items-center gap-1 truncate">
              <FolderIcon className="size-3 shrink-0" />
              {currentCatName}
            </p>
          )}
        </div>
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
              !categoryId ? "text-accent font-medium" : "text-text-secondary"
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
                categoryId === cat.id ? "text-accent font-medium" : "text-text-secondary"
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
