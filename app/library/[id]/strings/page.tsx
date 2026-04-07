"use client"

import { useState, useEffect, useCallback, useRef, use } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  SearchIcon,
  CheckCircleIcon,
  RotateCcwIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  AlertTriangleIcon,
  PencilIcon,
  XIcon,
  CheckIcon,
  PlayIcon,
  SquareIcon,
  RefreshCwIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Paywall } from "@/components/ui/paywall"
import { useLocale } from "@/hooks/use-locale"
import { useLicenseStatus, useTranslationProgress, useGame, useSettings } from "@/hooks/use-api"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { TranslateRequest, TranslationEntry, TranslationStringsResponse } from "@/lib/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatusFilter = "all" | "pending" | "translated" | "reviewed"
type SafetyFilter = "" | "safe" | "risky" | "unsafe"

interface EntryWithIndex extends TranslationEntry {
  _index: number
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const { t } = useLocale()
  const map: Record<string, string> = {
    translated: "bg-success/15 text-success border-success/25",
    reviewed: "bg-accent/15 text-accent border-accent/25",
    pending: "bg-overlay-6 text-text-tertiary border-overlay-6",
  }
  const cls = map[status] ?? "bg-overlay-6 text-text-tertiary border-overlay-6"
  const label: Record<string, string> = {
    translated: t("translated"),
    reviewed: t("reviewed"),
    pending: t("pending"),
  }
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", cls)}>
      {label[status] ?? status}
    </span>
  )
}

function SafetyBadge({ safety }: { safety?: string }) {
  if (!safety || safety === "safe") return null
  const map: Record<string, string> = {
    risky: "bg-warning/15 text-warning border-warning/25",
    unsafe: "bg-error/15 text-error border-error/25",
  }
  const cls = map[safety] ?? ""
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border", cls)}>
      {safety}
    </span>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 border",
        active
          ? "bg-accent/15 border-accent/40 text-accent"
          : "bg-transparent border-overlay-6 text-text-secondary hover:text-text-primary hover:bg-overlay-4"
      )}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Inline editor row
// ---------------------------------------------------------------------------

