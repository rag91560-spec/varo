"use client"

import { useState, useCallback, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import {
  PlayIcon,
  ScanIcon,
  Loader2Icon,
  GamepadIcon,
  ArrowLeftIcon,
  Trash2Icon,
  EditIcon,
  ImageIcon,
  SmartphoneIcon,
  RefreshCwIcon,
  GlobeIcon,
  FileTextIcon,
  LinkIcon,
  AlertTriangleIcon,
  AlertCircleIcon,
  InfoIcon,
  ShieldCheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  BrainCircuitIcon,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale, type TranslationKey } from "@/hooks/use-locale"
import { useGame, useSettings, useTranslationProgress, useLicenseStatus } from "@/hooks/use-api"
import { api } from "@/lib/api"
import { getProgressPct, getStatusInfo, appConfirm } from "@/lib/utils"
import type { QAResult, Game } from "@/lib/types"
import { ExportImportButtons } from "@/components/export-import-buttons"
import { GameHeroBanner } from "@/components/game-detail/GameHeroBanner"
import { CoverSearchModal } from "@/components/game-detail/CoverSearchModal"
import { EmulatorPanel } from "@/components/game-detail/EmulatorPanel"
import { TranslationPanel } from "@/components/game-detail/TranslationPanel"
import { MediaPanel } from "@/components/game-detail/MediaPanel"
import { useAIChat } from "@/hooks/use-ai-chat"

const HTML_ENGINES = ["rpg maker mv/mz", "tyranoscript", "gdevelop", "html"]

/* ─── Action Icon Button ─── */
function ActionIconButton({ onClick, children, title, isActive, isDanger }: {
  onClick: () => void
  children: React.ReactNode
  title?: string
  isActive?: boolean
  isDanger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`size-10 flex items-center justify-center rounded-lg transition-all duration-[140ms] border
        ${isActive
          ? "bg-accent-muted border-accent/50 text-accent"
          : isDanger
            ? "border-border hover:border-error/30 text-text-secondary hover:text-error hover:bg-error/8"
            : "border-border text-text-secondary hover:text-text-primary hover:bg-overlay-6"
        }`}
    >
      {children}
    </button>
  )
}

/* ─── Play Button ─── */
function PlayButton({ onClick, loading, disabled }: {
  onClick: () => void
  loading?: boolean
  disabled?: boolean
}) {
  const { t } = useLocale()

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="h-10 px-5 rounded-lg flex items-center justify-center gap-2 text-white font-bold text-sm whitespace-nowrap shrink-0 transition-all duration-[140ms] disabled:opacity-40 disabled:cursor-not-allowed bg-accent hover:brightness-110 active:scale-[0.98]"
    >
      {loading ? (
        <Loader2Icon className="size-[18px] animate-spin" />
      ) : (
        <PlayIcon className="size-[18px] fill-white" />
      )}
      <span>{t("launchGame")}</span>
    </button>
  )
}

