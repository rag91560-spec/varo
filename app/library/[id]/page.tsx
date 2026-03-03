"use client"

import { useState, useCallback, useEffect, useRef, use } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  PlayIcon,
  ScanIcon,
  LanguagesIcon,
  Loader2Icon,
  GamepadIcon,
  CheckCircleIcon,
  XCircleIcon,
  RotateCcwIcon,
  Trash2Icon,
  EditIcon,
  SaveIcon,
  ImageIcon,
  SearchIcon,
  XIcon,
  DatabaseIcon,
  MoreVerticalIcon,
  UploadIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"
import { useGame, useSettings, useTranslationProgress } from "@/hooks/use-api"
import { api } from "@/lib/api"
import { PROVIDERS, getProvider } from "@/lib/providers"
import type { CoverCandidate, TranslationPreset } from "@/lib/types"

/* ─── Nav Button (overlay on hero, always dark bg for contrast) ─── */
function NavButton({ onClick, children, className = "" }: {
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`size-10 flex items-center justify-center rounded-lg transition-all duration-[140ms] bg-black/30 border border-white/10 hover:bg-white/12 ${className}`}
    >
      {children}
    </button>
  )
}

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

/* ─── Chip Button (shared selector style) ─── */
function ChipButton({ selected, onClick, children, className = "" }: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1.5 rounded-md text-xs font-medium transition-all duration-[140ms] border
        ${selected
          ? "bg-accent-muted text-accent border-accent/30"
          : "bg-overlay-2 text-text-secondary border-transparent"
        } ${className}`}
    >
      {children}
    </button>
  )
}

/* ─── Play Button (solid accent, hover gradient) ─── */
function PlayButton({ onClick, loading, disabled }: {
  onClick: () => void
  loading?: boolean
  disabled?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const { t } = useLocale()

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      disabled={disabled || loading}
      className="w-[140px] py-3 px-6 rounded-lg flex items-center justify-center gap-2 text-white font-bold text-base transition-all duration-[140ms] disabled:opacity-40 disabled:cursor-not-allowed bg-accent hover:brightness-110"
      style={{
        transform: `scale(${pressed ? 0.98 : 1})`,
      }}
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
  const gameId = parseInt(id, 10)
  const router = useRouter()
  const { t } = useLocale()
  const { game, loading, refresh } = useGame(gameId)
  const { settings } = useSettings()
  const { progress, status: txStatus, message: txMessage, connect, reset } =
    useTranslationProgress(gameId)

  useEffect(() => {
    if (txStatus === "completed" || txStatus === "error" || txStatus === "cancelled") {
      refresh()
    }
  }, [txStatus, refresh])

  const [scanning, setScanning] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [applying, setApplying] = useState(false)
  const [provider, setProvider] = useState("claude_oauth")
  const [selectedModel, setSelectedModel] = useState("")
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState("")
  const [editExe, setEditExe] = useState("")
  const [fetchingCover, setFetchingCover] = useState(false)
  const [showCoverSearch, setShowCoverSearch] = useState(false)
  const [coverSearchQuery, setCoverSearchQuery] = useState("")
  const [coverResults, setCoverResults] = useState<CoverCandidate[]>([])
  const [searchingCovers, setSearchingCovers] = useState(false)
  const [coverSource, setCoverSource] = useState<"all" | "vndb" | "dlsite" | "web">("all")
  const [selectingCover, setSelectingCover] = useState<number | null>(null)
  const [presets, setPresets] = useState<TranslationPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.presets.list().then(setPresets).catch(() => {})
  }, [])

  const handleScan = useCallback(async () => {
    setScanning(true)
    try { await api.games.scan(gameId); refresh() }
    catch { /* ignore */ } finally { setScanning(false) }
  }, [gameId, refresh])

  const handleLaunch = useCallback(async () => {
    setLaunching(true)
    try { await api.games.launch(gameId) }
    catch { /* ignore */ } finally { setTimeout(() => setLaunching(false), 2000) }
  }, [gameId])

  const handleTranslate = useCallback(async () => {
    reset()
    try {
      const apiKeys = (settings.api_keys ?? {}) as Record<string, string>
      await api.translate.start(gameId, {
        provider,
        api_key: apiKeys[provider] || "",
        model: selectedModel || undefined,
        source_lang: game?.source_lang || "ja",
        preset_id: selectedPresetId || undefined,
      })
      connect()
    } catch { /* ignore */ }
  }, [gameId, provider, selectedModel, settings, game, connect, reset, selectedPresetId])

  const handleCancel = useCallback(async () => {
    try { await api.translate.cancel(gameId) } catch { /* ignore */ }
  }, [gameId])

  const handleApply = useCallback(async () => {
    setApplying(true)
    try { await api.translate.apply(gameId); refresh() }
    catch { /* ignore */ } finally { setApplying(false) }
  }, [gameId, refresh])

  const handleRollback = useCallback(async () => {
    try { await api.translate.rollback(gameId); refresh() }
    catch { /* ignore */ }
  }, [gameId, refresh])

  const handleDelete = useCallback(async () => {
    if (!confirm("이 게임을 라이브러리에서 삭제하시겠습니까?")) return
    await api.games.delete(gameId)
    router.push("/library")
  }, [gameId, router])

  const handleSaveEdit = useCallback(async () => {
    await api.games.update(gameId, { title: editTitle, exe_path: editExe })
    setEditing(false)
    refresh()
  }, [gameId, editTitle, editExe, refresh])

  const handleFetchCover = useCallback(async () => {
    setFetchingCover(true)
    try { await api.covers.fetch(gameId); refresh() }
    catch { /* ignore */ } finally { setFetchingCover(false) }
  }, [gameId, refresh])

  const handleSearchCovers = useCallback(async (sourceOverride?: "all" | "vndb" | "dlsite" | "web") => {
    if (!coverSearchQuery.trim()) return
    setSearchingCovers(true)
    const src = sourceOverride ?? coverSource
    const sources = src === "all" ? ["vndb", "dlsite", "web"] : [src]
    try {
      const res = await api.covers.search(gameId, coverSearchQuery.trim(), sources)
      setCoverResults(res.results)
    } catch { /* ignore */ } finally { setSearchingCovers(false) }
  }, [gameId, coverSearchQuery, coverSource])

  const handleSelectCover = useCallback(async (c: CoverCandidate, idx: number) => {
    setSelectingCover(idx)
    try {
      await api.covers.select(gameId, { url: c.url, source: c.source, external_id: c.external_id })
      setShowCoverSearch(false); setCoverResults([]); setSelectingCover(null); refresh()
    } catch { setSelectingCover(null) }
  }, [gameId, refresh])

  const handleUploadCover = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingCover(true)
    try {
      await api.covers.upload(gameId, file)
      setShowCoverSearch(false)
      refresh()
    } catch (err) {
      alert(`커버 업로드 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`)
    } finally {
      setUploadingCover(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }, [gameId, refresh])

  const openCoverSearch = useCallback(() => {
    const query = game?.title || ""
    setCoverSearchQuery(query)
    setCoverSource("all")
    setSelectingCover(null)
    setShowCoverSearch(true)
    if (query) {
      setSearchingCovers(true)
      api.covers.search(gameId, query, ["vndb", "dlsite", "web"])
        .then((res) => setCoverResults(res.results))
        .catch(() => {})
        .finally(() => setSearchingCovers(false))
    }
  }, [game, gameId])

  const handleImportTM = useCallback(async () => {
    try {
      const res = await api.translationMemory.importFromGame(gameId)
      alert(`번역 메모리에 ${res.imported}개 항목 추가됨`)
    } catch { /* ignore */ }
  }, [gameId])

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
        <p className="text-text-secondary">게임을 찾을 수 없습니다</p>
        <Button variant="ghost" size="sm" onClick={() => router.push("/library")}>
          <ArrowLeftIcon className="size-4" /> 라이브러리로 돌아가기
        </Button>
      </div>
    )
  }

  const pct = game.string_count > 0 ? Math.round((game.translated_count / game.string_count) * 100) : 0
  const isTranslating = txStatus === "running" || txStatus === "connecting"
  const hasCover = !!game.cover_path
  const statusText = game.status === "applied" ? "적용됨"
    : game.status === "translating" ? "번역 중"
    : game.status === "translated" || pct === 100 ? "번역 완료"
    : pct > 0 ? `번역 ${pct}%`
    : game.engine ? "스캔 완료" : "스캔 필요"

  return (
    <div className="max-w-4xl mx-auto pb-8">
      {/* ═══ HERO BANNER (280px) ═══ */}
      <div className="relative h-[280px] overflow-hidden">
        {hasCover ? (
          <img
            src={`/api/covers/${game.id}.jpg?t=${game.updated_at}`}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-accent/20">
            <GamepadIcon className="size-20 text-white/30" />
          </div>
        )}

        {/* Gradient overlay — always dark for readability over image */}
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(to bottom, transparent 0%, transparent 40%, rgba(12,12,15,0.6) 70%, rgba(12,12,15,0.95) 100%)",
          }}
        />

        {/* Top Nav */}
        <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
          <NavButton onClick={() => router.push("/library")}>
            <ArrowLeftIcon className="size-5 text-white" />
          </NavButton>
          <NavButton onClick={openCoverSearch}>
            <ImageIcon className="size-5 text-white" />
          </NavButton>
        </div>

        {/* Title (bottom-left) */}
        <div className="absolute left-6 right-6 bottom-6 z-10">
          <span
            className="inline-flex items-center gap-1 px-3 py-1 rounded-[8px] text-white text-[10px] font-semibold mb-3"
            style={{
              background: game.status === "applied"
                ? "var(--success)"
                : game.status === "translated" || pct === 100 ? "var(--accent)"
                : game.status === "translating" ? "var(--info)"
                : pct > 0 ? "var(--warning)"
                : game.engine ? "rgba(58,58,61,0.8)" : "var(--warning)",
            }}
          >
            {game.status === "applied" && <CheckCircleIcon className="size-3" />}
            {statusText}
          </span>
          {editing ? (
            <div className="space-y-2 max-w-lg">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full h-12 px-4 rounded-lg border border-white/10 bg-black/30 backdrop-blur-sm text-white text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <input
                value={editExe}
                onChange={(e) => setEditExe(e.target.value)}
                placeholder="실행 파일 경로"
                className="w-full h-10 px-4 rounded-lg border border-white/10 bg-black/30 backdrop-blur-sm text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <div className="flex gap-2">
                <Button variant="accent" size="sm" onClick={handleSaveEdit}>
                  <SaveIcon className="size-3.5" /> 저장
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)} className="text-white/80 hover:text-white">
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <h1
              className="text-[40px] font-bold text-white leading-[1.2] tracking-[-0.5px]"
              style={{ textShadow: "0 0 8px rgba(0,0,0,0.5)" }}
            >
              {game.title}
            </h1>
          )}
        </div>
      </div>

      {/* ═══ ACTION BAR ═══ */}
      <div className="px-6 py-4 flex items-center gap-3 bg-background/95 border-b border-border">
        <PlayButton onClick={handleLaunch} loading={launching} disabled={!game.exe_path} />

        <ActionIconButton onClick={() => {}} title="옵션">
          <MoreVerticalIcon className="size-[18px]" />
        </ActionIconButton>

        <div className="flex-1 px-4 min-w-0">
          <span className="text-sm text-text-secondary truncate block">
            {game.engine || "엔진 미감지"}
            {game.developer && ` · ${game.developer}`}
            {game.dlsite_id && ` · ${game.dlsite_id}`}
            {game.vndb_id && ` · ${game.vndb_id}`}
          </span>
        </div>

        <ActionIconButton onClick={handleScan} title="엔진 스캔">
          {scanning ? <Loader2Icon className="size-[18px] animate-spin" /> : <ScanIcon className="size-[18px]" />}
        </ActionIconButton>
        <ActionIconButton
          onClick={() => { setEditTitle(game.title); setEditExe(game.exe_path); setEditing(true) }}
          title="편집"
        >
          <EditIcon className="size-[18px]" />
        </ActionIconButton>
        <ActionIconButton onClick={openCoverSearch} title="커버 가져오기">
          <ImageIcon className="size-[18px]" />
        </ActionIconButton>
        <ActionIconButton onClick={handleDelete} title="삭제" isDanger>
          <Trash2Icon className="size-[18px]" />
        </ActionIconButton>
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="px-6 pt-6 space-y-5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUploadCover}
        />

        {/* Cover Search Modal */}
        {showCoverSearch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => { setShowCoverSearch(false); setCoverResults([]) }}>
            <div
              className="w-[680px] max-h-[85vh] rounded-xl overflow-hidden flex flex-col bg-surface border border-overlay-8"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
                <h3 className="text-sm font-semibold text-text-primary">커버 아트 검색</h3>
                <button onClick={() => { setShowCoverSearch(false); setCoverResults([]) }} className="size-8 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors">
                  <XIcon className="size-4" />
                </button>
              </div>

              {/* Search bar + Upload */}
              <div className="px-5 py-3 space-y-3 border-b border-border-subtle">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-tertiary" />
                    <input
                      type="text"
                      value={coverSearchQuery}
                      onChange={(e) => setCoverSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearchCovers()}
                      placeholder="게임 제목으로 검색..."
                      className="w-full h-10 pl-10 pr-3 rounded-lg border border-border bg-background text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                  <Button variant="default" size="sm" onClick={() => handleSearchCovers()} loading={searchingCovers}>
                    검색
                  </Button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingCover}
                    className="h-10 px-3 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-colors text-xs flex items-center gap-1.5"
                  >
                    {uploadingCover ? <Loader2Icon className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
                    업로드
                  </button>
                </div>

                {/* Source tabs */}
                <div className="flex gap-1">
                  {([["all", "전체"], ["vndb", "VNDB"], ["dlsite", "DLsite"], ["web", "웹 이미지"]] as const).map(([key, label]) => (
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
                    <p className="text-xs text-text-tertiary">검색 중...</p>
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
                    <p className="text-xs text-text-tertiary">검색어를 입력하고 검색 버튼을 누르세요</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: t("totalStrings"), value: game.string_count.toLocaleString(), accent: false },
            { label: t("translatedStrings"), value: game.translated_count.toLocaleString(), accent: true },
            { label: "진행률", value: `${pct}%`, accent: pct === 100 },
            { label: "상태", value: statusText, accent: game.status === "applied" },
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
                <p className="text-xs text-text-tertiary">{txMessage || t("translating")}</p>
                <p className="text-xs text-text-secondary font-mono">{progress.translated}/{progress.total}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Translation Panel */}
        <div className="rounded-lg p-5 bg-overlay-2 border border-overlay-6">
          <div className="flex items-center gap-2 mb-4">
            <LanguagesIcon className="size-5 text-accent" />
            <h2 className="text-base font-semibold text-text-primary">번역</h2>
          </div>

          {/* Provider selector */}
          <div className="mb-4">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 block">
              AI 제공자
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
              {PROVIDERS.map((p) => (
                <ChipButton
                  key={p.id}
                  selected={provider === p.id}
                  onClick={() => { setProvider(p.id); setSelectedModel(p.defaultModel) }}
                  className="py-2 text-center"
                >
                  {p.name}
                </ChipButton>
              ))}
            </div>
          </div>

          {/* Model selector */}
          {(() => {
            const prov = getProvider(provider)
            return prov && prov.models.length > 1 ? (
              <div className="mb-4">
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 block">
                  모델
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {prov.models.map((m) => (
                    <ChipButton
                      key={m}
                      selected={selectedModel === m}
                      onClick={() => setSelectedModel(m)}
                      className="font-mono text-[11px]"
                    >
                      {m}
                    </ChipButton>
                  ))}
                </div>
              </div>
            ) : null
          })()}

          {/* Preset selector */}
          {presets.length > 0 && (
            <div className="mb-4">
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 block">
                프리셋
              </label>
              <div className="flex flex-wrap gap-1.5">
                <ChipButton
                  selected={!selectedPresetId}
                  onClick={() => setSelectedPresetId(null)}
                >
                  없음
                </ChipButton>
                {presets.map((p) => (
                  <ChipButton
                    key={p.id}
                    selected={selectedPresetId === p.id}
                    onClick={() => setSelectedPresetId(p.id)}
                  >
                    {p.name}
                  </ChipButton>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {isTranslating ? (
              <Button variant="secondary" size="sm" onClick={handleCancel} className="flex-1">
                <XCircleIcon className="size-4" /> 번역 취소
              </Button>
            ) : (
              <Button variant="default" size="sm" onClick={handleTranslate} disabled={!game.engine || game.string_count === 0} className="flex-1">
                <LanguagesIcon className="size-4" /> 번역 시작
              </Button>
            )}
            {game.translated_count > 0 && !isTranslating && (
              <>
                <Button variant="accent" size="sm" onClick={handleApply} loading={applying}>
                  <CheckCircleIcon className="size-4" /> 적용
                </Button>
                <Button variant="ghost" size="sm" onClick={handleImportTM}>
                  <DatabaseIcon className="size-4" /> TM 저장
                </Button>
                {game.status === "applied" && (
                  <Button variant="ghost" size="sm" onClick={handleRollback}>
                    <RotateCcwIcon className="size-4" /> 롤백
                  </Button>
                )}
              </>
            )}
          </div>

          {!game.engine && (
            <p className="mt-3 text-xs text-text-tertiary">
              먼저 엔진 스캔을 실행하세요. 상단 바의 스캔 버튼을 클릭하면 게임 엔진을 자동 감지합니다.
            </p>
          )}
          {game.engine && game.string_count === 0 && (
            <p className="mt-3 text-xs text-text-tertiary">
              엔진: {game.engine} — 스캔 버튼을 눌러 문자열을 추출하세요.
            </p>
          )}
        </div>

        {/* Game Path */}
        <div className="rounded-lg p-4 bg-overlay-2 border border-overlay-4">
          <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">게임 경로</p>
          <p className="text-sm text-text-secondary font-mono break-all">{game.path}</p>
          {game.exe_path && (
            <>
              <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 mt-3">실행 파일</p>
              <p className="text-sm text-text-secondary font-mono break-all">{game.exe_path}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
