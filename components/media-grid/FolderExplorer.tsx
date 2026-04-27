"use client"

import { useMemo, useState, useEffect, useRef } from "react"
import { ChevronRightIcon, HomeIcon, FolderPlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLocale } from "@/hooks/use-locale"
import type { MediaCategory } from "@/lib/types"
import { useDropTarget } from "@/hooks/use-media-dnd"
import { FolderCard } from "./FolderCard"
import { MediaGrid } from "./MediaGrid"

interface BreadcrumbButtonProps {
  folderId: number | null
  label: React.ReactNode
  active?: boolean
  onClick: () => void
  onDropItem?: (folderId: number | null, itemId: number) => void
}

function BreadcrumbButton({ folderId, label, active, onClick, onDropItem }: BreadcrumbButtonProps) {
  const drop = useDropTarget((payload) => {
    if (!onDropItem) return
    onDropItem(folderId, payload.id)
  })
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded transition-colors shrink-0",
        active
          ? "text-text-primary font-medium"
          : "text-text-secondary hover:bg-overlay-4 hover:text-text-primary",
        drop.isOver && "bg-accent/20 ring-1 ring-accent",
      )}
      onDragOver={onDropItem ? drop.onDragOver : undefined}
      onDragLeave={onDropItem ? drop.onDragLeave : undefined}
      onDrop={onDropItem ? drop.onDrop : undefined}
    >
      {label}
    </button>
  )
}

interface FolderExplorerProps<T extends { id: number; category_id: number | null }> {
  categories: MediaCategory[]
  items: T[] // all items (unfiltered by folder); FolderExplorer does the folder filtering
  currentFolderId: number | null // null = root
  onNavigate: (folderId: number | null) => void
  onCreateFolder?: (name: string, parentId: number | null) => void
  onDropItemToFolder?: (itemId: number, folderId: number | null) => void
  onFolderContextMenu?: (folderId: number, e: React.MouseEvent) => void
  renderItem: (item: T) => React.ReactNode
  emptyState?: React.ReactNode
}

