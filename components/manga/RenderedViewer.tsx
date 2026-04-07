"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { EyeIcon, EyeOffIcon, DownloadIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"

interface RenderedViewerProps {
  mangaId: number
  page: number
  originalUrl: string
  renderedUrl: string
}

export function RenderedViewer({ mangaId, page, originalUrl, renderedUrl }: RenderedViewerProps) {
  const [mode, setMode] = useState<"slider" | "toggle">("slider")
  const [sliderPos, setSliderPos] = useState(20)
  const [showOriginal, setShowOriginal] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(containerRef.current)
    setContainerWidth(containerRef.current.offsetWidth)
    return () => observer.disconnect()
  }, [])

  const handleMouseDown = useCallback(() => {
    dragging.current = true
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    setSliderPos(Math.max(0, Math.min(100, x)))
  }, [])

  const handleMouseUp = useCallback(() => {
    dragging.current = false
  }, [])

  const handleDownload = async () => {
    try {
      const res = await fetch(renderedUrl)
      const blob = await res.blob()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `rendered_${mangaId}_p${page}.webp`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {}
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 p-0.5 rounded-md bg-overlay-4">
          <button
            onClick={() => setMode("slider")}
            className={`px-2 py-1 text-xs rounded ${mode === "slider" ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary"}`}
          >
            Slider
          </button>
          <button
            onClick={() => setMode("toggle")}
            className={`px-2 py-1 text-xs rounded ${mode === "toggle" ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary"}`}
          >
            Toggle
          </button>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="p-1 text-text-tertiary hover:text-text-primary">
            <ZoomOutIcon className="size-4" />
          </button>
          <span className="text-xs text-text-secondary w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="p-1 text-text-tertiary hover:text-text-primary">
            <ZoomInIcon className="size-4" />
          </button>
          <Button variant="ghost" size="sm" onClick={handleDownload}>
            <DownloadIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Image viewer */}
      <div className="relative overflow-auto rounded-lg border border-border bg-black/20" style={{ maxHeight: "70vh" }}>
        <div
          ref={containerRef}
          className="relative select-none"
          style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {mode === "slider" ? (
            <>
              {/* Rendered (full) */}
              <img src={renderedUrl} alt="Rendered" className="w-full" draggable={false} />
              {/* Original (clipped) */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${sliderPos}%`, height: '100%' }}
              >
                <img
                  src={originalUrl}
                  alt="Original"
                  draggable={false}
                  style={{ width: containerWidth > 0 ? `${containerWidth}px` : '100%', maxWidth: 'none', display: 'block' }}
                />
              </div>
              {/* Slider line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-accent cursor-col-resize z-10"
                style={{ left: `${sliderPos}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-accent flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">&#8596;</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <img
                src={showOriginal ? originalUrl : renderedUrl}
                alt={showOriginal ? "Original" : "Rendered"}
                className="w-full transition-opacity duration-300"
                draggable={false}
              />
              <button
                onClick={() => setShowOriginal(!showOriginal)}
                className="absolute bottom-3 right-3 px-3 py-1.5 rounded-full bg-black/60 text-white text-xs flex items-center gap-1.5 hover:bg-black/80"
              >
                {showOriginal ? <EyeIcon className="size-3.5" /> : <EyeOffIcon className="size-3.5" />}
                {showOriginal ? "Original" : "Rendered"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
