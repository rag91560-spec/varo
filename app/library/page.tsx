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
  SmartphoneIcon,
  MonitorIcon,
  FilterIcon,
  FileTextIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"
import { useGames } from "@/hooks/use-api"
import { api } from "@/lib/api"
import type { Game } from "@/lib/types"
import { getProgressPct, getStatusInfo } from "@/lib/utils"

/* ─── Status Badge ─── */
function StatusBadge({ game }: { game: Game }) {
  const { t } = useLocale()
  const { text, color, icon, idle } = getStatusInfo(game, t)

  // No badge for scanned-only games (has engine, 0% translated)
  if (!icon && !idle && getProgressPct(game) === 0 && game.engine) return null

  const IconEl = icon === "check" ? CheckCircleIcon : icon === "spinner" ? Loader2Icon : icon === "alert" ? AlertCircleIcon : null

  return (
    <span
      className={`inline-flex items-center gap-1 px-3 py-0.5 rounded-[8px] text-[10px] font-semibold ${
        idle
          ? "bg-surface-elevated/80 text-text-secondary border border-overlay-8"
          : "text-white"
      }`}
      style={idle ? undefined : { background: color }}
    >
      {IconEl && <IconEl className={`size-2.5 ${icon === "spinner" ? "animate-spin" : ""}`} />}
      {text}
    </span>
  )
}