export function FolderExplorer<T extends { id: number; category_id: number | null }>({
  categories,
  items,
  currentFolderId,
  onNavigate,
  onCreateFolder,
  onDropItemToFolder,
  onFolderContextMenu,
  renderItem,
  emptyState,
}: FolderExplorerProps<T>) {
  const { t } = useLocale()
  const categoryMap = useMemo(() => {
    const m = new Map<number, MediaCategory>()
    for (const c of categories) m.set(c.id, c)
    return m
  }, [categories])

  // Child folders of current
  const childFolders = useMemo(() => {
    return categories
      .filter((c) => (c.parent_id ?? null) === currentFolderId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  }, [categories, currentFolderId])

  // Items in current folder
  const currentItems = useMemo(() => {
    return items.filter((i) => (i.category_id ?? null) === currentFolderId)
  }, [items, currentFolderId])

  // Breadcrumb chain: root -> ... -> current
  const breadcrumb = useMemo(() => {
    if (currentFolderId === null) return [] as MediaCategory[]
    const chain: MediaCategory[] = []
    let cur = categoryMap.get(currentFolderId)
    const guard = new Set<number>()
    while (cur && !guard.has(cur.id)) {
      chain.unshift(cur)
      guard.add(cur.id)
      if (cur.parent_id == null) break
      cur = categoryMap.get(cur.parent_id)
    }
    return chain
  }, [categoryMap, currentFolderId])

  // For counts on folder cards, precompute direct children + item counts per folder
  const counts = useMemo(() => {
    const childCountByParent = new Map<number, number>()
    for (const c of categories) {
      if (c.parent_id != null) {
        childCountByParent.set(c.parent_id, (childCountByParent.get(c.parent_id) ?? 0) + 1)
      }
    }
    const itemCountByCat = new Map<number, number>()
    for (const it of items) {
      if (it.category_id != null) {
        itemCountByCat.set(it.category_id, (itemCountByCat.get(it.category_id) ?? 0) + 1)
      }
    }
    return { childCountByParent, itemCountByCat }
  }, [categories, items])

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (newFolderOpen) {
      const id = window.setTimeout(() => {
        newFolderInputRef.current?.focus()
        newFolderInputRef.current?.select()
      }, 0)
      return () => window.clearTimeout(id)
    }
  }, [newFolderOpen])

  const openNewFolder = () => {
    if (!onCreateFolder) return
    setNewFolderName(t("newFolder"))
    setNewFolderOpen(true)
  }

  const submitNewFolder = () => {
    const name = newFolderName.trim()
    if (!name) return
    onCreateFolder?.(name, currentFolderId)
    setNewFolderOpen(false)
  }

  const isEmpty = childFolders.length === 0 && currentItems.length === 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-1 py-2 text-sm overflow-x-auto">
        <BreadcrumbButton
          folderId={null}
          label={
            <>
              <HomeIcon className="size-4" />
              <span>{t("root")}</span>
            </>
          }
          active={currentFolderId === null}
          onClick={() => onNavigate(null)}
          onDropItem={onDropItemToFolder ? (fid, iid) => onDropItemToFolder(iid, fid) : undefined}
        />
        {breadcrumb.map((cat, idx) => (
          <div key={cat.id} className="flex items-center gap-1 shrink-0">
            <ChevronRightIcon className="size-3.5 text-text-tertiary" />
            <BreadcrumbButton
              folderId={cat.id}
              label={cat.name}
              active={idx === breadcrumb.length - 1}
              onClick={() => onNavigate(cat.id)}
              onDropItem={
                onDropItemToFolder ? (fid, iid) => onDropItemToFolder(iid, fid) : undefined
              }
            />
          </div>
        ))}
        <div className="flex-1" />
        {onCreateFolder && (
          <button
            onClick={openNewFolder}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded hover:bg-overlay-4 text-text-secondary hover:text-text-primary transition-colors shrink-0"
            title={t("newFolder")}
          >
            <FolderPlusIcon className="size-3.5" />
            {t("newFolder")}
          </button>
        )}
      </div>

      {/* New folder dialog */}
      {newFolderOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setNewFolderOpen(false)}
        >
          <div
            className="w-[360px] rounded-lg border border-border-subtle bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-text-primary mb-3">{t("createNewFolder")}</h3>
            <input
              ref={newFolderInputRef}
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submitNewFolder()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  setNewFolderOpen(false)
                }
              }}
              className="w-full px-3 py-2 rounded-md text-sm bg-surface-elevated border border-border-subtle text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/50"
              placeholder={t("folderName")}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setNewFolderOpen(false)}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-overlay-4 text-text-secondary hover:text-text-primary transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                onClick={submitNewFolder}
                disabled={!newFolderName.trim()}
                className="px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t("create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Explorer body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isEmpty ? (
          emptyState ?? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-text-tertiary">
              <p className="text-sm">{t("emptyFolder")}</p>
            </div>
          )
        ) : (
          <MediaGrid>
            {childFolders.map((cat) => (
              <FolderCard
                key={`folder-${cat.id}`}
                id={cat.id}
                name={cat.name}
                childFolderCount={counts.childCountByParent.get(cat.id) ?? 0}
                itemCount={counts.itemCountByCat.get(cat.id) ?? 0}
                onOpen={() => onNavigate(cat.id)}
                onContextMenu={
                  onFolderContextMenu
                    ? (e) => {
                        e.preventDefault()
                        onFolderContextMenu(cat.id, e)
                      }
                    : undefined
                }
                onDropItem={
                  onDropItemToFolder
                    ? (itemId) => onDropItemToFolder(itemId, cat.id)
                    : undefined
                }
              />
            ))}
            {currentItems.map((item) => (
              <div key={`item-${item.id}`}>{renderItem(item)}</div>
            ))}
          </MediaGrid>
        )}
      </div>
    </div>
  )
}
