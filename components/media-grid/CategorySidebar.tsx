"use client"

import { useState, useRef, useEffect } from "react"
import {
  FolderIcon,
  PlusIcon,
  Edit3Icon,
  Trash2Icon,
} from "lucide-react"
import type { MediaCategory } from "@/lib/types"
import type { TranslationKey } from "@/lib/i18n"
import { useDropTarget, type DragPayload } from "@/hooks/use-media-dnd"

/* ─── Category Item ─── */
function CategoryItem({
  label,
  count,
  isActive,
  onClick,
  onContextMenu,
  isEditing,
  editValue,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  onDropItem,
}: {
  label: string
  count: number
  isActive: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  isEditing?: boolean
  editValue?: string
  onEditChange?: (v: string) => void
  onEditSubmit?: () => void
  onEditCancel?: () => void
  onDropItem?: (item: DragPayload) => void
}) {
  const drop = useDropTarget(onDropItem ?? (() => {}))
  const dropProps = onDropItem
    ? { onDragOver: drop.onDragOver, onDragLeave: drop.onDragLeave, onDrop: drop.onDrop }
    : {}

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...dropProps}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-all text-left ${
        drop.isOver && onDropItem
          ? "bg-accent/20 text-accent border-l-2 border-accent ring-1 ring-accent/40"
          : isActive
            ? "bg-accent/10 text-accent border-l-2 border-accent font-medium"
            : "text-text-secondary hover:text-text-primary hover:bg-overlay-4 border-l-2 border-transparent"
      }`}
    >
      <FolderIcon className="size-3.5 shrink-0" />
      {isEditing ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => onEditChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEditSubmit?.()
            if (e.key === "Escape") onEditCancel?.()
          }}
          onBlur={onEditCancel}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 bg-transparent border-none outline-none text-xs min-w-0"
        />
      ) : (
        <span className="flex-1 truncate">{label}</span>
      )}
      <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">
        {count}
      </span>
    </button>
  )
}

/* ─── Category Sidebar ─── */
export function CategorySidebar({
  categories,
  activeCategory,
  onSelect,
  totalCount,
  uncategorizedCount,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onMoveItem,
  collapsed,
  t,
}: {
  categories: MediaCategory[]
  activeCategory: number | null
  onSelect: (id: number | null) => void
  totalCount: number
  uncategorizedCount: number
  onCreateCategory: (name: string) => void
  onRenameCategory: (id: number, name: string) => void
  onDeleteCategory: (id: number) => void
  onMoveItem?: (itemId: number, categoryId: number | null) => void
  collapsed: boolean
  t: (key: TranslationKey) => string
}) {
  const [showNewInput, setShowNewInput] = useState(false)
  const [newName, setNewName] = useState("")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState("")
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showNewInput) inputRef.current?.focus()
  }, [showNewInput])

  if (collapsed) return null

  return (
    <div className="w-48 shrink-0 border-r border-border-subtle flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center px-3 py-2.5 border-b border-border-subtle">
        <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
          <FolderIcon className="size-3.5" />
          {t("categories")}
        </span>
      </div>

      {/* Category list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5 space-y-0.5">
        <CategoryItem
          label={t("platformAll")}
          count={totalCount}
          isActive={activeCategory === null}
          onClick={() => onSelect(null)}
        />
        <CategoryItem
          label={t("uncategorized")}
          count={uncategorizedCount}
          isActive={activeCategory === 0}
          onClick={() => onSelect(0)}
          onDropItem={onMoveItem ? (item) => onMoveItem(item.id, null) : undefined}
        />

        {categories.map((cat) => (
          <CategoryItem
            key={cat.id}
            label={cat.name}
            count={cat.item_count || 0}
            isActive={activeCategory === cat.id}
            onClick={() => onSelect(cat.id)}
            onDropItem={onMoveItem ? (item) => onMoveItem(item.id, cat.id) : undefined}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu({ id: cat.id, x: e.clientX, y: e.clientY })
            }}
            isEditing={editingId === cat.id}
            editValue={editingName}
            onEditChange={setEditingName}
            onEditSubmit={() => {
              if (editingName.trim()) {
                onRenameCategory(editingId!, editingName.trim())
              }
              setEditingId(null)
            }}
            onEditCancel={() => setEditingId(null)}
          />
        ))}
      </div>

      {/* New category */}
      <div className="px-1.5 py-2 border-t border-border-subtle">
        {showNewInput ? (
          <input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                onCreateCategory(newName.trim())
                setNewName("")
                setShowNewInput(false)
              }
              if (e.key === "Escape") {
                setShowNewInput(false)
                setNewName("")
              }
            }}
            onBlur={() => { setShowNewInput(false); setNewName("") }}
            placeholder={t("categoryName")}
            className="w-full px-2.5 py-1.5 rounded-md border border-accent/50 bg-background text-xs text-text-primary focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setShowNewInput(true)}
            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-tertiary hover:text-accent hover:bg-overlay-2 transition-all border border-dashed border-overlay-6"
          >
            <PlusIcon className="size-3" />
            {t("addCategory")}
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[120px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                const cat = categories.find((c) => c.id === contextMenu.id)
                if (cat) {
                  setEditingId(cat.id)
                  setEditingName(cat.name)
                }
                setContextMenu(null)
              }}
              className="w-full px-3 py-1.5 text-xs text-left text-text-secondary hover:bg-overlay-4 flex items-center gap-2"
            >
              <Edit3Icon className="size-3" />
              {t("rename")}
            </button>
            <button
              onClick={() => {
                onDeleteCategory(contextMenu.id)
                setContextMenu(null)
              }}
              className="w-full px-3 py-1.5 text-xs text-left text-error hover:bg-overlay-4 flex items-center gap-2"
            >
              <Trash2Icon className="size-3" />
              {t("delete")}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ─── Source Sidebar (Manga — static, no CRUD) ─── */
export function SourceSidebar({
  sources,
  activeSource,
  onSelect,
  counts,
  totalCount,
  collapsed,
  t,
}: {
  sources: string[]
  activeSource: string
  onSelect: (source: string) => void
  counts: Record<string, number>
  totalCount: number
  collapsed: boolean
  t: (key: TranslationKey) => string
}) {
  if (collapsed) return null

  return (
    <div className="w-48 shrink-0 border-r border-border-subtle flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center px-3 py-2.5 border-b border-border-subtle">
        <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
          <FolderIcon className="size-3.5" />
          {t("mangaSource") || "Source"}
        </span>
      </div>

      {/* Source list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5 space-y-0.5">
        <button
          onClick={() => onSelect("")}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-all text-left ${
            activeSource === ""
              ? "bg-accent/10 text-accent border-l-2 border-accent font-medium"
              : "text-text-secondary hover:text-text-primary hover:bg-overlay-4 border-l-2 border-transparent"
          }`}
        >
          <FolderIcon className="size-3.5 shrink-0" />
          <span className="flex-1 truncate">{t("mangaAll")}</span>
          <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">
            {totalCount}
          </span>
        </button>

        {sources.map((src) => (
          <button
            key={src}
            onClick={() => onSelect(src)}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-all text-left ${
              activeSource === src
                ? "bg-accent/10 text-accent border-l-2 border-accent font-medium"
                : "text-text-secondary hover:text-text-primary hover:bg-overlay-4 border-l-2 border-transparent"
            }`}
          >
            <FolderIcon className="size-3.5 shrink-0" />
            <span className="flex-1 truncate">{src}</span>
            <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">
              {counts[src] || 0}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
