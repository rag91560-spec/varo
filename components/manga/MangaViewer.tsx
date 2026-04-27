"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ZoomInIcon,
  ZoomOutIcon,
  LanguagesIcon,
  Loader2Icon,
  ArrowLeftIcon,
  MaximizeIcon,
  MinimizeIcon,
  GripVerticalIcon,
  PaintbrushIcon,
  XIcon,
  CheckIcon,
  SquareDashedIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Paywall } from "@/components/ui/paywall"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { DetectorType, RenderConfig, MangaTranslationEntry } from "@/lib/types"
import { useLocale } from "@/hooks/use-locale"
import { useMangaTranslation } from "@/hooks/use-manga"
import { useLicenseStatus } from "@/hooks/use-api"
import { TranslationOverlay } from "./TranslationOverlay"
import { TranslationPanel } from "./TranslationPanel"
import { ImageManager } from "./ImageManager"
import { RenderedViewer } from "./RenderedViewer"
import { RenderSettings } from "./RenderSettings"
import { RegionEditor } from "./RegionEditor"

interface MangaViewerProps {
  mangaId: number
  pageCount: number
  initialPage?: number
  onBack: () => void
  onUpdate?: () => void
}

type ViewMode = "scroll" | "page" | "webtoon"
type TranslationMode = "off" | "overlay" | "panel" | "rendered"

const DEFAULT_CONFIG: Partial<RenderConfig> = {
  inpaint_mode: "telea",
  font_id: "nanummyeongjo",
  auto_color: true,
  outline_enabled: true,
  outline_width: 2,
  direction: "auto",
}

