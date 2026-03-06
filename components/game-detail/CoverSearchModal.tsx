"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import {
  SearchIcon,
  XIcon,
  Loader2Icon,
  ImageIcon,
  UploadIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import { ChipButton } from "./ChipButton"
import type { CoverCandidate, Game } from "@/lib/types"

interface CoverSearchModalProps {
  gameId: number
  game: Game
  onClose: () => void
  onRefresh: () => void
}

export function CoverSearchModal({ gameId, game, onClose, onRefresh }: CoverSearchModalProps) {
  const { t } = useLocale()

  const [coverSearchQuery, setCoverSearchQuery] = useState(game.title || "")
  const [coverResults, setCoverResults] = useState<CoverCandidate[]>([])
  const [searchingCovers, setSearchingCovers] = useState(false)
  const [coverSource, setCoverSource] = useState<"all" | "vndb" | "dlsite" | "web">("all")
  const [selectingCover, setSelectingCover] = useState<number | null>(null)
  const [coverSearchError, setCoverSearchError] = useState("")
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadError, setUploadError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSearchCovers = useCallback(async (sourceOverride?: "all" | "vndb" | "dlsite" | "web", queryOverride?: string) => {
    const query = (queryOverride ?? coverSearchQuery).trim()
    if (!query) return
    setSearchingCovers(true)
    setCoverSearchError("")
    const src = sourceOverride ?? coverSource
    const sources = src === "all" ? ["vndb", "dlsite", "web"] : [src]
    try {
      const res = await api.covers.search(gameId, query, sources)
      setCoverResults(res.results)
      if (res.results.length === 0) {
        setCoverSearchError(t("coverNoResults") ?? "No results found")
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Search failed"
      setCoverSearchError(msg)
    } finally { setSearchingCovers(false) }
  }, [gameId, coverSearchQuery, coverSource, t])

  // Auto-search on mount if query (game title) exists
  const initialSearchDone = useRef(false)
  useEffect(() => {
    if (!initialSearchDone.current && game.title) {
      initialSearchDone.current = true
      handleSearchCovers("all", game.title)
    }
  }, [game.title, handleSearchCovers])

  const handleSelectCover = useCallback(async (c: CoverCandidate, idx: number) => {
    setSelectingCover(idx)
    try {
      await api.covers.select(gameId, { url: c.url, source: c.source, external_id: c.external_id })
      onClose()
      onRefresh()
    } catch (e) { console.error("Select cover failed:", e); setSelectingCover(null) }
  }, [gameId, onClose, onRefresh])

  const handleUploadCover = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingCover(true)
    setUploadError("")
    try {
      await api.covers.upload(gameId, file)
      onClose()
      onRefresh()
    } catch (err) {
      setUploadError(`${t("coverUploadFailed")}: ${err instanceof Error ? err.message : t("unknownError")}`)
    } finally {
      setUploadingCover(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }, [gameId, onClose, onRefresh, t])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose()
    }
  }, [onClose])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleClose}
      onKeyDown={handleKeyDown}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUploadCover}
      />
      <div
        className="w-[680px] max-h-[85vh] rounded-xl overflow-hidden flex flex-col bg-surface border border-overlay-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <h3 className="text-sm font-semibold text-text-primary">{t("coverArtSearch")}</h3>
          <button onClick={handleClose} className="size-8 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors">
            <XIcon className="size-4" />
          </button>
        </div>

        {/* Search bar + Upload */}
        <div className="px-5 py-3 space-y-3 border-b border-border-subtle">
          {uploadError && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 rounded-md px-3 py-2">
              <span className="flex-1">{uploadError}</span>
              <button onClick={() => setUploadError("")} className="shrink-0 text-red-400/60 hover:text-red-400">&times;</button>
            </div>
          )}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-tertiary" />
              <input
                type="text"
                value={coverSearchQuery}
                onChange={(e) => setCoverSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearchCovers()}
                placeholder={t("searchByTitle")}
                className="w-full h-10 pl-10 pr-3 rounded-lg border border-border bg-background text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                autoFocus
              />
            </div>
            <Button variant="default" size="sm" onClick={() => handleSearchCovers()} loading={searchingCovers}>
              {t("search")}
            </Button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingCover}
              className="h-10 px-3 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-colors text-xs flex items-center gap-1.5"
            >
              {uploadingCover ? <Loader2Icon className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
              {t("upload")}
            </button>
          </div>

          {/* Source tabs */}
          <div className="flex gap-1">
            {([["all", t("coverSourceAll")], ["vndb", "VNDB"], ["dlsite", "DLsite"], ["web", t("coverSourceWeb")]] as const).map(([key, label]) => (
              <ChipButton
                key={key}
                selected={coverSource === key}
                onClick={() => { setCoverSource(key); handleSearchCovers(key) }}
                className="py-1.5 text-center"
              >
                {label}
                {coverSource === key && coverResults.length > 0 && (
                  <span className="ml-1.5 text-[10px] opacity-60">{coverResults.length}</span>
                )}
              </ChipButton>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {searchingCovers ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2Icon className="size-8 text-accent animate-spin" />
              <p className="text-xs text-text-tertiary">{t("searching")}</p>
            </div>
          ) : coverResults.length > 0 ? (
            <div className="grid grid-cols-3 gap-3">
              {coverResults.map((c, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectCover(c, i)}
                  disabled={selectingCover !== null}
                  className={`group relative rounded-lg overflow-hidden transition-all duration-200 border-2
                    ${selectingCover === i ? "border-accent shadow-[0_0_16px_var(--accent-muted)]" : "border-transparent"}
                    ${selectingCover !== null && selectingCover !== i ? "opacity-40" : ""}`}
                >
                  <img
                    src={c.thumbnail_url || c.url}
                    alt={c.title}
                    className="w-full aspect-[3/4] object-cover bg-surface-elevated group-hover:brightness-110 transition-[filter] duration-200"
                    loading="lazy"
                  />
                  {selectingCover === i && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2Icon className="size-6 text-accent animate-spin" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2.5 pt-8">
                    <p className="text-[11px] text-white truncate font-medium">{c.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-white/50 uppercase font-medium">{c.source}</span>
                      {c.developer && <span className="text-[10px] text-white/40 truncate">{c.developer}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <ImageIcon className="size-12 text-text-tertiary/30" />
              {coverSearchError ? (
                <p className="text-xs text-red-400">{coverSearchError}</p>
              ) : (
                <p className="text-xs text-text-tertiary">{t("coverSearchHint")}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
