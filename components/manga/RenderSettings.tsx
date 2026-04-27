"use client"

import { useState, useEffect } from "react"
import { Loader2Icon, DownloadIcon, PaintbrushIcon, TypeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useLocale } from "@/hooks/use-locale"
import type { InpaintMode, FontInfo, RenderConfig, DetectorType } from "@/lib/types"

interface RenderSettingsProps {
  mangaId: number
  currentPage: number
  totalPages: number
  detector?: DetectorType
  onDetectorChange?: (d: DetectorType) => void
  config: Partial<RenderConfig>
  onConfigChange: (c: Partial<RenderConfig>) => void
  onRenderComplete?: () => void
}

const INPAINT_MODES: { id: InpaintMode; labelKey: string; descKey: string }[] = [
  { id: "solid", labelKey: "mangaInpaintSolid", descKey: "mangaInpaintSolidDesc" },
  { id: "telea", labelKey: "mangaInpaintTelea", descKey: "mangaInpaintTeleaDesc" },
  { id: "ns", labelKey: "mangaInpaintNS", descKey: "mangaInpaintNSDesc" },
  { id: "lama", labelKey: "mangaInpaintLama", descKey: "mangaInpaintLamaDesc" },
]

export function RenderSettings({ mangaId, currentPage, totalPages, detector, onDetectorChange, config, onConfigChange, onRenderComplete }: RenderSettingsProps) {
  const { t } = useLocale()
  const detectorValue = detector ?? "gemini"
  const setConfig = (updater: (c: Partial<RenderConfig>) => Partial<RenderConfig>) => {
    onConfigChange(updater(config))
  }

  const [fonts, setFonts] = useState<FontInfo[]>([])
  const [rendering, setRendering] = useState(false)
  const [batchRendering, setBatchRendering] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState("")

  // Load fonts
  useEffect(() => {
    api.manga.fonts().then(r => setFonts(r.fonts)).catch(() => {})
  }, [])

  const handleRenderPage = async () => {
    setRendering(true)
    setError("")
    try {
      await api.manga.renderPage(mangaId, currentPage, config as RenderConfig)
      onRenderComplete?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Render failed")
    } finally {
      setRendering(false)
    }
  }

  const handleRenderAll = async () => {
    setBatchRendering(true)
    setBatchProgress({ done: 0, total: totalPages })
    setError("")
    try {
      await api.manga.renderAll(mangaId, config as RenderConfig)
      // Listen to SSE for progress
      const es = new EventSource(api.manga.renderAllStatusUrl(mangaId))
      es.addEventListener("status", (e) => {
        const d = JSON.parse(e.data)
        setBatchProgress({ done: d.done ?? 0, total: d.total ?? totalPages })
        if (d.status === "completed") {
          setBatchRendering(false)
          es.close()
          onRenderComplete?.()
        } else if (d.status === "error") {
          setBatchRendering(false)
          setError(d.error ?? "Batch render failed")
          es.close()
        }
      })
      es.onerror = () => { setBatchRendering(false); es.close() }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start batch render")
      setBatchRendering(false)
    }
  }

  const handleDownloadFont = async (fontId: string) => {
    try {
      await api.manga.downloadFont(fontId)
      const r = await api.manga.fonts()
      setFonts(r.fonts)
    } catch {}
  }

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
        <PaintbrushIcon className="size-4" />
        {t("mangaRenderSettings")}
      </h3>
      <p className="text-[11px] text-text-tertiary leading-relaxed -mt-1">
        {t("renderSettingsHint")}
      </p>

      {/* Text Detection */}
      <div className="space-y-1.5">
        <label className="text-xs text-text-secondary">{t("mangaTextDetection")}</label>
        <select
          value={detectorValue}
          onChange={e => onDetectorChange?.(e.target.value as DetectorType)}
          className="w-full text-xs px-2.5 py-1.5 rounded-md border border-border bg-background text-text-primary"
        >
          <option value="gemini">{t("mangaTextDetectionGemini")}</option>
          <option value="local">{t("mangaTextDetectionLocal")}</option>
        </select>
        {detectorValue === "local" && (
          <p className="text-[10px] text-text-tertiary">
            {t("mangaTextDetectionLocalDesc")}
          </p>
        )}
      </div>

      {/* Inpainting Mode */}
      <div className="space-y-1.5">
        <label className="text-xs text-text-secondary">{t("mangaInpainting")}</label>
        <div className="grid grid-cols-2 gap-1.5">
          {INPAINT_MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setConfig(c => ({ ...c, inpaint_mode: m.id }))}
              className={`px-2.5 py-1.5 text-xs rounded-md border transition-all ${
                config.inpaint_mode === m.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-text-secondary hover:border-border-subtle"
              }`}
            >
              <div className="font-medium">{t(m.labelKey as any)}</div>
              <div className="text-[10px] opacity-70">{t(m.descKey as any)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Font Selection */}
      <div className="space-y-1.5">
        <label className="text-xs text-text-secondary flex items-center gap-1">
          <TypeIcon className="size-3" />
          {t("mangaFont")}
        </label>
        <div className="space-y-1">
          {fonts.map(f => (
            <div key={f.id} className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (!f.installed) return
                  setConfig(c => ({ ...c, font_id: f.id }))
                }}
                disabled={!f.installed}
                className={`flex-1 px-2.5 py-1.5 text-xs rounded-md border text-left transition-all ${
                  config.font_id === f.id
                    ? "border-accent bg-accent/10 text-accent"
                    : f.installed
                      ? "border-border text-text-secondary hover:border-border-subtle"
                      : "border-border text-text-tertiary opacity-50 cursor-not-allowed"
                }`}
              >
                <span>{f.name} <span className="opacity-60">({f.type})</span></span>
                {!f.installed && (
                  <span className="ml-1.5 text-[10px] text-amber-500/80">{t("installRequired")}</span>
                )}
              </button>
              {!f.installed && (
                <Button variant="ghost" size="sm" onClick={() => handleDownloadFont(f.id)}>
                  <DownloadIcon className="size-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Options */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={config.auto_color}
            onChange={e => setConfig(c => ({ ...c, auto_color: e.target.checked }))}
            className="rounded"
          />
          {t("mangaAutoColor")}
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={config.outline_enabled}
            onChange={e => setConfig(c => ({ ...c, outline_enabled: e.target.checked }))}
            className="rounded"
          />
          {t("mangaOutline")}
        </label>
        {config.outline_enabled && (
          <div className="flex items-center gap-2 pl-5">
            <span className="text-xs text-text-tertiary">{t("mangaOutlineWidth")}</span>
            <input
              type="range"
              min={1}
              max={5}
              value={config.outline_width}
              onChange={e => setConfig(c => ({ ...c, outline_width: parseInt(e.target.value) }))}
              className="flex-1 h-1"
            />
            <span className="text-xs text-text-tertiary w-4">{config.outline_width}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">{t("mangaDirection")}</span>
          <select
            value={config.direction}
            onChange={e => setConfig(c => ({ ...c, direction: e.target.value as "auto" | "horizontal" | "vertical" }))}
            className="text-xs px-2 py-1 rounded border border-border bg-background text-text-primary"
          >
            <option value="auto">{t("mangaDirectionAuto")}</option>
            <option value="horizontal">{t("mangaDirectionHorizontal")}</option>
            <option value="vertical">{t("mangaDirectionVertical")}</option>
          </select>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 pt-2 border-t border-border">
        <Button
          onClick={handleRenderPage}
          disabled={rendering || batchRendering}
          loading={rendering}
          className="w-full"
          size="sm"
        >
          {rendering ? t("mangaRendering") : `${t("reRender")} (${currentPage}${t("pageCount")})`}
        </Button>
        <Button
          variant="secondary"
          onClick={handleRenderAll}
          disabled={rendering || batchRendering}
          className="w-full"
          size="sm"
        >
          {batchRendering ? (
            <>
              <Loader2Icon className="size-3 animate-spin" />
              {batchProgress.done}/{batchProgress.total}
            </>
          ) : t("mangaRenderAll")}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
