"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  FolderOpenIcon,
  PlusIcon,
  SearchIcon,
  GamepadIcon,
  ScanIcon,
  Loader2Icon,
  XIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ImageIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"
import { useGames } from "@/hooks/use-api"
import { api } from "@/lib/api"
import type { Game } from "@/lib/types"

/* ─── Status Badge ─── */
function StatusBadge({ game }: { game: Game }) {
  const pct = game.string_count > 0
    ? Math.round((game.translated_count / game.string_count) * 100)
    : 0

  if (game.status === "applied") {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-[8px] bg-success/90 text-white text-[10px] font-semibold">
        <CheckCircleIcon className="size-2.5" />
        적용됨
      </span>
    )
  }
  if (game.status === "translated" || pct === 100) {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-[8px] bg-accent/90 text-white text-[10px] font-semibold">
        <CheckCircleIcon className="size-2.5" />
        번역 완료
      </span>
    )
  }
  if (game.status === "translating") {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-[8px] bg-blue-500/90 text-white text-[10px] font-semibold">
        <Loader2Icon className="size-2.5 animate-spin" />
        번역 중
      </span>
    )
  }
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-[8px] bg-warning/90 text-white text-[10px] font-semibold">
        {pct}%
      </span>
    )
  }
  if (!game.engine) {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-[8px] bg-surface-elevated/80 text-text-secondary text-[10px] font-semibold border border-overlay-8">
        <AlertCircleIcon className="size-2.5" />
        스캔 필요
      </span>
    )
  }
  return null
}

