"use client"

import { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  PlusIcon,
  SearchIcon,
  BookOpenIcon,
  Loader2Icon,
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import { useMangaLibrary } from "@/hooks/use-manga"
import { MangaCard } from "@/components/manga/MangaCard"
import { ScrapeModal } from "@/components/manga/ScrapeModal"
import { CategorySidebar } from "@/components/media-grid/CategorySidebar"
import { SelectionBar } from "@/components/media-grid/SelectionBar"
import { api } from "@/lib/api"
import { cn, appConfirm } from "@/lib/utils"
import type { MediaCategory } from "@/lib/types"

export default function MangaLibraryPage() {
  const { t } = useLocale()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [scrapeOpen, setScrapeOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { items, loading, refresh } = useMangaLibrary(search)
  const [thumbnailTargetId, setThumbnailTargetId] = useState<number | null>(null)
  const thumbnailInputRef = useRef<HTMLInputElement>(null)

  // Category state
  const [categories, setCategories] = useState<MediaCategory[]>([])
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Load categories
  const loadCategories = useCallback(() => {
    api.categories.list("manga").then(setCategories).catch(() => {})
  }, [])
  useEffect(() => { loadCategories() }, [loadCategories])

  // Filter by category
  const filtered = useMemo(() => {
    if (categoryFilter === null) return items
    if (categoryFilter === 0) return items.filter((m) => !m.category_id)
    return items.filter((m) => m.category_id === categoryFilter)
  }, [items, categoryFilter])

  const uncategorizedCount = useMemo(() => items.filter((m) => !m.category_id).length, [items])

  const handleDelete = useCallback(
    async (id: number) => {
      if (!await appConfirm(t("mangaConfirmDelete"))) return
      try {
        await api.manga.delete(id)
        setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
        refresh()
      } catch {}
    },
    [refresh, t]
  )

  const handleChangeThumbnail = (id: number) => {
    setThumbnailTargetId(id)
    thumbnailInputRef.current?.click()
  }

  const handleThumbnailFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || thumbnailTargetId === null) return
    try {
      await api.manga.uploadThumbnail(thumbnailTargetId, file)
      refresh()
    } catch {}
    e.target.value = ""
    setThumbnailTargetId(null)
  }

  // Category CRUD
  const handleCreateCategory = async (name: string) => {
    try {
      await api.categories.create({ name, media_type: "manga" })
      loadCategories()
    } catch {}
  }

  const handleRenameCategory = async (id: number, name: string) => {
    try {
      await api.categories.update(id, { name })
      loadCategories()
    } catch {}
  }

  const handleDeleteCategory = async (id: number) => {
    if (!await appConfirm(t("confirmDeleteCategory"))) return
    try {
      await api.categories.delete(id)
      if (categoryFilter === id) setCategoryFilter(null)
      loadCategories()
      refresh()
    } catch {}
  }

  // Move single item
  const handleMoveToCategory = async (mangaId: number, categoryId: number | null) => {
    try {
      await api.manga.update(mangaId, { category_id: categoryId })
      refresh()
      loadCategories()
    } catch {}
  }

  // DnD move (sidebar drop)
  const handleDndMoveToCategory = async (itemId: number, categoryId: number | null) => {
    await handleMoveToCategory(itemId, categoryId)
  }

  // Merge: card-to-card drop
  const handleMergeDrop = async (targetId: number, draggedId: number) => {
    const name = prompt(t("folderName") || "폴더 이름", t("newFolder") || "새 폴더")
    if (!name) return
    try {
      const cat = await api.categories.create({ name, media_type: "manga" })
      await api.manga.bulkMove([draggedId, targetId], cat.id)
      refresh()
      loadCategories()
    } catch {}
  }

  // Selection
  const handleSelect = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Bulk move
  const handleBulkMove = async (categoryId: number | null) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    try {
      await api.manga.bulkMove(ids, categoryId)
      setSelectedIds(new Set())
      refresh()
      loadCategories()
    } catch {}
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* Category Sidebar */}
      <CategorySidebar
        categories={categories}
        activeCategory={categoryFilter}
        onSelect={setCategoryFilter}
        totalCount={items.length}
        uncategorizedCount={uncategorizedCount}
        onCreateCategory={handleCreateCategory}
        onRenameCategory={handleRenameCategory}
        onDeleteCategory={handleDeleteCategory}
        onMoveItem={handleDndMoveToCategory}
        collapsed={sidebarCollapsed}
        t={t}
      />

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
                <BookOpenIcon className="size-5 text-accent" />
                {t("manga")}
              </h1>
              <p className="text-sm text-text-secondary mt-0.5">
                {items.length}{t("mangaWorks")}
              </p>
            </div>
            <Button onClick={() => setScrapeOpen(true)}>
              <PlusIcon className="size-4" />
              {t("mangaScrape")}
            </Button>
          </div>

          {/* Search row with toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors shrink-0"
              title={sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar")}
            >
              {sidebarCollapsed ? <ChevronRightIcon className="size-4" /> : <ChevronLeftIcon className="size-4" />}
            </button>
            <div className="flex-1 relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-tertiary" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("mangaSearchPlaceholder")}
                className={cn(
                  "w-full pl-10 pr-8 py-2 rounded-lg text-sm",
                  "bg-surface-elevated border border-border-subtle",
                  "text-text-primary placeholder:text-text-tertiary",
                  "focus:outline-none focus:border-accent/50"
                )}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                >
                  <XIcon className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Selection bar */}
        {selectedIds.size > 0 && (
          <div className="px-6">
            <SelectionBar
              selectedCount={selectedIds.size}
              categories={categories}
              onBulkMove={handleBulkMove}
              onDeselectAll={() => setSelectedIds(new Set())}
            />
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2Icon className="size-6 animate-spin text-accent" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
              <BookOpenIcon className="size-12 mb-3 opacity-30" />
              <p className="text-sm">
                {search ? t("mangaNoResults") : t("mangaEmpty")}
              </p>
              {!search && (
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => setScrapeOpen(true)}>
                  <PlusIcon className="size-4" />
                  {t("mangaScrapeFirst")}
                </Button>
              )}
            </div>
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}
            >
              {filtered.map((manga) => (
                <MangaCard
                  key={manga.id}
                  manga={manga}
                  onClick={() => router.push(`/manga/${manga.id}`)}
                  onDelete={handleDelete}
                  onChangeThumbnail={handleChangeThumbnail}
                  selectable
                  selected={selectedIds.has(manga.id)}
                  onSelect={(checked) => handleSelect(manga.id, checked)}
                  categories={categories}
                  onMoveToCategory={(catId) => handleMoveToCategory(manga.id, catId)}
                  onMergeDrop={(draggedId) => handleMergeDrop(manga.id, draggedId)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Hidden file input for thumbnail change */}
        <input
          ref={thumbnailInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleThumbnailFileChange}
        />

        {/* Scrape Modal */}
        <ScrapeModal
          open={scrapeOpen}
          onClose={() => setScrapeOpen(false)}
          onComplete={refresh}
        />
      </div>
    </div>
  )
}
