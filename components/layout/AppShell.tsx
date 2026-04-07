"use client"

import { useState, useCallback, type DragEvent } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Sidebar } from "./Sidebar"
import { AIChatSidebar } from "./AIChatSidebar"
import { AIChatToggle } from "./AIChatToggle"
import { UpdateBanner } from "@/components/UpdateBanner"
import { SyncWorker } from "@/components/SyncWorker"
import { AIChatProvider } from "@/hooks/use-ai-chat"

/** Routes that render without Sidebar/UpdateBanner (standalone windows) */
const BARE_ROUTES = ["/overlay", "/region-select"]

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".avi", ".webm", ".mov", ".srt", ".ass", ".vtt"])
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma", ".opus"])
const MANGA_EXTS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"])

function getExt(name: string): string {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i).toLowerCase() : ""
}

function getRouteForFile(file: File): string | null {
  const ext = getExt(file.name)
  // Check if it's a folder (webkitRelativePath or no extension in Electron)
  if ((file as any).path && !ext) return "/library"
  if (VIDEO_EXTS.has(ext)) return "/videos"
  if (AUDIO_EXTS.has(ext)) return "/audio"
  if (MANGA_EXTS.has(ext)) return "/manga"
  if (ext === ".txt") return "/library"
  return null
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isBare = BARE_ROUTES.some((r) => pathname.startsWith(r))
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = useCallback((e: DragEvent) => {
    // Only handle external file drops, not internal DnD
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault()
      e.stopPropagation()
      if (pathname !== "/library") {
        setDragOver(true)
      }
    }
  }, [pathname])

  const handleDragLeave = useCallback((e: DragEvent) => {
    // Only reset when leaving the container (not child elements)
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const firstFile = files[0]
    const route = getRouteForFile(firstFile)

    if (route && pathname !== route) {
      router.push(route)
    }
    // The individual page's own DnD handler will process the actual file
  }, [pathname, router])

  if (isBare) {
    return <>{children}</>
  }

  return (
    <AIChatProvider>
      <div
        className="flex min-h-screen w-full relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* DnD overlay */}
        {dragOver && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-accent/10 border-4 border-dashed border-accent rounded-xl pointer-events-none">
            <div className="px-8 py-4 rounded-xl bg-surface/90 backdrop-blur shadow-lg text-lg font-semibold text-accent">
              파일을 여기에 놓으세요
            </div>
          </div>
        )}
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <UpdateBanner />
          <SyncWorker />
          <main className="flex-1 min-w-0">{children}</main>
          <AIChatToggle />
        </div>
        <AIChatSidebar />
      </div>
    </AIChatProvider>
  )
}