export function MangaViewer({ mangaId, pageCount, initialPage = 1, onBack, onUpdate }: MangaViewerProps) {
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [zoom, setZoom] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>("scroll")
  const [translationMode, setTranslationMode] = useState<TranslationMode>("off")
  const [fullscreen, setFullscreen] = useState(false)
  const [imgDimensions, setImgDimensions] = useState({ width: 0, height: 0 })
  const [imageManagerOpen, setImageManagerOpen] = useState(false)
  const [renderSettingsOpen, setRenderSettingsOpen] = useState(false)
  const [renderKey, setRenderKey] = useState(0)
  const [hasRendered, setHasRendered] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState("")
  const [detector, setDetector] = useState<DetectorType>("gemini")
  const [config, setConfig] = useState<Partial<RenderConfig>>(DEFAULT_CONFIG)
  const [editingRegions, setEditingRegions] = useState(false)
  const [editedPositions, setEditedPositions] = useState<MangaTranslationEntry[] | null>(null)
  const [savingRegions, setSavingRegions] = useState(false)
  const [showPaywall, setShowPaywall] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const { t } = useLocale()
  const { license, refresh: refreshLicense } = useLicenseStatus()
  const { translation, loading: translating, translate } = useMangaTranslation(mangaId, currentPage)

  // Reset render state when page changes, then check server for existing render
  useEffect(() => {
    setHasRendered(false)
    setRenderError("")
    setEditingRegions(false)
    setEditedPositions(null)
    setTranslationMode("off")

    // Check if this page was already rendered on server
    api.manga.renderStatus(mangaId).then((status) => {
      if (status.pages?.[currentPage]?.rendered) {
        setHasRendered(true)
        setRenderKey((k) => k + 1)
      }
    }).catch(() => {})
  }, [currentPage, mangaId])

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (viewMode !== "page") return
        setCurrentPage((p) => Math.max(1, p - 1))
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        if (viewMode !== "page") return
        e.preventDefault()
        setCurrentPage((p) => Math.min(pageCount, p + 1))
      } else if (e.key === "Escape") {
        if (renderSettingsOpen) { setRenderSettingsOpen(false); return }
        if (translationMode !== "off") { setTranslationMode("off"); return }
        if (fullscreen) setFullscreen(false)
        else onBack()
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [viewMode, pageCount, fullscreen, onBack, renderSettingsOpen, translationMode])

  // Scroll mode: track current page from scroll position
  useEffect(() => {
    if ((viewMode !== "scroll" && viewMode !== "webtoon") || !scrollContainerRef.current) return
    const container = scrollContainerRef.current

    function handleScroll() {
      const children = container.querySelectorAll("[data-page]")
      let closest = 1
      let minDist = Infinity
      children.forEach((child) => {
        const rect = child.getBoundingClientRect()
        const dist = Math.abs(rect.top - container.getBoundingClientRect().top)
        if (dist < minDist) {
          minDist = dist
          closest = parseInt(child.getAttribute("data-page") || "1")
        }
      })
      setCurrentPage(closest)
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [viewMode])

  // Main action: translate + render in one click
  const handleTranslate = useCallback(async () => {
    // Already rendered → toggle result view
    if (hasRendered) {
      setTranslationMode((m) => m === "rendered" ? "off" : "rendered")
      return
    }

    if (!license.valid) {
      setShowPaywall(true)
      return
    }

    setRenderError("")

    try {
      // Step 1: Translate (if not done yet)
      if (!translation) {
        await translate(undefined, detector)
      }

      // Step 2: Render (inpaint + composite)
      setRendering(true)
      await api.manga.renderPage(mangaId, currentPage, config as RenderConfig)
      setRenderKey((k) => k + 1)
      setHasRendered(true)
      setTranslationMode("rendered")
      // Switch to page mode so rendered result is visible
      setViewMode("page")
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("403")) {
        setShowPaywall(true)
        setTranslationMode("off")
      } else {
        setRenderError(e instanceof Error ? e.message : t("translationFailed"))
      }
    } finally {
      setRendering(false)
    }
  }, [hasRendered, translation, translate, license.valid, detector, mangaId, currentPage, config, t])

  const handleSaveRegions = useCallback(async () => {
    if (!editedPositions) return
    setSavingRegions(true)
    try {
      await api.manga.updatePositions(mangaId, currentPage, editedPositions)
      setEditingRegions(false)
      setHasRendered(false) // require re-render with new regions
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : t("saveFailed"))
    } finally {
      setSavingRegions(false)
    }
  }, [editedPositions, mangaId, currentPage, t])

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setImgDimensions({ width: img.naturalWidth, height: img.naturalHeight })
  }, [])

  const isLoading = translating || rendering
  const btnLabel = isLoading
    ? (translating ? t("translating") : t("compositing"))
    : hasRendered
      ? (translationMode === "rendered" ? t("hideResult") : t("showResult"))
      : t("translateAndApply")

  return (
    <div ref={containerRef} className={cn("flex flex-col h-full bg-black", fullscreen && "fixed inset-0 z-50")}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface/95 backdrop-blur-sm border-b border-border-subtle shrink-0 z-10">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
          </Button>
          <span className="text-sm text-text-secondary">
            {currentPage} / {pageCount}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* View mode toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode(viewMode === "page" ? "scroll" : viewMode === "scroll" ? "webtoon" : "page")}
            className="text-xs"
          >
            {viewMode === "page" ? t("pageMode") : viewMode === "scroll" ? t("scrollMode") : t("webtoonMode")}
          </Button>

          {/* Zoom */}
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            <ZoomOutIcon className="size-4" />
          </Button>
          <span className="text-xs text-text-secondary w-10 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            <ZoomInIcon className="size-4" />
          </Button>

          <div className="w-px h-5 bg-border-subtle mx-1" />

          {/* Primary: Translate & Apply */}
          <Button
            variant={hasRendered && translationMode === "rendered" ? "accent" : hasRendered ? "secondary" : "default"}
            size="sm"
            onClick={handleTranslate}
            disabled={isLoading}
            className="gap-1.5 text-xs font-medium"
          >
            {isLoading
              ? <Loader2Icon className="size-3.5 animate-spin" />
              : hasRendered
                ? <CheckIcon className="size-3.5" />
                : <LanguagesIcon className="size-3.5" />}
            {btnLabel}
          </Button>

          {/* Secondary mode tabs — only for advanced viewing after translation */}
          {translation && !isLoading && (
            <div className="flex items-center rounded-md border border-border overflow-hidden">
              {([
                { mode: "overlay" as TranslationMode, label: t("overlay"), title: t("overlayModeDesc") },
                { mode: "panel" as TranslationMode, label: t("panelMode"), title: t("panelModeDesc") },
              ]).map(({ mode, label, title }, i) => (
                <button
                  key={mode}
                  onClick={() => setTranslationMode(translationMode === mode ? "off" : mode)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium transition-all",
                    i > 0 && "border-l border-border",
                    translationMode === mode
                      ? "bg-accent text-white"
                      : "bg-surface text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                  )}
                  title={title}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="w-px h-5 bg-border-subtle mx-1" />

          {/* Region Editor toggle */}
          {translation && (
            editingRegions ? (
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  setEditingRegions(false)
                  setHasRendered(false) // need re-render with new regions
                }}
                className="gap-1.5 text-xs"
              >
                <CheckIcon className="size-3.5" />
                {t("completed")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditedPositions(translation.positions.map(p => ({ ...p })))
                  setEditingRegions(true)
                  setTranslationMode("off")
                  setViewMode("page")
                }}
                className="gap-1.5 text-xs"
                title={t("dragToSpecifyArea")}
              >
                <SquareDashedIcon className="size-3.5" />
                {t("specifyArea")}
              </Button>
            )
          )}

          {/* Render Settings (advanced) */}
          <Button
            variant={renderSettingsOpen ? "accent" : "ghost"}
            size="sm"
            onClick={() => setRenderSettingsOpen(!renderSettingsOpen)}
            className="gap-1.5 text-xs"
            title={t("reRenderAfterSettings")}
          >
            <PaintbrushIcon className="size-3.5" />
            {t("mangaRenderSettings")}
          </Button>

          {/* Image Manager */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setImageManagerOpen(true)}
            title={t("manageImagesDesc")}
          >
            <GripVerticalIcon className="size-4" />
          </Button>

          {/* Fullscreen */}
          <Button variant="ghost" size="icon" onClick={() => setFullscreen(!fullscreen)} title={t("fullscreen")}>
            {fullscreen ? <MinimizeIcon className="size-4" /> : <MaximizeIcon className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Error bar */}
      {renderError && (
        <div className="flex items-center justify-between px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive shrink-0">
          <span>{renderError}</span>
          <button onClick={() => setRenderError("")} className="hover:opacity-70">
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

      {/* Progress bar while loading */}
      {isLoading && (
        <div className="shrink-0 h-0.5 bg-border-subtle overflow-hidden">
          <div className="h-full bg-accent animate-pulse w-full" />
        </div>
      )}

      {/* Content */}
      {viewMode === "page" ? (
        /* Page mode */
        <div className="flex-1 flex items-center justify-center relative overflow-hidden">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="absolute left-2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white disabled:opacity-30 transition-all"
          >
            <ChevronLeftIcon className="size-6" />
          </button>

          {translationMode === "rendered" ? (
            <div className="max-h-[calc(100vh-60px)] overflow-auto">
              <RenderedViewer
                mangaId={mangaId}
                page={currentPage}
                originalUrl={api.manga.imageUrl(mangaId, currentPage)}
                renderedUrl={`${api.manga.renderedImageUrl(mangaId, currentPage)}?v=${renderKey}`}
              />
            </div>
          ) : (
            <div className="relative" style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}>
              <img
                src={api.manga.imageUrl(mangaId, currentPage)}
                alt={`Page ${currentPage}`}
                className="max-h-[calc(100vh-60px)] max-w-full object-contain"
                draggable={false}
                onLoad={handleImgLoad}
              />
              {editingRegions && editedPositions && (
                <RegionEditor
                  mangaId={mangaId}
                  page={currentPage}
                  entries={editedPositions}
                  onChange={setEditedPositions}
                />
              )}
              {!editingRegions && translationMode === "overlay" && translation && (
                <>
                  <TranslationOverlay
                    entries={translation.positions}
                    imageWidth={imgDimensions.width}
                    imageHeight={imgDimensions.height}
                  />
                  <button
                    onClick={() => setTranslationMode("off")}
                    className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 hover:bg-black/80 text-white text-xs transition-all backdrop-blur-sm"
                  >
                    <XIcon className="size-3.5" />
                    {t("hideOverlay")}
                  </button>
                </>
              )}
            </div>
          )}

          <button
            onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
            disabled={currentPage >= pageCount}
            className="absolute right-2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white disabled:opacity-30 transition-all"
          >
            <ChevronRightIcon className="size-6" />
          </button>
        </div>
      ) : (
        /* Scroll / Webtoon mode */
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          <div
            className={cn(
              "flex flex-col items-center",
              viewMode === "webtoon" ? "gap-0 max-w-[720px] mx-auto" : "py-4 gap-1"
            )}
            style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
          >
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
              <div key={page} data-page={page} className={cn("relative w-full", viewMode !== "webtoon" && "max-w-3xl")}>
                <img
                  src={translationMode === "rendered" && page === currentPage
                    ? `${api.manga.renderedImageUrl(mangaId, page)}?v=${renderKey}`
                    : api.manga.imageUrl(mangaId, page)}
                  alt={`Page ${page}`}
                  className="w-full block"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Thumbnail strip (page mode) */}
      {viewMode === "page" && pageCount <= 100 && (
        <div className="flex gap-1 px-2 py-1.5 bg-surface/95 backdrop-blur-sm border-t border-border-subtle overflow-x-auto shrink-0">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              className={cn(
                "shrink-0 w-10 h-14 rounded overflow-hidden border-2 transition-all",
                page === currentPage ? "border-accent" : "border-transparent opacity-60 hover:opacity-100"
              )}
            >
              <img
                src={api.manga.imageUrl(mangaId, page)}
                alt={`Thumb ${page}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* Translation panel */}
      {translation && (
        <TranslationPanel
          entries={translation.positions}
          open={translationMode === "panel"}
          onClose={() => setTranslationMode("off")}
        />
      )}

      {/* Render Settings Panel */}
      {renderSettingsOpen && (
        <div className="fixed right-0 top-0 bottom-0 w-80 z-[55] bg-surface border-l border-border-subtle shadow-xl overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
            <span className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <PaintbrushIcon className="size-4" />
              {t("mangaRenderSettings")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenderSettingsOpen(false)}
              className="gap-1.5 text-xs text-text-secondary hover:text-text-primary"
            >
              <XIcon className="size-3.5" />
              {t("close")}
            </Button>
          </div>
          <RenderSettings
            mangaId={mangaId}
            currentPage={currentPage}
            totalPages={pageCount}
            detector={detector}
            onDetectorChange={setDetector}
            config={config}
            onConfigChange={setConfig}
            onRenderComplete={() => {
              setRenderKey((k) => k + 1)
              setHasRendered(true)
              setTranslationMode("rendered")
            }}
          />
        </div>
      )}

      {/* Image Manager */}
      <ImageManager
        mangaId={mangaId}
        pageCount={pageCount}
        open={imageManagerOpen}
        onClose={() => setImageManagerOpen(false)}
        onUpdate={() => onUpdate?.()}
      />

      {/* License Paywall */}
      {showPaywall && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowPaywall(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <Paywall
              show={true}
              dismissable={true}
              onDismiss={() => setShowPaywall(false)}
              onLicenseVerified={() => { refreshLicense(); setShowPaywall(false) }}
            >
              <div className="w-80 h-40" />
            </Paywall>
          </div>
        </div>
      )}
    </div>
  )
}
