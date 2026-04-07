"use client"

import { XIcon } from "lucide-react"
import type { MangaTranslationEntry } from "@/lib/types"
import { cn } from "@/lib/utils"

interface TranslationPanelProps {
  entries: MangaTranslationEntry[]
  open: boolean
  onClose: () => void
}

export function TranslationPanel({ entries, open, onClose }: TranslationPanelProps) {
  return (
    <div
      className={cn(
        "fixed right-0 top-0 h-full w-80 bg-surface border-l border-border-subtle z-40",
        "transform transition-transform duration-300 shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <h3 className="text-sm font-semibold text-text-primary">번역 텍스트</h3>
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-all"
        >
          <XIcon className="size-3.5" />
          닫기
        </button>
      </div>

      <div className="overflow-y-auto h-[calc(100%-49px)] p-4 space-y-3">
        {entries.length === 0 ? (
          <p className="text-sm text-text-tertiary text-center py-8">
            번역 결과가 없습니다
          </p>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="space-y-1 pb-3 border-b border-border-subtle last:border-0">
              <p className="text-xs text-text-tertiary">{entry.original}</p>
              <p className="text-sm text-text-primary">{entry.translated}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
