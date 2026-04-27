"use client"

import { useState, useRef, useEffect } from "react"
import { XIcon, FolderIcon, ChevronDownIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import type { MediaCategory } from "@/lib/types"
import { cn } from "@/lib/utils"

interface SelectionBarProps {
  selectedCount: number
  categories: MediaCategory[]
  onBulkMove: (categoryId: number | null) => void
  onDeselectAll: () => void
  onBulkTranslate?: () => void
  onBulkDelete?: () => void
}

export function SelectionBar({
  selectedCount,
  categories,
  onBulkMove,
  onDeselectAll,
  onBulkTranslate,
  onBulkDelete,
}: SelectionBarProps) {
  const { t } = useLocale()
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showDropdown) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showDropdown])

  if (selectedCount === 0) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-accent/10 border border-accent/20 rounded-lg">
      <span className="text-sm font-medium text-text-primary">
        {t("itemsSelected").replace("{count}", String(selectedCount))}
      </span>

      {/* Move to category dropdown */}
      <div className="relative" ref={dropdownRef}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setShowDropdown(!showDropdown)}
          className="gap-1.5"
        >
          <FolderIcon className="size-3.5" />
          {t("moveTo")}
          <ChevronDownIcon className="size-3.5" />
        </Button>

        {showDropdown && (
          <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] rounded-lg border border-border-subtle bg-surface shadow-xl py-1">
            <button
              onClick={() => { onBulkMove(null); setShowDropdown(false) }}
              className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-overlay-4 transition-colors"
            >
              {t("uncategorized")}
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => { onBulkMove(cat.id); setShowDropdown(false) }}
                className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-overlay-4 transition-colors"
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bulk translate button */}
      {onBulkTranslate && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onBulkTranslate}
          className="gap-1.5"
        >
          <SparklesIcon className="size-3.5" />
          {t("translate")}
        </Button>
      )}

      {/* Bulk delete */}
      {onBulkDelete && (
        <Button
          size="sm"
          variant="destructive"
          onClick={onBulkDelete}
          className="gap-1.5"
        >
          <Trash2Icon className="size-3.5" />
          {t("delete")}
        </Button>
      )}

      {/* Deselect all */}
      <button
        onClick={onDeselectAll}
        className="ml-auto flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary transition-colors"
      >
        <XIcon className="size-3.5" />
        {t("deselectAll")}
      </button>
    </div>
  )
}
