"use client"

import { useState, useCallback, useEffect } from "react"
import {
  LanguagesIcon,
  XCircleIcon,
  CheckCircleIcon,
  RotateCcwIcon,
  DatabaseIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import { PROVIDERS, getProvider } from "@/lib/providers"
import { Paywall } from "@/components/ui/paywall"
import { ChipButton } from "./ChipButton"
import type { Game, TranslationPreset } from "@/lib/types"
import type { TranslationProgress } from "@/lib/types"

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

  const [provider, setProvider] = useState("claude_oauth")
  const [selectedModel, setSelectedModel] = useState("")
  const [presets, setPresets] = useState<TranslationPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)
  const [tmNotification, setTmNotification] = useState("")

  useEffect(() => {
    api.presets.list().then(setPresets).catch((e) => console.error("Failed to load presets:", e))
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
    <Paywall show={!license.valid} onLicenseVerified={onLicenseRefresh}>
    <div className="rounded-lg p-5 bg-overlay-2 border border-overlay-6">
      <div className="flex items-center gap-2 mb-4">
        <LanguagesIcon className="size-5 text-accent" />
        <h2 className="text-base font-semibold text-text-primary">{t("translationProgress")}</h2>
      </div>

      {/* Provider selector */}
      <div className="mb-4">
        <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2 block">
          {t("aiProvider")}
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

      {/* TM import notification */}
      {tmNotification && (
        <div className="mb-3 flex items-center gap-2 text-xs text-accent bg-accent/10 rounded-md px-3 py-2">
          <CheckCircleIcon className="size-3.5" />
          <span className="flex-1">{tmNotification}</span>
          <button onClick={() => setTmNotification("")} className="shrink-0 text-accent/60 hover:text-accent">&times;</button>
        </div>
      )}

      {/* Action buttons */}
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
        {game.translated_count > 0 && !isTranslating && (
          <>
            <Button variant="accent" size="sm" onClick={handleApply} loading={applying}>
              <CheckCircleIcon className="size-4" /> {t("apply")}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleImportTM}>
              <DatabaseIcon className="size-4" /> {t("tmSave")}
            </Button>
            {game.status === "applied" && (
              <Button variant="ghost" size="sm" onClick={handleRollback}>
                <RotateCcwIcon className="size-4" /> {t("rollback")}
              </Button>
            )}
          </>
        )}
      </div>

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
    </Paywall>
  )
}
