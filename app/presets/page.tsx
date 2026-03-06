"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import {
  SlidersHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  EditIcon,
  SaveIcon,
  XIcon,
  Loader2Icon,
  CopyIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import { PRESET_PROVIDER_IDS, PRESET_PROVIDER_NAMES } from "@/lib/providers"
import { appConfirm } from "@/lib/utils"
import type { TranslationPreset, ReferencePair } from "@/lib/types"

const TONE_IDS = ["", "formal", "casual", "literary", "game_ui"] as const

const EMPTY_PRESET: Omit<TranslationPreset, "id" | "created_at" | "updated_at"> = {
  name: "",
  game_id: null,
  engine: "",
  provider: "",
  model: "",
  tone: "",
  glossary_json: "{}",
  instructions: "",
  use_memory: true,
  reference_pairs_json: "[]",
}

// Parse glossary for display
function parseGlossary(json: string): Array<[string, string]> {
  try {
    const obj = JSON.parse(json)
    return Object.entries(obj) as Array<[string, string]>
  } catch { return [] }
}

// Parse reference pairs
function parseReferencePairs(json: string): ReferencePair[] {
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

export default function PresetsPage() {
  const { t } = useLocale()

  const PROVIDERS = useMemo(() => PRESET_PROVIDER_IDS.map((id) => ({
    id,
    name: id === "" ? t("useDefault") : id === "offline" ? t("offlineNllb") : id === "offline_hq" ? t("offlineHq") : PRESET_PROVIDER_NAMES[id] || id,
  })), [t])
  const TONES = useMemo(() => TONE_IDS.map((id) => ({
    id,
    name: id === "" ? t("toneDefault") : id === "formal" ? t("toneFormal") : id === "casual" ? t("toneCasual") : id === "literary" ? t("toneLiterary") : t("toneGameUi"),
  })), [t])

  const [presets, setPresets] = useState<TranslationPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | "new" | null>(null)
  const [form, setForm] = useState(EMPTY_PRESET)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")

  const loadPresets = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.presets.list()
      setPresets(data)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPresets() }, [loadPresets])

  const handleNew = () => {
    setErrorMsg("")
    setForm({ ...EMPTY_PRESET })
    setEditingId("new")
  }

  const handleEdit = (preset: TranslationPreset) => {
    setErrorMsg("")
    setForm({
      name: preset.name,
      game_id: preset.game_id,
      engine: preset.engine,
      provider: preset.provider,
      model: preset.model,
      tone: preset.tone,
      glossary_json: preset.glossary_json,
      instructions: preset.instructions,
      use_memory: preset.use_memory,
      reference_pairs_json: preset.reference_pairs_json || "[]",
    })
    setEditingId(preset.id)
  }

  const handleDuplicate = (preset: TranslationPreset) => {
    setErrorMsg("")
    setForm({
      name: `${preset.name} (${t("copy")})`,
      game_id: preset.game_id,
      engine: preset.engine,
      provider: preset.provider,
      model: preset.model,
      tone: preset.tone,
      glossary_json: preset.glossary_json,
      instructions: preset.instructions,
      use_memory: preset.use_memory,
      reference_pairs_json: preset.reference_pairs_json || "[]",
    })
    setEditingId("new")
  }

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return

    // Validate glossary JSON
    if (form.glossary_json && form.glossary_json.trim() !== "{}") {
      try {
        const parsed = JSON.parse(form.glossary_json)
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setErrorMsg("Glossary must be a JSON object (e.g. {\"key\": \"value\"})")
          return
        }
      } catch {
        setErrorMsg("Invalid glossary JSON format")
        return
      }
    }

    setSaving(true)
    try {
      if (editingId === "new") {
        await api.presets.create({ ...form, name: form.name.trim() })
      } else if (typeof editingId === "number") {
        await api.presets.update(editingId, form)
      }
      setEditingId(null)
      setErrorMsg("")
      loadPresets()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }, [form, editingId, loadPresets])

  const handleDelete = useCallback(async (id: number) => {
    if (!(await appConfirm(t("confirmDeletePreset")))) return
    try {
      await api.presets.delete(id)
      loadPresets()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Delete failed")
    }
  }, [loadPresets, t])

  const handleCancel = () => {
    setEditingId(null)
    setForm(EMPTY_PRESET)
    setErrorMsg("")
  }

  const referencePairs = parseReferencePairs(form.reference_pairs_json)

  const addReferencePair = () => {
    const pairs = [...referencePairs, { source: "", target: "" }]
    setForm({ ...form, reference_pairs_json: JSON.stringify(pairs) })
  }

  const updateReferencePair = (index: number, field: "source" | "target", value: string) => {
    const pairs = [...referencePairs]
    pairs[index] = { ...pairs[index], [field]: value }
    setForm({ ...form, reference_pairs_json: JSON.stringify(pairs) })
  }

  const removeReferencePair = (index: number) => {
    const pairs = referencePairs.filter((_, i) => i !== index)
    setForm({ ...form, reference_pairs_json: JSON.stringify(pairs) })
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
            {t("presets")}
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {t("presetsDescription")}
          </p>
        </div>
        <Button variant="default" size="sm" onClick={handleNew}>
          <PlusIcon className="size-4" />
          {t("newPreset")}
        </Button>
      </div>

      {/* Error Message */}
      {errorMsg && (
        <div className="flex items-center justify-between rounded-lg px-4 py-2.5 text-sm text-error bg-error/10 border border-error/20">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg("")} className="text-error/60 hover:text-error transition-colors ml-2 shrink-0">
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

      {/* Edit/Create Form */}
      {editingId !== null && (

          <Card className="bg-surface">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">
                  {editingId === "new" ? t("newPreset") : t("editPreset")}
                </h3>
                <button onClick={handleCancel} className="text-text-tertiary hover:text-text-primary transition-colors">
                  <XIcon className="size-4" />
                </button>
              </div>

              {/* Name */}
              <div>
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                  {t("presetName")}
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t("presetNamePlaceholder")}
                  className="w-full h-11 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
              </div>

              {/* Provider + Model */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                    {t("translationProvider")}
                  </label>
                  <select
                    value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                    {t("modelOptional")}
                  </label>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder={t("useDefaultModel")}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </div>
              </div>

              {/* Tone + Engine */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                    {t("translationTone")}
                  </label>
                  <select
                    value={form.tone}
                    onChange={(e) => setForm({ ...form, tone: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    {TONES.map((tone) => (
                      <option key={tone.id} value={tone.id}>{tone.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                    {t("engineFilter")}
                  </label>
                  <input
                    type="text"
                    value={form.engine}
                    onChange={(e) => setForm({ ...form, engine: e.target.value })}
                    placeholder={t("allEngines")}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </div>
              </div>

              {/* Instructions */}
              <div>
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                  {t("translationInstructions")}
                </label>
                <textarea
                  value={form.instructions}
                  onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                  placeholder={t("instructionsPlaceholder")}
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
                <p className="text-[10px] text-text-tertiary mt-1">
                  {t("instructionsHelp")}
                </p>
              </div>

              {/* Reference Translation Pairs */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    {t("referenceExamples")}
                  </label>
                  <button
                    type="button"
                    onClick={addReferencePair}
                    className="flex items-center gap-1 text-[11px] text-accent hover:text-accent/80 transition-colors"
                  >
                    <PlusIcon className="size-3" />
                    {t("add")}
                  </button>
                </div>
                {referencePairs.length === 0 ? (
                  <button
                    type="button"
                    onClick={addReferencePair}
                    className="w-full py-3 rounded-lg border border-dashed border-border text-xs text-text-tertiary hover:border-accent/50 hover:text-text-secondary transition-all"
                  >
                    {t("referenceEmptyHint")}
                  </button>
                ) : (
                  <div className="space-y-2">
                    {referencePairs.map((pair, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <input
                          type="text"
                          value={pair.source}
                          onChange={(e) => updateReferencePair(i, "source", e.target.value)}
                          placeholder={t("sourcePlaceholder")}
                          className="flex-1 h-9 px-2.5 rounded-md border border-border bg-surface-elevated text-text-primary text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
                        />
                        <span className="text-text-tertiary text-xs mt-2 shrink-0">→</span>
                        <input
                          type="text"
                          value={pair.target}
                          onChange={(e) => updateReferencePair(i, "target", e.target.value)}
                          placeholder={t("targetPlaceholder")}
                          className="flex-1 h-9 px-2.5 rounded-md border border-border bg-surface-elevated text-text-primary text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
                        />
                        <button
                          type="button"
                          onClick={() => removeReferencePair(i)}
                          className="size-9 flex items-center justify-center rounded-md text-text-tertiary hover:text-error hover:bg-error/5 transition-all shrink-0"
                        >
                          <Trash2Icon className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Glossary */}
              <div>
                <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                  {t("glossaryJson")}
                </label>
                <textarea
                  value={form.glossary_json}
                  onChange={(e) => setForm({ ...form, glossary_json: e.target.value })}
                  placeholder='{"勇者": "용사", "魔王": "마왕"}'
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
              </div>

              {/* Use TM */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.use_memory}
                  onChange={(e) => setForm({ ...form, use_memory: e.target.checked })}
                  className="sr-only peer"
                />
                <div
                  className={`size-5 rounded-[6px] border flex items-center justify-center transition-all pointer-events-none ${
                    form.use_memory
                      ? "bg-accent/15 border-accent"
                      : "bg-transparent border-overlay-12"
                  }`}
                >
                  {form.use_memory && (
                    <svg viewBox="0 0 12 12" className="size-3 text-accent" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="2,6 5,9 10,3" />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-text-primary">{t("useTranslationMemory")}</span>
              </label>

              {/* Save/Cancel */}
              <div className="flex gap-2 pt-2">
                <Button variant="default" size="sm" onClick={handleSave} loading={saving} className="flex-1">
                  <SaveIcon className="size-4" />
                  {t("save")}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  {t("cancel")}
                </Button>
              </div>
            </CardContent>
          </Card>

      )}

      {/* Presets List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2Icon className="size-8 text-accent animate-spin" />
        </div>
      ) : presets.length === 0 && editingId === null ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <SlidersHorizontalIcon className="size-16 text-text-tertiary mb-4" />
          <p className="text-text-secondary font-medium">{t("noPresets")}</p>
          <p className="text-sm text-text-tertiary mt-1">{t("noPresetsHint")}</p>
          <Button variant="default" size="sm" className="mt-4" onClick={handleNew}>
            <PlusIcon className="size-4" /> {t("newPreset")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {presets.map((preset) => {
            const refPairs = parseReferencePairs(preset.reference_pairs_json || "[]")
            const glossary = parseGlossary(preset.glossary_json)
            return (
              <Card key={preset.id} className="bg-surface">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-text-primary">{preset.name}</h3>
                        {preset.use_memory && (
                          <span className="px-2 py-0.5 rounded-[6px] bg-accent/10 text-accent text-[10px] font-medium">
                            TM
                          </span>
                        )}
                        {refPairs.length > 0 && (
                          <span className="px-2 py-0.5 rounded-[6px] bg-emerald-500/10 text-emerald-400 text-[10px] font-medium">
                            {t("example")} {refPairs.length}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                        {preset.provider && (
                          <span className="text-xs text-text-secondary">
                            {t("providerLabel")}: {PROVIDERS.find(p => p.id === preset.provider)?.name || preset.provider}
                          </span>
                        )}
                        {preset.model && (
                          <span className="text-xs text-text-tertiary font-mono">{preset.model}</span>
                        )}
                        {preset.tone && (
                          <span className="text-xs text-text-secondary">
                            {t("toneLabel")}: {TONES.find(tn => tn.id === preset.tone)?.name || preset.tone}
                          </span>
                        )}
                        {preset.engine && (
                          <span className="text-xs text-text-tertiary">{t("engineLabel")}: {preset.engine}</span>
                        )}
                      </div>
                      {preset.instructions && (
                        <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{preset.instructions}</p>
                      )}
                      {glossary.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {glossary.slice(0, 5).map(([k, v]) => (
                            <span key={k} className="px-1.5 py-0.5 rounded-[4px] bg-surface-elevated text-[10px] text-text-secondary font-mono">
                              {k}→{v}
                            </span>
                          ))}
                          {glossary.length > 5 && (
                            <span className="text-[10px] text-text-tertiary">
                              +{glossary.length - 5}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-3 shrink-0">
                      <button
                        onClick={() => handleDuplicate(preset)}
                        title={t("duplicate")}
                        className="size-8 flex items-center justify-center rounded-[8px] text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-all"
                      >
                        <CopyIcon className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleEdit(preset)}
                        title={t("edit")}
                        className="size-8 flex items-center justify-center rounded-[8px] text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-all"
                      >
                        <EditIcon className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(preset.id)}
                        title={t("delete")}
                        className="size-8 flex items-center justify-center rounded-[8px] text-text-tertiary hover:text-error hover:bg-error/5 transition-all"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
