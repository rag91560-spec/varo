"use client"

import { useState, useEffect, useCallback, use } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, Maximize2Icon, Minimize2Icon, ExternalLinkIcon } from "lucide-react"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import { useGame } from "@/hooks/use-api"

export default function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const rawId = parseInt(id, 10)
  const gameId = isNaN(rawId) ? null : rawId
  const router = useRouter()
  const { t } = useLocale()
  const { game } = useGame(gameId!)
  const [serveUrl, setServeUrl] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [error, setError] = useState<string | null>(gameId === null ? "Invalid game ID" : null)

  useEffect(() => {
    if (gameId === null) return
    api.games.launch(gameId)
      .then((result) => {
        if (result.html_game && result.serve_url) {
          setServeUrl(result.serve_url)
        } else {
          setError("Not an HTML game")
        }
      })
      .catch((e) => setError(e.message))
  }, [gameId])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  const openInNewWindow = useCallback(() => {
    if (serveUrl) {
      window.open(serveUrl, "_blank", "width=1280,height=720")
    }
  }, [serveUrl])

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-text-secondary">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 rounded-lg bg-overlay-4 text-text-primary hover:bg-overlay-8 transition-colors"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="h-12 px-4 flex items-center gap-3 bg-surface border-b border-border shrink-0">
        <button
          onClick={() => router.back()}
          className="size-8 flex items-center justify-center rounded-md hover:bg-overlay-4 transition-colors"
        >
          <ArrowLeftIcon className="size-4 text-text-secondary" />
        </button>

        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {game?.title || "Loading..."}
        </span>

        <button
          onClick={openInNewWindow}
          className="size-8 flex items-center justify-center rounded-md hover:bg-overlay-4 transition-colors"
          title={t("playInSeparateWindow")}
        >
          <ExternalLinkIcon className="size-4 text-text-secondary" />
        </button>

        <button
          onClick={toggleFullscreen}
          className="size-8 flex items-center justify-center rounded-md hover:bg-overlay-4 transition-colors"
          title={isFullscreen ? t("exitFullscreen") : t("fullscreen")}
        >
          {isFullscreen ? (
            <Minimize2Icon className="size-4 text-text-secondary" />
          ) : (
            <Maximize2Icon className="size-4 text-text-secondary" />
          )}
        </button>
      </div>

      {/* Game iframe */}
      <div className="flex-1 bg-black">
        {serveUrl ? (
          <iframe
            src={serveUrl}
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin allow-popups"
            title={game?.title || "Game"}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="size-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}