/* ─── Game Card (Steam/Epic launcher style) ─── */
function GameCard({ game, onClick }: { game: Game; onClick: () => void }) {
  const pct = getProgressPct(game)
  const hasCover = !!game.cover_path

  return (
    <div
      className="group cursor-pointer rounded-md overflow-hidden relative transition-all duration-200 ease-out hover:scale-[1.03] hover:border-accent hover:shadow-[0_0_12px_var(--accent-muted)] aspect-[3/4] border-2 border-transparent"
      onClick={onClick}
    >
      {/* Full-bleed cover image */}
      {hasCover ? (
        <img
          src={`/api/covers/${game.id}.jpg?t=${game.updated_at}`}
          alt={game.title}
          className="absolute inset-0 w-full h-full object-cover transition-[filter] duration-200 group-hover:brightness-110"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <GamepadIcon className="size-10 text-accent/30" />
        </div>
      )}

      {/* Bottom gradient overlay for title */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none bg-gradient-to-t from-black/85 via-black/40 to-transparent"
      />

      {/* Status Badge (top-left) */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
        <StatusBadge game={game} />
      </div>

      {/* Platform / Language Badge (top-right) */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        {game.variant_lang && (
          <span className="px-2 py-0.5 rounded-[6px] bg-accent/90 text-white text-[9px] font-bold">
            {game.variant_lang}
          </span>
        )}
        {game.platform === "android" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-emerald-500/90 text-white text-[9px] font-semibold">
            <SmartphoneIcon className="size-2.5" />
            APK
          </span>
        )}
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
          backgroundColor: `color-mix(in srgb, ${iconColor} 15%, transparent)`,
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
    Array<{ title: string; path: string; engine: string; exe_path: string; platform?: string; variant_lang?: string }>
  >([])
  const [platformFilter, setPlatformFilter] = useState<"all" | "windows" | "android">("all")
  const [showApkModal, setShowApkModal] = useState(false)
  const [apkPath, setApkPath] = useState("")
  const [apkLoading, setApkLoading] = useState(false)
  const [apkResults, setApkResults] = useState<Array<{ title: string; package_name: string; path: string; size: number }>>([])
  const [importingApk, setImportingApk] = useState<string | null>(null)
  const [subtitleLoading, setSubtitleLoading] = useState(false)

  const gamesRef = useRef(games)
  gamesRef.current = games

  const handleImportSubtitles = useCallback(async () => {
    setSubtitleLoading(true)
    try {
      let files: string[] = []
      if (window.electronAPI?.selectSubtitleFiles) {
        files = await window.electronAPI.selectSubtitleFiles()
      } else {
        // Web fallback: prompt for path
        const input = prompt(t("selectSubtitleFiles"))
        if (input) files = input.split(";").map(s => s.trim()).filter(Boolean)
      }
      if (!files.length) return
      await api.games.importSubtitles(files)
      refresh()
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setSubtitleLoading(false)
    }
  }, [refresh, t])

  const handleAddGame = useCallback(async () => {
    if (!addPath.trim()) return
    setAddLoading(true)
    setAddError("")
    try {
      const game = await api.games.create({ path: addPath.trim() })
      setAddPath("")
      setShowAddModal(false)
      refresh()
      // Auto-fetch cover in background
      api.covers.fetch(game.id).then(() => refresh()).catch((e) => console.error("Cover fetch failed:", e))
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
      const existingPaths = new Set(gamesRef.current.map(g => g.path))
      setScanResults(results.filter((r: { path: string }) => !existingPaths.has(r.path)))
    } catch (e) { console.error("Scan directory failed:", e);
      setScanResults([])
    } finally {
      setScanLoading(false)
    }
  }, [scanPath])

  const handleAddScanned = useCallback(
    async (scanned: { title: string; path: string; engine: string; platform?: string; variant_lang?: string }) => {
      try {
        let game: Game | undefined
        if (scanned.platform === "android") {
          const res = await api.android.importApk(scanned.path, scanned.title)
          game = res.game
        } else {
          game = await api.games.create({
            path: scanned.path,
            title: scanned.title,
            engine: scanned.engine,
            variant_lang: scanned.variant_lang,
          })
        }
        setScanResults((prev) => prev.filter((g) => g.path !== scanned.path))
        refresh()
        // Auto-fetch cover in background
        if (game?.id) {
          api.covers.fetch(game.id).then(() => refresh()).catch((e) => console.error("Cover fetch failed:", e))
        }
      } catch (e) { console.error("Add scanned game failed:", e) }
    },
    [refresh]
  )

  const [fetchingCovers, setFetchingCovers] = useState(false)
  const [scanningAll, setScanningAll] = useState(false)
  const [addingAll, setAddingAll] = useState(false)

  // Auto-refresh while covers are being fetched
  useEffect(() => {
    if (!fetchingCovers) return
    const interval = setInterval(() => refresh(), 5000)
    return () => clearInterval(interval)
  }, [fetchingCovers, refresh])
  const handleAddAll = useCallback(async () => {
    setAddingAll(true)
    try {
      await Promise.allSettled(
        scanResults.map((g) =>
          g.platform === "android"
            ? api.android.importApk(g.path, g.title)
            : api.games.create({ path: g.path, title: g.title, engine: g.engine, variant_lang: g.variant_lang })
        )
      )
      setScanResults([])
      refresh()
      // Auto-fetch covers for all newly added games
      setFetchingCovers(true)
      api.covers.fetchAll().then(() => refresh()).catch((e) => console.error("Cover fetch all failed:", e)).finally(() => setFetchingCovers(false))
    } finally {
      setAddingAll(false)
    }
  }, [scanResults, refresh])

  const handleScanAll = useCallback(async () => {
    setScanningAll(true)
    try {
      await api.games.scanAll()
      refresh()
    } catch (e) { console.error("Scan all failed:", e) } finally {
      setScanningAll(false)
    }
  }, [refresh])

  const handleFetchAllCovers = useCallback(async () => {
    setFetchingCovers(true)
    try {
      await api.covers.fetchAll()
      refresh()
    } catch (e) { console.error("Fetch all covers failed:", e) } finally {
      setFetchingCovers(false)
    }
  }, [refresh])

  const handleScanApks = useCallback(async () => {
    if (!apkPath.trim()) return
    setApkLoading(true)
    try {
      const res = await api.android.scanApks(apkPath.trim())
      setApkResults(res.apks)
    } catch (e) { console.error("Scan APKs failed:", e);
      setApkResults([])
    } finally {
      setApkLoading(false)
    }
  }, [apkPath])

  const handleImportApk = useCallback(async (apk: { title: string; path: string }) => {
    setImportingApk(apk.path)
    try {
      await api.android.importApk(apk.path, apk.title)
      setApkResults((prev) => prev.filter((a) => a.path !== apk.path))
      refresh()
    } catch (e) { console.error("Import APK failed:", e) } finally {
      setImportingApk(null)
    }
  }, [refresh])

  const handleImportAllApks = useCallback(async () => {
    setApkLoading(true)
    try {
      await Promise.allSettled(
        apkResults.map((apk) => api.android.importApk(apk.path, apk.title))
      )
      setApkResults([])
      refresh()
    } finally {
      setApkLoading(false)
    }
  }, [apkResults, refresh])

  // Platform filter + categorize games
  const filteredGames = platformFilter === "all" ? games : games.filter(g => (g.platform || "windows") === platformFilter)
  const translatedGames = filteredGames.filter(g => g.translated_count > 0 || g.status === "applied" || g.status === "translated")
  const untranslatedGames = filteredGames.filter(g => g.translated_count === 0 && g.status !== "applied" && g.status !== "translated")
  const hasAndroid = games.some(g => g.platform === "android")

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
            placeholder={t("searchGames")}
            className="w-full h-10 pl-10 pr-4 rounded-lg border border-border bg-surface text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
          />
        </div>
        {games.length > 0 && (
          <button
            onClick={handleScanAll}
            disabled={scanningAll}
            className="h-10 px-3 rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all text-xs flex items-center gap-1.5"
            title={t("scanAllTooltip")}
          >
            {scanningAll ? <Loader2Icon className="size-4 animate-spin" /> : <ScanIcon className="size-4" />}
            <span className="hidden md:inline">{t("scanAll")}</span>
          </button>
        )}
        {games.some(g => !g.cover_path) && (
          <button
            onClick={handleFetchAllCovers}
            disabled={fetchingCovers}
            className="h-10 px-3 rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all text-xs flex items-center gap-1.5"
            title={t("fetchCoversTooltip")}
          >
            {fetchingCovers ? <Loader2Icon className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
            <span className="hidden md:inline">{t("fetchCovers")}</span>
          </button>
        )}
        <button
          onClick={() => setShowApkModal(!showApkModal)}
          className="h-10 px-3 rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all text-xs flex items-center gap-1.5 border border-border"
          title={t("importApk")}
        >
          <SmartphoneIcon className="size-4" />
          <span className="hidden md:inline">{t("importApk")}</span>
        </button>
        <button
          onClick={handleImportSubtitles}
          disabled={subtitleLoading}
          className="h-10 px-3 rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all text-xs flex items-center gap-1.5 border border-border"
          title={t("importSubtitles")}
        >
          {subtitleLoading ? <Loader2Icon className="size-4 animate-spin" /> : <FileTextIcon className="size-4" />}
          <span className="hidden md:inline">{t("importSubtitles")}</span>
        </button>
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
              <h3 className="text-sm font-semibold text-text-primary">{t("addGameTitle")}</h3>
              <button
                onClick={() => { setShowAddModal(false); setAddError(""); setScanResults([]) }}
                className="size-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                {t("gameFolderPath")}
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
                  <PlusIcon className="size-4" /> {t("add")}
                </Button>
              </div>
              {addError && <p className="text-xs text-error mt-1">{addError}</p>}
            </div>
            <div className="pt-3 border-t border-border-subtle">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                {t("batchScan")}
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
                  <ScanIcon className="size-4" /> {t("scan")}
                </Button>
              </div>
            </div>
            {scanResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-secondary">{scanResults.length}{t("gamesFound")}</p>
                  <Button variant="default" size="sm" onClick={handleAddAll} loading={addingAll}>
                    <PlusIcon className="size-3" /> {t("addAll")}
                  </Button>
                </div>
                {scanResults.map((g) => (
                  <div key={g.path} className="flex items-center justify-between p-2.5 rounded-lg bg-overlay-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {g.title}
                        {g.variant_lang && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent/20 text-accent">{g.variant_lang}</span>
                        )}
                      </p>
                      <p className="text-xs text-text-tertiary">
                        {g.platform === "android" ? (
                          <><SmartphoneIcon className="size-3 inline mr-1" />APK</>
                        ) : (
                          g.engine || (g.exe_path ? "exe" : "—")
                        )}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleAddScanned(g)} className="shrink-0 ml-2">
                      <PlusIcon className="size-3" /> {t("add")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* APK Import Panel */}
      {showApkModal && (
        <div className="mb-5 rounded-xl overflow-hidden bg-surface border border-border-subtle">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <SmartphoneIcon className="size-4 text-emerald-500" />
                {t("apkImportTitle")}
              </h3>
              <button
                onClick={() => { setShowApkModal(false); setApkResults([]) }}
                className="size-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                {t("apkFolderPath")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={apkPath}
                  onChange={(e) => setApkPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScanApks()}
                  placeholder="D:\Downloads\APKs"
                  className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
                <Button variant="default" size="sm" onClick={handleScanApks} loading={apkLoading} className="shrink-0">
                  <ScanIcon className="size-4" /> {t("scan")}
                </Button>
              </div>
            </div>
            {apkResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-secondary">{apkResults.length}{t("apkFound")}</p>
                  <Button variant="default" size="sm" onClick={handleImportAllApks} loading={apkLoading}>
                    <PlusIcon className="size-3" /> {t("importAll")}
                  </Button>
                </div>
                {apkResults.map((apk) => (
                  <div key={apk.path} className="flex items-center justify-between p-2.5 rounded-lg bg-overlay-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">{apk.title}</p>
                      <p className="text-xs text-text-tertiary">
                        {apk.package_name} · {(apk.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleImportApk(apk)}
                      loading={importingApk === apk.path}
                      className="shrink-0 ml-2"
                    >
                      <PlusIcon className="size-3" /> {t("add")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Platform Filter */}
      {hasAndroid && (
        <div className="flex items-center gap-1.5 mb-4">
          <FilterIcon className="size-3.5 text-text-tertiary" />
          {(["all", "windows", "android"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all border ${
                platformFilter === p
                  ? "bg-accent-muted text-accent border-accent/30"
                  : "bg-overlay-2 text-text-secondary border-transparent hover:bg-overlay-4"
              }`}
            >
              {p === "all" && t("platformAll")}
              {p === "windows" && <><MonitorIcon className="size-3 inline mr-1" />{t("platformWindows")}</>}
              {p === "android" && <><SmartphoneIcon className="size-3 inline mr-1" />{t("platformAndroid")}</>}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2Icon className="size-8 text-accent animate-spin" />
        </div>
      ) : filteredGames.length > 0 ? (
        <div className="space-y-8">
          {/* Translated / Applied Section */}
          {translatedGames.length > 0 && (
            <section>
              <SectionHeader
                icon={CheckCircleIcon}
                title={t("translated")}
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
              title={translatedGames.length > 0 ? t("untranslated") : t("allGames")}
              count={translatedGames.length > 0 ? untranslatedGames.length : filteredGames.length}
              iconColor="var(--accent)"
            />
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
              }}
            >
              {(translatedGames.length > 0 ? untranslatedGames : filteredGames).map((game) => (
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
          <p className="text-sm text-text-tertiary mt-1">{t("noGamesHint")}</p>
          <Button variant="default" size="sm" className="mt-4" onClick={() => setShowAddModal(true)}>
            <PlusIcon className="size-4" /> {t("addGame")}
          </Button>
        </div>
      )}
    </div>
  )
}