export default function GameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const rawGameId = parseInt(id, 10)
  const gameId = isNaN(rawGameId) ? null : rawGameId
  const router = useRouter()
  const { t } = useLocale()
  const { game, loading, refresh } = useGame(gameId)
  const { settings } = useSettings()
  const { license, refresh: refreshLicense } = useLicenseStatus()
  const { progress, status: txStatus, message: txMessage, connect, reset } =
    useTranslationProgress(gameId)

  useEffect(() => {
    if (txStatus === "completed" || txStatus === "error" || txStatus === "cancelled") {
      refresh()
    }
  }, [txStatus, refresh])

  // Auto-reconnect: 페이지 복귀 시 번역 중이면 자동으로 폴링 재연결
  useEffect(() => {
    if (game?.status === "translating" && txStatus === "idle") {
      connect()
    }
  }, [game?.status, txStatus, connect])

  const [scanning, setScanning] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState("")
  const [editExe, setEditExe] = useState("")
  const [editEngine, setEditEngine] = useState("")
  const [actionError, setActionError] = useState("")
  const [showCoverSearch, setShowCoverSearch] = useState(false)

  const isAndroid = game?.platform === "android"
  const isHtmlGame = HTML_ENGINES.includes((game?.engine || "").toLowerCase())

  const handleScan = useCallback(async () => {
    if (gameId === null) return
    setScanning(true)
    try { await api.games.scan(gameId); refresh() }
    catch (e) { console.error("Scan failed:", e) } finally { setScanning(false) }
  }, [gameId, refresh])

  const handleLaunch = useCallback(async () => {
    if (gameId === null) return
    setLaunching(true)
    setActionError("")
    try {
      const result = await api.games.launch(gameId)
      if (result.html_game && result.serve_url) {
        if (window.electronAPI?.isElectron) {
          await window.electronAPI.openHtmlGame({
            gameId,
            title: game?.title || "Game",
            serveUrl: result.serve_url,
          })
        } else {
          router.push(`/play/${gameId}`)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Launch failed"
      setActionError(msg)
    } finally {
      setLaunching(false)
    }
  }, [gameId, game?.title, router])

  const [startingTranslation, setStartingTranslation] = useState(false)

  const handleTranslateStart = useCallback(async (opts: { provider: string; model?: string; presetId?: number }) => {
    if (gameId === null) return
    reset()
    setStartingTranslation(true)
    setActionError("")
    try {
      await api.translate.start(gameId, {
        provider: opts.provider,
        model: opts.model,
        source_lang: game?.source_lang || "auto",
        preset_id: opts.presetId,
      })
      connect()
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("translationStartFailed")
      setActionError(msg)
    } finally {
      setStartingTranslation(false)
    }
  }, [gameId, game, connect, reset, t])

  const handleCancel = useCallback(async () => {
    if (gameId === null) return
    try { await api.translate.cancel(gameId) } catch (e) { console.error("Cancel failed:", e) }
  }, [gameId])

  const handleDelete = useCallback(async () => {
    if (gameId === null) return
    if (!(await appConfirm(t("confirmDeleteGame")))) return
    try {
      await api.games.delete(gameId)
      router.push("/library")
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("unknownError"))
    }
  }, [gameId, router, t])

  const handleSaveEdit = useCallback(async () => {
    if (gameId === null) return
    try {
      const prevEngine = game?.engine || ""
      await api.games.update(gameId, { title: editTitle, exe_path: editExe, engine: editEngine || undefined })
      setEditing(false)
      // Re-scan if engine was changed so resource list reflects the new engine
      if (editEngine && editEngine !== prevEngine) {
        await api.games.scan(gameId).catch(() => {})
      }
      refresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("unknownError"))
    }
  }, [gameId, editTitle, editExe, editEngine, refresh, t])

  const openCoverSearch = useCallback(() => {
    setShowCoverSearch(true)
  }, [])

  const handleReinstall = useCallback(async () => {
    if (gameId === null) return
    try {
      await api.android.reinstall(gameId)
    } catch (e) { console.error("Reinstall failed:", e) }
  }, [gameId])

  /* ── Loading / Not Found ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Loader2Icon className="size-8 text-accent animate-spin" />
      </div>
    )
  }
  if (!game) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-3">
        <GamepadIcon className="size-12 text-text-tertiary" />
        <p className="text-text-secondary">{t("gameNotFound")}</p>
        <Button variant="ghost" size="sm" onClick={() => router.push("/library")}>
          <ArrowLeftIcon className="size-4" /> {t("backToLibrary")}
        </Button>
      </div>
    )
  }

  const pct = getProgressPct(game)
  const { text: statusText, color: statusColor } = getStatusInfo(game, t)
  const isTranslating = startingTranslation || txStatus === "running" || txStatus === "connecting" || game?.status === "translating"

  return (
    <div className="max-w-4xl mx-auto pb-8 px-4">
      {/* Hero Banner */}
      <GameHeroBanner
        game={game}
        statusText={statusText}
        statusColor={statusColor}
        editing={editing}
        editTitle={editTitle}
        editExe={editExe}
        editEngine={editEngine}
        onEditTitle={setEditTitle}
        onEditExe={setEditExe}
        onEditEngine={setEditEngine}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => setEditing(false)}
        onBack={() => router.push("/library")}
        onOpenCoverSearch={openCoverSearch}
      />

      {/* Action Bar */}
      <div className="px-6 py-4 flex items-center gap-3 bg-background/95 border-b border-border">
        {isAndroid ? (
          <PlayButton onClick={handleLaunch} loading={launching} disabled={false} />
        ) : (
          <PlayButton onClick={handleLaunch} loading={launching} disabled={!game.exe_path && !isHtmlGame} />
        )}

        {isAndroid && (
          <ReinstallButton onClick={handleReinstall} t={t} />
        )}

        <div className="flex-1 px-4 min-w-0">
          {actionError && (
            <span className="text-xs text-red-400 flex items-center gap-1 mb-0.5">
              <span className="truncate">{actionError}</span>
              <button onClick={() => setActionError("")} className="shrink-0 text-red-400/60 hover:text-red-400">&times;</button>
            </span>
          )}
          <span className="text-sm text-text-secondary truncate block">
            {isAndroid ? (
              <>
                <SmartphoneIcon className="size-3.5 inline mr-1" />
                {t("androidGame")}
                {game.package_name && ` \u00B7 ${game.package_name}`}
              </>
            ) : (
              <>
                {isHtmlGame && <GlobeIcon className="size-3.5 inline mr-1" />}
                {isHtmlGame && <span className="text-accent font-medium mr-1">{t("htmlGame")}</span>}
                {isHtmlGame && game.engine && game.engine !== "HTML" && ` \u00B7 `}
                {(!isHtmlGame || (game.engine && game.engine !== "HTML")) && (game.engine || t("engineNotDetected"))}
                {game.developer && ` \u00B7 ${game.developer}`}
                {game.dlsite_id && ` \u00B7 ${game.dlsite_id}`}
                {game.vndb_id && ` \u00B7 ${game.vndb_id}`}
              </>
            )}
          </span>
        </div>

        {!isAndroid && (
          <ActionIconButton onClick={handleScan} title={t("engineScan")}>
            {scanning ? <Loader2Icon className="size-[18px] animate-spin" /> : <ScanIcon className="size-[18px]" />}
          </ActionIconButton>
        )}
        <ActionIconButton
          onClick={() => { setEditTitle(game.title); setEditExe(game.exe_path); setEditEngine(game.engine || ""); setEditing(true) }}
          title={t("edit")}
        >
          <EditIcon className="size-[18px]" />
        </ActionIconButton>
        <ActionIconButton onClick={openCoverSearch} title={t("fetchCover")}>
          <ImageIcon className="size-[18px]" />
        </ActionIconButton>
        <ActionIconButton onClick={handleDelete} title={t("delete")} isDanger>
          <Trash2Icon className="size-[18px]" />
        </ActionIconButton>
      </div>

      {/* Content */}
      <div className="px-6 pt-6 space-y-5">
        {/* Cover Search Modal */}
        {showCoverSearch && (
          <CoverSearchModal
            gameId={game.id}
            game={game}
            onClose={() => setShowCoverSearch(false)}
            onRefresh={refresh}
          />
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: t("totalStrings"), value: game.string_count.toLocaleString(), accent: false },
            { label: t("translatedStrings"), value: game.translated_count.toLocaleString(), accent: true },
            { label: t("progress"), value: `${pct}%`, accent: pct === 100 },
            { label: t("statusTranslationPct"), value: statusText, accent: game.status === "applied" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6"
            >
              <p className="text-xs text-text-tertiary">{stat.label}</p>
              <p className={`text-lg font-bold mt-1 ${stat.accent ? "text-accent" : "text-text-primary"}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Translation Progress */}
        {isTranslating && (
          <Card className="bg-surface">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-text-primary">{t("progress")}</span>
                <span className="text-sm font-mono text-accent font-bold">{Math.round(progress.progress)}%</span>
              </div>
              <div className="h-2.5 bg-surface-elevated rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${progress.progress}%` }} />
              </div>
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-text-tertiary">
                  {startingTranslation ? t("preparingTranslation") : txMessage || t("translating")}
                </p>
                <p className="text-xs text-text-secondary font-mono">{progress.translated}/{progress.total}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Android: Emulator Status Panel */}
        {isAndroid && <EmulatorPanel gameId={game.id} game={game} />}

        {/* Translation Panel */}
        <TranslationPanel
          game={game}
          gameId={game.id}
          isTranslating={isTranslating}
          progress={progress}
          txMessage={txMessage}
          license={license}
          onRefresh={refresh}
          onActionError={setActionError}
          onTranslateStart={handleTranslateStart}
          onCancel={handleCancel}
          onLicenseRefresh={refreshLicense}
        />

        {/* QA Panel */}
        {game.string_count > 0 && <QAPanel gameId={game.id} t={t} />}

        {/* AI Agent — prominent when engine unknown */}
        <AIAgentCard game={game} t={t} />

        {/* Tools: String Editor, Flow Graph, Export/Import */}
        {game.string_count > 0 && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Link href={`/library/${game.id}/strings`} className="flex-1">
                <div className="rounded-lg p-4 bg-overlay-2 border border-overlay-6 hover:border-accent/30 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2">
                    <FileTextIcon className="size-4 text-accent" />
                    <span className="text-sm font-medium text-text-primary">{t("stringEditor")}</span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-1">{t("stringEditorDesc")}</p>
                </div>
              </Link>
              <Link href={`/library/${game.id}/flow`} className="flex-1">
                <div className="rounded-lg p-4 bg-overlay-2 border border-overlay-6 hover:border-accent/30 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2">
                    <LinkIcon className="size-4 text-accent" />
                    <span className="text-sm font-medium text-text-primary">{t("flowGraph")}</span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-1">{t("flowGraphDesc")}</p>
                </div>
              </Link>
            </div>
            <ExportImportButtons gameId={game.id} onImportSuccess={() => refresh()} />
          </div>
        )}

        {/* Media Panel */}
        <MediaPanel gameId={game.id} />

        {/* Game Path */}
        <div className="rounded-lg p-4 bg-overlay-2 border border-overlay-4">
          {isAndroid ? (
            <>
              <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">{t("platform")}</p>
              <p className="text-sm text-text-secondary font-mono break-all flex items-center gap-1.5">
                <SmartphoneIcon className="size-3.5 text-emerald-500" /> {t("platformAndroid")}
              </p>
              {game.package_name && (
                <>
                  <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 mt-3">{t("packageName")}</p>
                  <p className="text-sm text-text-secondary font-mono break-all">{game.package_name}</p>
                </>
              )}
              <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 mt-3">{t("gamePath")}</p>
              <p className="text-sm text-text-secondary font-mono break-all">{game.path}</p>
              {game.original_path && (
                <>
                  <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 mt-3">{t("originalPath")}</p>
                  <p className="text-sm text-text-secondary font-mono break-all">{game.original_path}</p>
                </>
              )}
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">{t("gamePath")}</p>
              <p className="text-sm text-text-secondary font-mono break-all">{game.path}</p>
              {game.exe_path && (
                <>
                  <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 mt-3">{t("exeFile")}</p>
                  <p className="text-sm text-text-secondary font-mono break-all">{game.exe_path}</p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Reinstall Button (small inline helper) ─── */
function ReinstallButton({ onClick, t }: { onClick: () => Promise<void>; t: (key: TranslationKey) => string }) {
  const [reinstalling, setReinstalling] = useState(false)
  const handleClick = async () => {
    setReinstalling(true)
    try { await onClick() } finally { setReinstalling(false) }
  }
  return (
    <button
      onClick={handleClick}
      disabled={reinstalling}
      className="h-10 px-3 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all text-xs flex items-center gap-1.5"
    >
      {reinstalling ? <Loader2Icon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
      {t("reinstall")}
    </button>
  )
}


/* ─── QA Panel Component ─── */
function QAPanel({ gameId, t }: { gameId: number; t: (key: TranslationKey) => string }) {
  const [qaIssues, setQaIssues] = useState<QAResult[]>([])
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const loadQA = useCallback(async () => {
    try {
      const res = await api.qa.get(gameId)
      setQaIssues(res.issues || [])
      setLoaded(true)
    } catch { /* no QA results yet */ }
  }, [gameId])

  useEffect(() => { loadQA() }, [loadQA])

  const handleRunQA = async () => {
    setRunning(true)
    try {
      const res = await api.qa.run(gameId)
      setQaIssues(res.issues || [])
      setExpanded(true)
      setLoaded(true)
    } catch (e: unknown) {
      // Might be no project
    } finally {
      setRunning(false)
    }
  }

  const handleResolve = async (qaId: number) => {
    try {
      await api.qa.resolve(gameId, qaId)
      setQaIssues(prev => prev.map(i => i.id === qaId ? { ...i, resolved: true } : i))
    } catch { /* ignore */ }
  }

  const errors = qaIssues.filter(i => i.severity === "error" && !i.resolved)
  const warnings = qaIssues.filter(i => i.severity === "warning" && !i.resolved)
  const infos = qaIssues.filter(i => i.severity === "info" && !i.resolved)
  const unresolved = errors.length + warnings.length + infos.length

  const checkTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      untranslated: t("qaUntranslated"),
      length_overflow: t("qaLengthOverflow"),
      placeholder_mismatch: t("qaPlaceholderMismatch"),
      consistency: t("qaConsistency"),
    }
    return labels[type] || type
  }

  const severityIcon = (severity: string) => {
    if (severity === "error") return <AlertCircleIcon className="size-3.5 text-error" />
    if (severity === "warning") return <AlertTriangleIcon className="size-3.5 text-warning" />
    return <InfoIcon className="size-3.5 text-info" />
  }

  return (
    <div className="rounded-lg p-4 bg-overlay-2 border border-overlay-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="size-5 text-accent" />
          <h2 className="text-base font-semibold text-text-primary">{t("qaCheck")}</h2>
          {loaded && unresolved > 0 && (
            <div className="flex items-center gap-1.5 ml-2">
              {errors.length > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-error/15 text-error">
                  {errors.length} {t("qaErrors")}
                </span>
              )}
              {warnings.length > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-warning/15 text-warning">
                  {warnings.length} {t("qaWarnings")}
                </span>
              )}
            </div>
          )}
          {loaded && unresolved === 0 && qaIssues.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-success/15 text-success ml-2">
              {t("qaNoIssues")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleRunQA} loading={running}>
            {running ? <Loader2Icon className="size-4 animate-spin" /> : <ScanIcon className="size-4" />}
            {t("qaRun")}
          </Button>
          {qaIssues.length > 0 && (
            <button onClick={() => setExpanded(!expanded)} className="p-1">
              {expanded ? <ChevronUpIcon className="size-4 text-text-tertiary" /> : <ChevronDownIcon className="size-4 text-text-tertiary" />}
            </button>
          )}
        </div>
      </div>

      {expanded && qaIssues.length > 0 && (
        <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
          {qaIssues.filter(i => !i.resolved).slice(0, 50).map((issue) => (
            <div key={issue.id} className="flex items-start gap-2 p-2 rounded-md bg-overlay-4 text-xs">
              {severityIcon(issue.severity)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-text-primary">#{issue.entry_index}</span>
                  <span className="px-1 py-0.5 rounded bg-overlay-6 text-text-tertiary text-[10px]">
                    {checkTypeLabel(issue.check_type)}
                  </span>
                </div>
                <p className="text-text-secondary mt-0.5 truncate">{issue.message}</p>
              </div>
              <button
                onClick={() => handleResolve(issue.id)}
                className="px-2 py-0.5 rounded text-[10px] font-medium text-text-tertiary hover:text-success hover:bg-success/10 transition-colors"
              >
                {t("qaResolve")}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loaded && (
        <p className="mt-2 text-xs text-text-tertiary">{t("qaAutoComplete")}</p>
      )}
    </div>
  )
}

/* ─── AI Agent Card — opens sidebar ─── */
function AIAgentCard({ game, t }: { game: Game; t: (key: TranslationKey) => string }) {
  const { setOpen } = useAIChat()
  const isUnknown = !game.engine || game.engine === "unknown"

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={`w-full text-left rounded-lg p-4 border transition-colors cursor-pointer ${
        isUnknown
          ? "bg-purple-500/10 border-purple-500/30 hover:border-purple-400/50"
          : "bg-overlay-2 border-overlay-6 hover:border-accent/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <BrainCircuitIcon className={`size-4 ${isUnknown ? "text-purple-400" : "text-accent"}`} />
        <span className="text-sm font-medium text-text-primary">{t("aiAgent")}</span>
        {isUnknown && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 ml-auto">AI</span>
        )}
      </div>
      <p className="text-xs text-text-tertiary mt-1">{t("aiAgentDesc")}</p>
    </button>
  )
}
