"use client"

import { cn } from "@/lib/utils"
import { useLocale } from "@/hooks/use-locale"
import {
  CameraIcon,
  PlayIcon,
  SquareIcon,
  CropIcon,
  XIcon,
  LayersIcon,
  EyeIcon,
  EyeOffIcon,
  Settings2Icon,
  ArrowRightIcon,
  LockIcon,
} from "lucide-react"
import type { LiveSettings, CaptureSource } from "@/lib/types"

interface CapturePanelProps {
  settings: LiveSettings
  onUpdateSettings: (patch: Partial<LiveSettings>) => void
  loading: boolean
  capturing: boolean
  onCapture: () => void
  onStartAuto: () => void
  onStopAuto: () => void
  onSelectRegion: () => void
  onClearRegion: () => void
  onToggleOverlay: () => void
  licensed?: boolean
}

export function CapturePanel({
  settings,
  onUpdateSettings,
  loading,
  capturing,
  onCapture,
  onStartAuto,
  onStopAuto,
  onSelectRegion,
  onClearRegion,
  onToggleOverlay,
  licensed = false,
}: CapturePanelProps) {
  const { t } = useLocale()
  return (
    <div className="space-y-4">
      {/* Capture controls */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onCapture}
          disabled={!settings.sourceId || loading}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
            "bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <CameraIcon className="size-4" />
          {loading ? t("capturing") : t("captureAndTranslate")}
        </button>

        {!capturing ? (
          <button
            onClick={onStartAuto}
            disabled={!settings.sourceId}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all disabled:opacity-50"
          >
            <PlayIcon className="size-4" />
            {t("autoCapture")}
          </button>
        ) : (
          <button
            onClick={onStopAuto}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all"
          >
            <SquareIcon className="size-4" />
            {t("autoStop")}
          </button>
        )}

        <button
          onClick={onToggleOverlay}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all",
            settings.overlayEnabled
              ? "border-accent/30 text-accent bg-accent/10"
              : "border-border-subtle text-text-secondary hover:text-text-primary hover:bg-overlay-4"
          )}
        >
          {settings.overlayEnabled ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
          {t("overlay")}
        </button>
      </div>

      {/* Region */}
      <div className="flex items-center gap-2">
        <button
          onClick={onSelectRegion}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all"
        >
          <CropIcon className="size-3.5" />
          {t("selectArea")}
        </button>
        {settings.region && (
          <>
            <span className="text-[11px] text-text-tertiary">
              {Math.round(settings.region.width)}x{Math.round(settings.region.height)}
            </span>
            <button onClick={onClearRegion} className="text-text-tertiary hover:text-red-400">
              <XIcon className="size-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Language: Source → Target */}
      <div>
        <label className="text-[11px] text-text-tertiary mb-1.5 block">{t("translationDirection")}</label>
        <div className="flex items-center gap-2">
          <select
            value={settings.language}
            onChange={(e) => onUpdateSettings({ language: e.target.value })}
            className="flex-1 bg-overlay-4 border border-border-subtle rounded-lg px-2.5 py-1.5 text-sm text-text-primary [&>option]:bg-[#1a1a2e] [&>option]:text-white"
          >
            <option value="auto">{t("autoDetect")}</option>
            <option value="ja">{t("japanese")}</option>
            <option value="en">{t("english")}</option>
            <option value="zh">{t("chineseSimplified")}</option>
            <option value="zh-tw">{t("chineseTraditional")}</option>
            <option value="ko">{t("korean")}</option>
          </select>
          <ArrowRightIcon className="size-4 text-text-tertiary shrink-0" />
          <select
            value={settings.targetLang}
            onChange={(e) => onUpdateSettings({ targetLang: e.target.value })}
            className="flex-1 bg-overlay-4 border border-border-subtle rounded-lg px-2.5 py-1.5 text-sm text-text-primary [&>option]:bg-[#1a1a2e] [&>option]:text-white"
          >
            <option value="ko">{t("korean")}</option>
            <option value="en">{t("english")}</option>
            <option value="ja">{t("japanese")}</option>
            <option value="zh">{t("chinese")}</option>
          </select>
        </div>
      </div>

      {/* Provider & Engine */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1 mb-1">
            <label className="text-[11px] text-text-tertiary">{t("translationProvider")}</label>
            {!licensed && (
              <span className="text-[10px] text-text-tertiary flex items-center gap-0.5">
                <LockIcon className="size-2.5" /> {t("aiLock")}
              </span>
            )}
          </div>
          <select
            value={settings.provider}
            onChange={(e) => {
              const val = e.target.value
              if (!licensed && val !== "offline" && val !== "test") return
              onUpdateSettings({ provider: val })
            }}
            className="w-full bg-overlay-4 border border-border-subtle rounded-lg px-2.5 py-1.5 text-sm text-text-primary [&>option]:bg-[#1a1a2e] [&>option]:text-white"
          >
            <option value="offline">{t("offlineNLLB")}</option>
            <option value="claude" disabled={!licensed}>
              {licensed ? "Claude" : t("claudeLicenseRequired")}
            </option>
            <option value="openai" disabled={!licensed}>
              {licensed ? "OpenAI" : "OpenAI (라이선스 필요)"}
            </option>
            <option value="gemini" disabled={!licensed}>
              {licensed ? "Gemini" : "Gemini (라이선스 필요)"}
            </option>
            <option value="test">{t("testEcho")}</option>
          </select>
        </div>

        <div>
          <label className="text-[11px] text-text-tertiary mb-1 block">{t("ocrEngine")}</label>
          <select
            value={settings.ocrEngine}
            onChange={(e) => onUpdateSettings({ ocrEngine: e.target.value as LiveSettings["ocrEngine"] })}
            className="w-full bg-overlay-4 border border-border-subtle rounded-lg px-2.5 py-1.5 text-sm text-text-primary [&>option]:bg-[#1a1a2e] [&>option]:text-white"
          >
            <option value="auto">{t("autoRecommended")}</option>
            <option value="winocr">Windows OCR</option>
          </select>
        </div>
      </div>

      {/* Advanced toggles */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-text-tertiary">{t("autoInterval")}</label>
          <select
            value={settings.autoIntervalMs}
            onChange={(e) => onUpdateSettings({ autoIntervalMs: Number(e.target.value) })}
            className="bg-overlay-4 border border-border-subtle rounded px-2 py-1 text-xs text-text-primary [&>option]:bg-[#1a1a2e] [&>option]:text-white"
          >
            <option value={1000}>{t("interval1s")}</option>
            <option value={2000}>{t("interval2s")}</option>
            <option value={3000}>{t("interval3s")}</option>
            <option value={5000}>{t("interval5s")}</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[11px] text-text-tertiary">{t("overlayOpacity")}</label>
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={settings.overlayOpacity}
            onChange={(e) => onUpdateSettings({ overlayOpacity: Number(e.target.value) })}
            className="w-20 h-1 accent-accent"
          />
          <span className="text-[11px] text-text-tertiary w-8">{settings.overlayOpacity}%</span>
        </div>
      </div>

      {/* Hotkey hints */}
      <div className="text-[11px] text-text-tertiary space-y-0.5">
        <p>Ctrl+Shift+T: {t("captureAndTranslate")}  |  Ctrl+Shift+O: {t("overlay")}  |  Ctrl+Shift+R: {t("selectArea")}</p>
      </div>
    </div>
  )
}
