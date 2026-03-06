"use client"

import {
  ArrowLeftIcon,
  ImageIcon,
  GamepadIcon,
  CheckCircleIcon,
  SaveIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import type { Game } from "@/lib/types"

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

interface GameHeroBannerProps {
  game: Game
  statusText: string
  statusColor: string
  editing: boolean
  editTitle: string
  editExe: string
  onEditTitle: (v: string) => void
  onEditExe: (v: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onBack: () => void
  onOpenCoverSearch: () => void
}

export function GameHeroBanner({
  game,
  statusText,
  statusColor,
  editing,
  editTitle,
  editExe,
  onEditTitle,
  onEditExe,
  onSaveEdit,
  onCancelEdit,
  onBack,
  onOpenCoverSearch,
}: GameHeroBannerProps) {
  const { t } = useLocale()
  const hasCover = !!game.cover_path

  return (
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

      {/* Gradient overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, transparent 0%, transparent 40%, rgba(12,12,15,0.6) 70%, rgba(12,12,15,0.95) 100%)",
        }}
      />

      {/* Top Nav */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
        <NavButton onClick={onBack}>
          <ArrowLeftIcon className="size-5 text-white" />
        </NavButton>
        <NavButton onClick={onOpenCoverSearch}>
          <ImageIcon className="size-5 text-white" />
        </NavButton>
      </div>

      {/* Title (bottom-left) */}
      <div className="absolute left-6 right-6 bottom-6 z-10">
        <span
          className="inline-flex items-center gap-1 px-3 py-1 rounded-[8px] text-white text-[10px] font-semibold mb-3"
          style={{ background: statusColor }}
        >
          {game.status === "applied" && <CheckCircleIcon className="size-3" />}
          {statusText}
        </span>
        {editing ? (
          <div className="space-y-2 max-w-lg">
            <input
              value={editTitle}
              onChange={(e) => onEditTitle(e.target.value)}
              className="w-full h-12 px-4 rounded-lg border border-white/10 bg-black/30 backdrop-blur-sm text-white text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <input
              value={editExe}
              onChange={(e) => onEditExe(e.target.value)}
              placeholder={t("exePathPlaceholder")}
              className="w-full h-10 px-4 rounded-lg border border-white/10 bg-black/30 backdrop-blur-sm text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            <div className="flex gap-2">
              <Button variant="accent" size="sm" onClick={onSaveEdit}>
                <SaveIcon className="size-3.5" /> {t("save")}
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancelEdit} className="text-white/80 hover:text-white">
                {t("cancel")}
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
  )
}
