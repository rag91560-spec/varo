"use client"

import { useState, useCallback, useEffect } from "react"
import {
  LanguagesIcon,
  XCircleIcon,
  CheckCircleIcon,
  RotateCcwIcon,
  DatabaseIcon,
  LockIcon,
  WifiOffIcon,
  SparklesIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import { AI_PROVIDERS, OFFLINE_PROVIDER_IDS, getProvider } from "@/lib/providers"
import { Paywall } from "@/components/ui/paywall"
import { ChipButton } from "./ChipButton"
import type { Game, TranslationPreset } from "@/lib/types"
import type { TranslationProgress } from "@/lib/types"

type TabMode = "offline" | "ai"

// Engines with auto Korean font patching support
const FONT_SUPPORT_MAP: Record<string, "auto" | "partial" | "none"> = {
  "RPG Maker MV/MZ": "auto",
  "RPG Maker MV": "auto",
  "RPG Maker MZ": "auto",
  "Unity": "auto",
  "UE4": "auto",
  "Ren'Py": "auto",
  "TyranoScript": "auto",
  "RPG Maker VX Ace": "auto",
  "RPG Maker XP": "auto",
  "GDevelop": "auto",
  "Godot": "partial",
  "GameMaker": "partial",
  "Kirikiri": "partial",
}

interface TranslationPanelProps {
  game: Game
  gameId: number
  isTranslating: boolean
  progress: TranslationProgress
  txMessage: string | undefined
  license: { valid: boolean }
  onRefresh: () => void
  onActionError: (msg: string) => void
  onTranslateStart: (opts: { provider: string; model?: string; presetId?: number }) => void
  onCancel: () => void
  onLicenseRefresh?: () => void
}

export function TranslationPanel({
  game,
  gameId,
  isTranslating,
  progress,
  txMessage,
  license,
  onRefresh,
  onActionError,
  onTranslateStart,
  onCancel,
  onLicenseRefresh,
}: TranslationPanelProps) {
  const { t } = useLocale()

  const [tab, setTab] = useState<TabMode>(license.valid ? "ai" : "offline")
  const [provider, setProvider] = useState(license.valid ? "claude_oauth" : "offline")
  const [selectedModel, setSelectedModel] = useState(license.valid ? "" : "nllb-600m-game-v1")
  const [presets, setPresets] = useState<TranslationPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)
  const [tmNotification, setTmNotification] = useState("")

  useEffect(() => {
    api.presets.list().then(setPresets).catch((e) => console.error("Failed to load presets:", e))
  }, [])

  // Switch tab → update provider/model
  const handleTabChange = useCallback((newTab: TabMode) => {
    setTab(newTab)
    if (newTab === "offline") {
      setProvider("offline")
      setSelectedModel("nllb-600m-game-v1")
    } else {
      setProvider("claude_oauth")
      setSelectedModel("")
    }
  }, [])

  const handleTranslate = useCallback(() => {
    onTranslateStart({
      provider,
      model: selectedModel || undefined,
      presetId: selectedPresetId || undefined,
    })
  }, [provider, selectedModel, selectedPresetId, onTranslateStart])

  const handleApply = useCallback(async () => {
    setApplying(true)
    try { await api.translate.apply(gameId); onRefresh() }
    catch (e) {
      const msg = e instanceof Error ? e.message : t("applyFailed")
      onActionError(msg)
    } finally { setApplying(false) }
  }, [gameId, onRefresh, onActionError, t])

  const handleRollback = useCallback(async () => {
    try { await api.translate.rollback(gameId); onRefresh() }
    catch (e) {
      const msg = e instanceof Error ? e.message : "Rollback failed"
      onActionError(msg)
    }
  }, [gameId, onRefresh, onActionError])

  const handleImportTM = useCallback(async () => {
    try {
      const res = await api.translationMemory.importFromGame(gameId)
      const msg = t("tmImportedEntries").replace("${count}", String(res.imported))
      setTmNotification(msg)
      setTimeout(() => setTmNotification(""), 5000)
    } catch (e) { console.error("TM import failed:", e) }
  }, [gameId, t])

  return (
    <div className="rounded-lg p-5 bg-overlay-2 border border-overlay-6">
      <div className="flex items-center gap-2 mb-4">
        <LanguagesIcon className="size-5 text-accent" />
        <h2 className="text-base font-semibold text-text-primary">{t("translationProgress")}</h2>
      </div>

      {/* Tab buttons */}
      <div className="flex gap-1.5 mb-4">
        <button
          onClick={() => handleTabChange("offline")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "offline"
              ? "bg-accent text-white"
              : "bg-overlay-4 text-text-secondary hover:text-text-primary"
          }`}
        >
          <WifiOffIcon className="size-3.5" />
          {t("offlineTranslation")}
        </button>
        <button
          onClick={() => handleTabChange("ai")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === "ai"
              ? "bg-accent text-white"
              : "bg-overlay-4 text-text-secondary hover:text-text-primary"
          }`}
        >
          <SparklesIcon className="size-3.5" />
          {t("aiTranslation")}
          {!license.valid && <LockIcon className="size-3" />}
        </button>
      </div>

      {/* Tab description */}
      <div className="mb-3 space-y-1">
        <p className="text-xs text-text-tertiary">
          {tab === "offline" ? t("offlineDesc") : t("aiDesc")}
        </p>
        <p className="text-[11px] text-text-tertiary/70 italic">
          {t("qualityCompare")}
        </p>
      </div>

      {/* Offline tab */}
      {tab === "offline" && (
        <>
          {/* Fixed offline model display */}
          <div className="mb-4">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 block">
              {t("model")}
            </label>
            <div className="flex flex-wrap gap-1.5">
              <ChipButton selected onClick={() => {}} className="font-mono text-[11px]">
                nllb-600m-game-v1
              </ChipButton>
            </div>
          </div>

          {/* Preset selector */}
          {presets.length > 0 && (
            <div className="mb-4">
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 block">
                {t("presetLabel")}
              </label>
              <div className="flex flex-wrap gap-1.5">
                <ChipButton
                  selected={!selectedPresetId}
                  onClick={() => setSelectedPresetId(null)}
                >
                  {t("none")}
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

          {/* Start / Cancel */}
          <div className="flex flex-wrap gap-2">
            {isTranslating ? (
              <Button variant="secondary" size="sm" onClick={onCancel} className="flex-1">
                <XCircleIcon className="size-4" /> {t("cancelTranslation")}
              </Button>
            ) : (
              <Button variant="default" size="sm" onClick={handleTranslate} disabled={!game.engine} className="flex-1">
                <LanguagesIcon className="size-4" /> {t("startTranslation")}
              </Button>
            )}
          </div>
        </>
      )}

      {/* AI tab — wrapped in Paywall */}
      {tab === "ai" && (
        <Paywall show={!license.valid} onLicenseVerified={onLicenseRefresh}>
          {/* Provider selector (AI only) */}
          <div className="mb-4">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 block">
              {t("aiProvider")}
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
              {AI_PROVIDERS.map((p) => (
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
                  {t("model")}
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
                {t("presetLabel")}
              </label>
              <div className="flex flex-wrap gap-1.5">
                <ChipButton
                  selected={!selectedPresetId}
                  onClick={() => setSelectedPresetId(null)}
                >
                  {t("none")}
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

          {/* Start / Cancel */}
          <div className="flex flex-wrap gap-2">
            {isTranslating ? (
              <Button variant="secondary" size="sm" onClick={onCancel} className="flex-1">
                <XCircleIcon className="size-4" /> {t("cancelTranslation")}
              </Button>
            ) : (
              <Button variant="default" size="sm" onClick={handleTranslate} disabled={!game.engine} className="flex-1">
                <LanguagesIcon className="size-4" /> {t("startTranslation")}
              </Button>
            )}
          </div>
        </Paywall>
      )}

      {/* Dedup statistics (shown after translation completes) */}
      {progress.dedup_stats && !isTranslating && (
        <div className="mt-3 rounded-lg bg-overlay-2 border border-overlay-6 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <DatabaseIcon className="size-4 text-accent" />
            <span className="text-xs font-semibold text-text-primary">Optimization</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-text-tertiary">Total</span>
              <p className="text-text-primary font-medium">{progress.dedup_stats.total_strings.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-text-tertiary">API Calls</span>
              <p className="text-accent font-medium">{progress.dedup_stats.api_calls.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-text-tertiary">Saved</span>
              <p className="text-success font-medium">{progress.dedup_stats.saved_pct}%</p>
            </div>
          </div>
          {(progress.dedup_stats.exact_dedup > 0 || progress.dedup_stats.fuzzy_dedup > 0 || progress.dedup_stats.tm_hits > 0) && (
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-text-tertiary">
              {progress.dedup_stats.exact_dedup > 0 && <span>Exact dedup: -{progress.dedup_stats.exact_dedup}</span>}
              {progress.dedup_stats.fuzzy_dedup > 0 && <span>Fuzzy dedup: -{progress.dedup_stats.fuzzy_dedup}</span>}
              {progress.dedup_stats.tm_hits > 0 && <span>TM hits: {progress.dedup_stats.tm_hits}</span>}
            </div>
          )}
        </div>
      )}

      {/* TM import notification */}
      {tmNotification && (
        <div className="mt-3 flex items-center gap-2 text-xs text-accent bg-accent/10 rounded-md px-3 py-2">
          <CheckCircleIcon className="size-3.5" />
          <span className="flex-1">{tmNotification}</span>
          <button onClick={() => setTmNotification("")} className="shrink-0 text-accent/60 hover:text-accent">&times;</button>
        </div>
      )}

      {/* Action buttons — always accessible outside tabs */}
      {game.translated_count > 0 && !isTranslating && (
        <div className="flex flex-wrap gap-2 mt-3">
          <Button variant="accent" size="sm" onClick={handleApply} loading={applying}>
            <CheckCircleIcon className="size-4" /> {t("apply")}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleImportTM}>
            <DatabaseIcon className="size-4" /> {t("tmSave")}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleRollback}>
            <RotateCcwIcon className="size-4" /> {t("rollback")}
          </Button>
        </div>
      )}

      {/* Font support indicator */}
      {game.engine && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {(() => {
            const support = FONT_SUPPORT_MAP[game.engine] ?? "none"
            if (support === "auto") return (
              <span className="flex items-center gap-1 text-success">
                <CheckCircleIcon className="size-3.5" />
Korean font: Auto
              </span>
            )
            if (support === "partial") return (
              <span className="flex items-center gap-1 text-warning">
                <SparklesIcon className="size-3.5" />
Korean font: Partial
              </span>
            )
            return (
              <span className="flex items-center gap-1 text-text-tertiary">
                <XCircleIcon className="size-3.5" />
Korean font: Not supported
              </span>
            )
          })()}
        </div>
      )}

      {!game.engine && (
        <p className="mt-3 text-xs text-text-tertiary">
          {t("scanFirstHint")}
        </p>
      )}
      {game.engine && game.string_count === 0 && (
        <p className="mt-3 text-xs text-text-tertiary">
          {t("engineLabel")}: {game.engine} — {t("extractStringsHint")}
        </p>
      )}
    </div>
  )
}