function StringRow({
  entry,
  onSave,
  isSelected,
  onToggleSelect,
  isTranslating,
  rowRef,
}: {
  entry: EntryWithIndex
  onSave: (idx: number, translated: string, status: string) => Promise<void>
  isSelected: boolean
  onToggleSelect: (idx: number) => void
  isTranslating: boolean
  rowRef?: React.Ref<HTMLTableRowElement>
}) {
  const { t } = useLocale()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.translated ?? "")
  const [saving, setSaving] = useState(false)

  const handleEdit = () => {
    setDraft(entry.translated ?? "")
    setEditing(true)
  }

  const handleCancel = () => {
    setEditing(false)
    setDraft(entry.translated ?? "")
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(entry._index, draft, draft ? "translated" : "pending")
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
    if (e.key === "Escape") {
      handleCancel()
    }
  }

  return (
    <tr
      ref={rowRef}
      className={cn(
        "border-b border-overlay-4 hover:bg-overlay-2 transition-colors duration-200",
        isSelected && "bg-accent/5",
        isTranslating && "bg-warning/8 ring-1 ring-warning/30 ring-inset",
        entry.safety === "risky" && "bg-warning/5",
        entry.safety === "unsafe" && "bg-error/5 opacity-60"
      )}
    >
      {/* Checkbox */}
      <td className="pl-4 pr-2 py-3 w-8">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(entry._index)}
          className="rounded border-overlay-6 accent-accent cursor-pointer"
        />
      </td>

      {/* # */}
      <td className="px-2 py-3 text-xs text-text-tertiary w-12 text-right">
        {isTranslating && <Loader2Icon className="size-3 animate-spin text-warning inline mr-1" />}
        {entry._index + 1}
      </td>

      {/* Namespace */}
      <td className="px-3 py-3 w-32 max-w-[128px]">
        {entry.namespace && (
          <span className="text-xs text-text-tertiary truncate block" title={entry.namespace}>
            {entry.namespace}
          </span>
        )}
      </td>

      {/* Tag + Safety */}
      <td className="px-2 py-3 w-24">
        <div className="flex flex-col gap-0.5">
          {entry.tag && (
            <span className="text-xs bg-overlay-4 border border-overlay-6 rounded px-1.5 py-0.5 text-text-secondary">
              {entry.tag}
            </span>
          )}
          <SafetyBadge safety={entry.safety} />
        </div>
      </td>

      {/* Original */}
      <td className="px-3 py-3 max-w-[260px]">
        <p className="text-sm text-text-secondary line-clamp-3 leading-relaxed whitespace-pre-wrap break-words">
          {entry.original}
        </p>
      </td>

      {/* Translation */}
      <td className="px-3 py-3 max-w-[260px]">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              rows={3}
              className="w-full rounded-lg bg-overlay-4 border border-accent/50 text-sm text-text-primary px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-accent/60 leading-relaxed"
              placeholder={t("enterTranslation")}
            />
            <div className="flex gap-1.5">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent/15 border border-accent/40 text-accent text-xs font-medium hover:bg-accent/25 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2Icon className="size-3 animate-spin" /> : <CheckIcon className="size-3" />}
                {t("save")}
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-overlay-4 border border-overlay-6 text-text-secondary text-xs font-medium hover:text-text-primary transition-colors"
              >
                <XIcon className="size-3" />
                {t("cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div
            className="group relative cursor-pointer"
            onClick={handleEdit}
          >
            {entry.translated ? (
              <p className="text-sm text-text-primary line-clamp-3 leading-relaxed whitespace-pre-wrap break-words pr-6">
                {entry.translated}
              </p>
            ) : (
              <p className="text-sm text-text-tertiary italic">{t("untranslated")}</p>
            )}
            <PencilIcon className="size-3.5 absolute top-0 right-0 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
      </td>

      {/* Status */}
      <td className="px-3 py-3 w-24">
        <StatusBadge status={entry.status ?? "pending"} />
      </td>

      {/* QA */}
      <td className="px-3 py-3 w-16 text-center">
        {/* TODO: QA issue indicators */}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function StringsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const rawId = parseInt(id, 10)
  const gameId = isNaN(rawId) ? null : rawId
  const router = useRouter()
  const { t } = useLocale()
  const { license, refresh: refreshLicense } = useLicenseStatus()
  const { game } = useGame(gameId)
  const { settings } = useSettings()

  // State
  const [data, setData] = useState<TranslationStringsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [qaOnly, setQaOnly] = useState(false)
  const [safetyFilter, setSafetyFilter] = useState<SafetyFilter>("")

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [translateLoading, setTranslateLoading] = useState(false)
  const [applyLoading, setApplyLoading] = useState(false)

  const PER_PAGE = 50

  // Translation progress (SSE)
  const {
    progress: translationProgress,
    status: translationStatus,
    message: translationMessage,
    connect: connectSSE,
    disconnect: disconnectSSE,
    reset: resetSSE,
  } = useTranslationProgress(gameId)

  const isTranslating = translationStatus === "running" || translationStatus === "connecting"
  const currentIndex = translationProgress.current_index

  // Ref map for auto-scrolling to current row
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map())
  const tableContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to current translating row
  useEffect(() => {
    if (currentIndex == null) return
    const row = rowRefs.current.get(currentIndex)
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [currentIndex])

  // Refetch strings when translation completes
  useEffect(() => {
    if (translationStatus === "completed") {
      fetchStrings()
    }
  }, [translationStatus])

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchStrings = useCallback(async () => {
    if (gameId === null) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.strings.get(gameId, {
        page,
        per_page: PER_PAGE,
        status: statusFilter === "all" ? "" : statusFilter,
        search,
        qa_only: qaOnly,
        safety: safetyFilter || undefined,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [gameId, page, statusFilter, search, qaOnly, safetyFilter, t])

  useEffect(() => {
    fetchStrings()
  }, [fetchStrings])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
    setSelected(new Set())
  }, [statusFilter, search, qaOnly, safetyFilter])

  // ---------------------------------------------------------------------------
  // Translation controls
  // ---------------------------------------------------------------------------

  const startTranslation = async (mode: "all" | "selected" | "retranslate") => {
    if (gameId === null || !game) return
    setTranslateLoading(true)
    try {
      const provider = (settings.default_provider as string) || "claude"

      const req: TranslateRequest = {
        provider,
        source_lang: game.source_lang || "auto",
        preset_id: game.preset_id ?? undefined,
      }

      if (mode === "selected" && selected.size > 0) {
        const indices = Array.from(selected).sort((a, b) => a - b)
        req.start_index = indices[0]
        req.end_index = indices[indices.length - 1] + 1
      } else if (mode === "retranslate") {
        // Reset translated entries to pending first, then translate all
        const translatedEntries = entries.filter((e) => e.status === "translated")
        if (translatedEntries.length > 0) {
          await api.strings.bulkUpdate(gameId, {
            indices: translatedEntries.map((e) => e._index),
            status: "pending",
          })
          await fetchStrings()
        }
      }

      await api.translate.start(gameId, req)
      connectSSE()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed")
    } finally {
      setTranslateLoading(false)
    }
  }

  const handleApply = async () => {
    if (gameId === null) return
    setApplyLoading(true)
    try {
      await api.translate.apply(gameId)
      fetchStrings()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("applyFailed"))
    } finally {
      setApplyLoading(false)
    }
  }

  const cancelTranslation = async () => {
    if (gameId === null) return
    try {
      await api.translate.cancel(gameId)
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleSaveEntry = async (idx: number, translated: string, status: string) => {
    await api.strings.update(gameId!, idx, { translated, status })
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        entries: prev.entries.map((e) =>
          (e as EntryWithIndex)._index === idx
            ? { ...e, translated, status }
            : e
        ),
      }
    })
  }

  const handleToggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    if (!data) return
    const entries = data.entries as EntryWithIndex[]
    if (selected.size === entries.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(entries.map((e) => e._index)))
    }
  }

  const handleBulkStatus = async (status: string) => {
    if (selected.size === 0) return
    setBulkLoading(true)
    try {
      await api.strings.bulkUpdate(gameId!, {
        indices: Array.from(selected),
        status,
      })
      setSelected(new Set())
      fetchStrings()
    } finally {
      setBulkLoading(false)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  const totalStrings = game?.string_count ?? data?.total ?? 0
  const translatedCount = game?.translated_count ?? 0
  const pendingCount = totalStrings - translatedCount
  const progressPercent = totalStrings > 0 ? Math.round((translatedCount / totalStrings) * 100) : 0

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  const totalPages = data ? Math.ceil(data.total / PER_PAGE) : 1

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const entries = (data?.entries ?? []) as EntryWithIndex[]
  const allSelected = entries.length > 0 && selected.size === entries.length
  const someSelected = selected.size > 0 && !allSelected

  return (
    <Paywall show={!license.valid} onLicenseVerified={refreshLicense} dismissable={false}>
    <div className="min-h-screen bg-background text-text-primary">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-overlay-6 px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push(`/library/${gameId}`)}
          className="size-9 flex items-center justify-center rounded-lg border border-overlay-6 text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all"
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-text-primary">{t("stringEditor")}</h1>
          {data && (
            <p className="text-xs text-text-tertiary mt-0.5">
              {t("totalStrings")}: {data.total.toLocaleString()}{t("itemsUnit")}
            </p>
          )}
        </div>

        {/* Bulk actions */}
        {selected.size > 0 && !isTranslating && (
          <div className="flex items-center gap-2 mr-2">
            <span className="text-sm text-text-secondary">{t("selectedItems").replace("{count}", String(selected.size))}</span>
            <Button
              variant="secondary"
              size="sm"
              loading={bulkLoading}
              onClick={() => handleBulkStatus("reviewed")}
            >
              <CheckCircleIcon className="size-3.5" />
              {t("bulkApprove")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={bulkLoading}
              onClick={() => handleBulkStatus("pending")}
            >
              <RotateCcwIcon className="size-3.5" />
              {t("bulkReset")}
            </Button>
          </div>
        )}
      </div>

      {/* Translation control bar */}
      <div className="px-6 py-2.5 border-b border-overlay-4 bg-surface/80 flex flex-wrap items-center gap-2">
        {isTranslating ? (
          <>
            {/* Progress bar */}
            <div className="flex-1 flex items-center gap-3">
              <div className="flex-1 max-w-md">
                <div className="h-2 rounded-full bg-overlay-6 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-300"
                    style={{ width: `${translationProgress.progress}%` }}
                  />
                </div>
              </div>
              <span className="text-xs text-text-secondary whitespace-nowrap">
                {translationProgress.translated}/{translationProgress.total} ({Math.round(translationProgress.progress)}%)
              </span>
              {translationMessage && (
                <span className="text-xs text-text-tertiary truncate max-w-[200px]">{translationMessage}</span>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={cancelTranslation}
            >
              <SquareIcon className="size-3.5" />
              {t("cancelTranslation")}
            </Button>
          </>
        ) : (
          <>
            {/* Translation action buttons */}
            <Button
              variant="secondary"
              size="sm"
              loading={translateLoading}
              disabled={translateLoading}
              onClick={() => startTranslation("all")}
            >
              <PlayIcon className="size-3.5" />
              {t("translateAll")}
            </Button>

            <Button
              variant="secondary"
              size="sm"
              loading={translateLoading}
              disabled={translateLoading || selected.size === 0}
              onClick={() => startTranslation("selected")}
            >
              <CheckCircleIcon className="size-3.5" />
              {t("translateSelected")}
              {selected.size > 0 && (
                <span className="text-xs bg-accent/20 text-accent rounded px-1 ml-0.5">{selected.size}</span>
              )}
            </Button>

            <Button
              variant="secondary"
              size="sm"
              loading={translateLoading}
              disabled={translateLoading}
              onClick={() => startTranslation("retranslate")}
            >
              <RefreshCwIcon className="size-3.5" />
              {t("retranslate")}
            </Button>

            {translatedCount > 0 && (
              <Button
                variant="accent"
                size="sm"
                loading={applyLoading}
                disabled={applyLoading}
                onClick={handleApply}
              >
                <CheckCircleIcon className="size-3.5" />
                {t("apply")}
              </Button>
            )}

            <div className="w-px h-5 bg-overlay-6 mx-1" />

            {/* Stats */}
            <div className="flex items-center gap-3 text-xs text-text-secondary">
              <span>{t("totalStrings")}: <strong className="text-text-primary">{totalStrings.toLocaleString()}</strong></span>
              <span className="text-success">{t("translated")}: <strong>{translatedCount.toLocaleString()}</strong></span>
              <span className="text-text-tertiary">{t("pending")}: <strong>{pendingCount.toLocaleString()}</strong></span>
              <span className="text-accent">{progressPercent}%</span>
            </div>
          </>
        )}
      </div>

      {/* Current translating indicator */}
      {isTranslating && translationProgress.current_original && (
        <div className="px-6 py-2 border-b border-warning/20 bg-warning/5 flex items-center gap-2">
          <Loader2Icon className="size-3.5 animate-spin text-warning shrink-0" />
          <span className="text-xs text-warning font-medium">{t("currentlyTranslating")}:</span>
          <span className="text-xs text-text-secondary truncate">{translationProgress.current_original}</span>
          {translationProgress.current_translated && (
            <>
              <span className="text-xs text-text-tertiary">→</span>
              <span className="text-xs text-text-primary truncate">{translationProgress.current_translated}</span>
            </>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-overlay-4 bg-surface flex flex-wrap items-center gap-3">
        {/* Status chips */}
        <div className="flex items-center gap-1.5">
          {(["all", "pending", "translated", "reviewed"] as StatusFilter[]).map((s) => (
            <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
              {s === "all" ? t("filterAll")
                : s === "pending" ? t("filterPending")
                : s === "translated" ? t("filterTranslated")
                : t("filterReviewed")}
            </FilterChip>
          ))}
        </div>

        <div className="w-px h-5 bg-overlay-6" />

        {/* Safety filter chips */}
        <div className="flex items-center gap-1.5">
          <FilterChip active={safetyFilter === ""} onClick={() => setSafetyFilter("")}>
            All
          </FilterChip>
          <FilterChip active={safetyFilter === "safe"} onClick={() => setSafetyFilter("safe")}>
            Safe {data?.safety_counts?.safe ? `(${data.safety_counts.safe.toLocaleString()})` : ""}
          </FilterChip>
          <FilterChip active={safetyFilter === "risky"} onClick={() => setSafetyFilter("risky")}>
            Risky {data?.safety_counts?.risky ? `(${data.safety_counts.risky.toLocaleString()})` : ""}
          </FilterChip>
          <FilterChip active={safetyFilter === "unsafe"} onClick={() => setSafetyFilter("unsafe")}>
            Unsafe {data?.safety_counts?.unsafe ? `(${data.safety_counts.unsafe.toLocaleString()})` : ""}
          </FilterChip>
        </div>

        <div className="w-px h-5 bg-overlay-6" />

        {/* QA only toggle */}
        <FilterChip active={qaOnly} onClick={() => setQaOnly((v) => !v)}>
          <AlertTriangleIcon className="size-3 inline mr-1" />
          {t("filterQaIssues")}
        </FilterChip>

        <div className="flex-1" />

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-tertiary pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("searchStrings")}
              className="pl-8 pr-3 py-1.5 rounded-lg bg-overlay-4 border border-overlay-6 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50 w-56 transition-all"
            />
          </div>
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(""); setSearchInput("") }}
              className="text-text-tertiary hover:text-text-primary transition-colors"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="overflow-x-auto" ref={tableContainerRef}>
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2Icon className="size-7 animate-spin text-accent" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2">
            <p className="text-error text-sm">{error}</p>
            <Button variant="secondary" size="sm" onClick={fetchStrings}>
              {t("tryAgain")}
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-text-tertiary text-sm">{t("noStringsFound")}</p>
          </div>
        ) : (
          <table className="w-full text-left min-w-[900px]">
            <thead className="bg-overlay-2 border-b border-overlay-6">
              <tr>
                <th className="pl-4 pr-2 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected }}
                    onChange={handleSelectAll}
                    className="rounded border-overlay-6 accent-accent cursor-pointer"
                  />
                </th>
                <th className="px-2 py-2.5 text-xs font-medium text-text-tertiary w-12 text-right">#</th>
                <th className="px-3 py-2.5 text-xs font-medium text-text-tertiary w-32">Namespace</th>
                <th className="px-2 py-2.5 text-xs font-medium text-text-tertiary w-24">Tag</th>
                <th className="px-3 py-2.5 text-xs font-medium text-text-tertiary">{t("original")}</th>
                <th className="px-3 py-2.5 text-xs font-medium text-text-tertiary">{t("translation")}</th>
                <th className="px-3 py-2.5 text-xs font-medium text-text-tertiary w-24">{t("status")}</th>
                <th className="px-3 py-2.5 text-xs font-medium text-text-tertiary w-16">QA</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <StringRow
                  key={entry._index}
                  entry={entry}
                  onSave={handleSaveEntry}
                  isSelected={selected.has(entry._index)}
                  onToggleSelect={handleToggleSelect}
                  isTranslating={currentIndex === entry._index}
                  rowRef={(el) => {
                    if (el) rowRefs.current.set(entry._index, el)
                    else rowRefs.current.delete(entry._index)
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && !error && data && data.total > PER_PAGE && (
        <div className="px-6 py-4 border-t border-overlay-4 flex items-center justify-between gap-4">
          <span className="text-sm text-text-tertiary">
            {((page - 1) * PER_PAGE + 1).toLocaleString()}–
            {Math.min(page * PER_PAGE, data.total).toLocaleString()} / {data.total.toLocaleString()}{t("itemsUnit")}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="text-sm text-text-secondary px-2">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
    </Paywall>
  )
}