/* ─── Game Card (Steam/Epic launcher style) ─── */
function GameCard({ game, onClick }: { game: Game; onClick: () => void }) {
  const pct = game.string_count > 0
    ? Math.round((game.translated_count / game.string_count) * 100)
    : 0
  const hasCover = !!game.cover_path

  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="cursor-pointer rounded-md overflow-hidden relative transition-all duration-200 ease-out"
      style={{
        aspectRatio: "3 / 4",
        transform: hovered ? "scale(1.03)" : "scale(1)",
        border: `2px solid ${hovered ? "var(--accent)" : "transparent"}`,
        boxShadow: hovered ? "0 0 12px var(--accent-muted)" : "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {/* Full-bleed cover image */}
      {hasCover ? (
        <img
          src={`/api/covers/${game.id}.jpg?t=${game.updated_at}`}
          alt={game.title}
          className="absolute inset-0 w-full h-full object-cover transition-[filter] duration-200"
          style={{ filter: hovered ? "brightness(1.1)" : "brightness(1)" }}
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <GamepadIcon className="size-10 text-accent/30" />
        </div>
      )}

      {/* Bottom gradient overlay for title */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: "50%",
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)",
        }}
      />

      {/* Status Badge (top-left) */}
      <div className="absolute top-2 left-2 z-10">
        <StatusBadge game={game} />
      </div>

      {/* Title + info overlay at bottom */}
      <div className="absolute inset-x-0 bottom-0 p-2.5 z-10">
        <h3 className="text-[13px] font-semibold text-white truncate leading-tight drop-shadow-sm">
          {game.title}
        </h3>
        {game.engine && (
          <p className="text-[10px] text-gray-300/80 truncate mt-0.5">{game.engine}</p>
        )}
        {game.string_count > 0 && (
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`text-[10px] font-medium font-mono ${
                pct === 100 ? "text-success" : "text-accent"
              }`}
            >
              {pct}%
            </span>
          </div>
        )}
      </div>

      {/* Progress bar — thin line at very bottom */}
      {game.string_count > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40 z-20">
          <div
            className={`h-full transition-all duration-300 ${
              pct === 100 ? "bg-success" : "bg-accent"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

/* ─── Section Header ─── */
function SectionHeader({
  icon: Icon,
  title,
  count,
  iconColor,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  title: string
  count: number
  iconColor: string
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <Icon className="size-5" style={{ color: iconColor }} />
      <span className="text-base font-semibold text-text-primary">{title}</span>
      <span
        className="px-2 py-0.5 rounded-[8px] text-[10px] font-semibold"
        style={{
          color: iconColor,
          backgroundColor: `${iconColor}26`,
        }}
      >
        {count}
      </span>
    </div>
  )
}

/* ─── Main Page ─── */
export default function LibraryPage() {
  const { t } = useLocale()
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")
  const { games, loading, refresh } = useGames(searchQuery || undefined)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addPath, setAddPath] = useState("")
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState("")
  const [scanPath, setScanPath] = useState("")
  const [scanLoading, setScanLoading] = useState(false)
  const [scanResults, setScanResults] = useState<
    Array<{ title: string; path: string; engine: string; exe_path: string }>
  >([])

  const handleAddGame = useCallback(async () => {
    if (!addPath.trim()) return
    setAddLoading(true)
    setAddError("")
    try {
      await api.games.create({ path: addPath.trim() })
      setAddPath("")
      setShowAddModal(false)
      refresh()
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Failed to add game")
    } finally {
      setAddLoading(false)
    }
  }, [addPath, refresh])

  const handleScanDirectory = useCallback(async () => {
    if (!scanPath.trim()) return
    setScanLoading(true)
    try {
      const results = await api.games.scanDirectory(scanPath.trim())
      const existingPaths = new Set(games.map(g => g.path))
      setScanResults(results.filter((r: { path: string }) => !existingPaths.has(r.path)))
    } catch {
      setScanResults([])
    } finally {
      setScanLoading(false)
    }
  }, [scanPath, games])

  const handleAddScanned = useCallback(
    async (scanned: { title: string; path: string; engine: string }) => {
      try {
        await api.games.create({
          path: scanned.path,
          title: scanned.title,
          engine: scanned.engine,
        })
        setScanResults((prev) => prev.filter((g) => g.path !== scanned.path))
        refresh()
      } catch { /* ignore */ }
    },
    [refresh]
  )

  const [fetchingCovers, setFetchingCovers] = useState(false)
  const [addingAll, setAddingAll] = useState(false)
  const handleAddAll = useCallback(async () => {
    setAddingAll(true)
    try {
      for (const g of scanResults) {
        try {
          await api.games.create({ path: g.path, title: g.title, engine: g.engine })
        } catch { /* skip duplicates */ }
      }
      setScanResults([])
      refresh()
    } finally {
      setAddingAll(false)
    }
  }, [scanResults, refresh])

  const handleFetchAllCovers = useCallback(async () => {
    setFetchingCovers(true)
    try {
      await api.covers.fetchAll()
      refresh()
    } catch { /* ignore */ } finally {
      setFetchingCovers(false)
    }
  }, [refresh])

  // Categorize games
  const translatedGames = games.filter(g => g.translated_count > 0 || g.status === "applied" || g.status === "translated")
  const untranslatedGames = games.filter(g => g.translated_count === 0 && g.status !== "applied" && g.status !== "translated")

  return (
    <div className="p-5 md:p-6 max-w-6xl mx-auto">
      {/* Top bar: Search + Actions */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="게임 검색..."
            className="w-full h-10 pl-10 pr-4 rounded-lg border border-border bg-surface text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
          />
        </div>
        {games.some(g => !g.cover_path) && (
          <button
            onClick={handleFetchAllCovers}
            disabled={fetchingCovers}
            className="h-10 px-3 rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all text-xs flex items-center gap-1.5"
            title="누락된 커버 이미지 가져오기"
          >
            {fetchingCovers ? <Loader2Icon className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
            <span className="hidden md:inline">커버</span>
          </button>
        )}
        <button
          onClick={() => setShowAddModal(!showAddModal)}
          className="h-10 px-4 rounded-lg bg-accent hover:bg-accent/90 text-white text-sm font-medium flex items-center gap-1.5 transition-all shrink-0"
        >
          <PlusIcon className="size-4" />
          <span className="hidden sm:inline">{t("addGame")}</span>
        </button>
      </div>

      {/* Add Game Panel (slides open) */}
      {showAddModal && (
        <div className="mb-5 rounded-xl overflow-hidden bg-surface border border-border-subtle">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">게임 추가</h3>
              <button
                onClick={() => { setShowAddModal(false); setAddError(""); setScanResults([]) }}
                className="size-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                게임 폴더 경로
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={addPath}
                  onChange={(e) => setAddPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddGame()}
                  placeholder="D:\Games\MyGame"
                  className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
                <Button variant="default" size="sm" onClick={handleAddGame} loading={addLoading} className="shrink-0">
                  <PlusIcon className="size-4" /> 추가
                </Button>
              </div>
              {addError && <p className="text-xs text-error mt-1">{addError}</p>}
            </div>
            <div className="pt-3 border-t border-border-subtle">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                폴더 일괄 스캔
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={scanPath}
                  onChange={(e) => setScanPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScanDirectory()}
                  placeholder="D:\Games"
                  className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
                <Button variant="secondary" size="sm" onClick={handleScanDirectory} loading={scanLoading} className="shrink-0">
                  <ScanIcon className="size-4" /> 스캔
                </Button>
              </div>
            </div>
            {scanResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-secondary">{scanResults.length}개 게임 발견</p>
                  <Button variant="default" size="sm" onClick={handleAddAll} loading={addingAll}>
                    <PlusIcon className="size-3" /> 전체 추가
                  </Button>
                </div>
                {scanResults.map((g) => (
                  <div key={g.path} className="flex items-center justify-between p-2.5 rounded-lg bg-overlay-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">{g.title}</p>
                      <p className="text-xs text-text-tertiary">{g.engine}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleAddScanned(g)} className="shrink-0 ml-2">
                      <PlusIcon className="size-3" /> 추가
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2Icon className="size-8 text-accent animate-spin" />
        </div>
      ) : games.length > 0 ? (
        <div className="space-y-8">
          {/* Translated / Applied Section */}
          {translatedGames.length > 0 && (
            <section>
              <SectionHeader
                icon={CheckCircleIcon}
                title="번역됨"
                count={translatedGames.length}
                iconColor="var(--success)"
              />
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                }}
              >
                {translatedGames.map((game) => (
                  <GameCard
                    key={game.id}
                    game={game}
                    onClick={() => router.push(`/library/${game.id}`)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Untranslated / New Section */}
          <section>
            <SectionHeader
              icon={GamepadIcon}
              title={translatedGames.length > 0 ? "미번역" : "모든 게임"}
              count={translatedGames.length > 0 ? untranslatedGames.length : games.length}
              iconColor="var(--accent)"
            />
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
              }}
            >
              {(translatedGames.length > 0 ? untranslatedGames : games).map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  onClick={() => router.push(`/library/${game.id}`)}
                />
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderOpenIcon className="size-16 text-text-tertiary mb-4" />
          <p className="text-text-secondary font-medium">{t("noGames")}</p>
          <p className="text-sm text-text-tertiary mt-1">게임 폴더를 추가해서 시작하세요</p>
          <Button variant="default" size="sm" className="mt-4" onClick={() => setShowAddModal(true)}>
            <PlusIcon className="size-4" /> {t("addGame")}
          </Button>
        </div>
      )}
    </div>
  )
}
