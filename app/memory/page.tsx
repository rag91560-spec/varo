"use client"

import { useState, useCallback, useEffect } from "react"
import {
  DatabaseIcon,
  SearchIcon,
  Trash2Icon,
  Loader2Icon,
  RefreshCwIcon,
  DownloadIcon,
  AlertTriangleIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"
import { useGames } from "@/hooks/use-api"
import { api } from "@/lib/api"
import type { TMEntry, TMStats } from "@/lib/types"
import { appConfirm } from "@/lib/utils"

export default function MemoryPage() {
  const { t } = useLocale()
  const { games } = useGames()
  const [stats, setStats] = useState<TMStats | null>(null)
  const [entries, setEntries] = useState<TMEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchLang, setSearchLang] = useState("")
  const [importing, setImporting] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  const loadStats = useCallback(async () => {
    try {
      const s = await api.translationMemory.stats()
      setStats(s)
    } catch { /* ignore */ }
  }, [])

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.translationMemory.search({
        search: searchQuery || undefined,
        source_lang: searchLang || undefined,
        limit: 100,
      })
      setEntries(data)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [searchQuery, searchLang])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadEntries() }, [loadEntries])

  const handleDelete = useCallback(async (id: number) => {
    try {
      await api.translationMemory.delete(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      loadStats()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Delete failed")
      setTimeout(() => setErrorMsg(""), 5000)
    }
  }, [loadStats])

  const handleClear = useCallback(async () => {
    if (!(await appConfirm(t("confirmClearMemory")))) return
    try {
      await api.translationMemory.clear()
      setEntries([])
      loadStats()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Clear failed")
      setTimeout(() => setErrorMsg(""), 5000)
    }
  }, [loadStats, t])

  const handleImport = useCallback(async (gameId: number) => {
    setImporting(gameId)
    try {
      const res = await api.translationMemory.importFromGame(gameId)
      setSuccessMsg(`${res.imported}${t("importedEntries")}`)
      setTimeout(() => setSuccessMsg(""), 4000)
      loadStats()
      loadEntries()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Import failed")
      setTimeout(() => setErrorMsg(""), 5000)
    } finally {
      setImporting(null)
    }
  }, [loadStats, loadEntries, t])

  const translatedGames = games.filter(g => g.translated_count > 0)

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
          {t("translationMemory")}
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {t("memoryDescription")}
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6">
            <p className="text-2xl font-bold text-accent">{stats.total.toLocaleString()}</p>
            <p className="text-xs text-text-tertiary mt-1">{t("totalEntries")}</p>
          </div>
          {Object.entries(stats.by_lang).map(([lang, count]) => (
            <div key={lang} className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6">
              <p className="text-2xl font-bold text-text-primary">{(count as number).toLocaleString()}</p>
              <p className="text-xs text-text-tertiary mt-1">{lang.toUpperCase()}</p>
            </div>
          ))}
          {Object.entries(stats.by_provider).map(([prov, count]) => (
            <div key={prov} className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6">
              <p className="text-2xl font-bold text-text-primary">{(count as number).toLocaleString()}</p>
              <p className="text-xs text-text-tertiary mt-1">{prov || "unknown"}</p>
            </div>
          ))}
        </div>
      )}

      {/* Import from Games */}
      {translatedGames.length > 0 && (

          <Card className="bg-surface">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <DownloadIcon className="size-4 text-accent" />
                {t("importFromGames")}
              </CardTitle>
              <CardDescription>
                {t("importFromGamesDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {translatedGames.map((game) => (
                  <Button
                    key={game.id}
                    variant="secondary"
                    size="sm"
                    onClick={() => handleImport(game.id)}
                    loading={importing === game.id}
                    disabled={importing !== null}
                  >
                    <DownloadIcon className="size-3.5" />
                    {game.title}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

      )}

      {/* Messages */}
      {errorMsg && (
        <div className="rounded-lg px-4 py-2.5 text-sm text-error bg-error/10 border border-error/20">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="rounded-lg px-4 py-2.5 text-sm text-success bg-success/10 border border-success/20">
          {successMsg}
        </div>
      )}

      {/* Search + Actions */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchTranslations")}
            className="w-full h-11 pl-10 pr-4 rounded-lg border border-border bg-surface text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
          />
        </div>
        <select
          value={searchLang}
          onChange={(e) => setSearchLang(e.target.value)}
          className="h-11 px-3 rounded-lg border border-border bg-surface text-text-primary text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <option value="">{t("allLanguages")}</option>
          <option value="ja">{t("japanese")}</option>
          <option value="en">{t("english")}</option>
          <option value="zh">{t("chinese")}</option>
        </select>
        <Button variant="ghost" size="sm" onClick={() => { loadEntries(); loadStats() }}>
          <RefreshCwIcon className="size-4" />
        </Button>
        {stats && stats.total > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClear} className="text-error hover:text-error">
            <AlertTriangleIcon className="size-4" />
            {t("deleteAll")}
          </Button>
        )}
      </div>

      {/* Entries Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2Icon className="size-8 text-accent animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <DatabaseIcon className="size-16 text-text-tertiary mb-4" />
          <p className="text-text-secondary font-medium">
            {searchQuery ? t("noSearchResults") : t("memoryEmpty")}
          </p>
          <p className="text-sm text-text-tertiary mt-1">
            {t("memoryAutoSave")}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-[1fr_1fr_80px_60px_40px] gap-3 px-4 py-2 text-[10px] font-medium text-text-tertiary uppercase tracking-wider">
            <span>{t("sourceText")}</span>
            <span>{t("translatedText")}</span>
            <span>{t("provider")}</span>
            <span>{t("usageCount")}</span>
            <span></span>
          </div>
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="grid grid-cols-[1fr_1fr_80px_60px_40px] gap-3 px-4 py-2.5 rounded-lg items-center group hover:bg-surface-elevated transition-colors"
            >
              <p className="text-sm text-text-primary truncate font-mono" title={entry.source_text}>
                {entry.source_text}
              </p>
              <p className="text-sm text-text-secondary truncate" title={entry.translated_text}>
                {entry.translated_text}
              </p>
              <span className="text-xs text-text-tertiary truncate">{entry.provider || "-"}</span>
              <span className="text-xs text-text-tertiary font-mono">{entry.usage_count}</span>
              <button
                onClick={() => handleDelete(entry.id)}
                className="size-7 flex items-center justify-center rounded-[6px] text-text-tertiary hover:text-error hover:bg-error/5 transition-all opacity-0 group-hover:opacity-100"
              >
                <Trash2Icon className="size-3" />
              </button>
            </div>
          ))}
          {entries.length >= 100 && (
            <p className="text-xs text-text-tertiary text-center py-3">
              {t("maxEntriesNotice")}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
