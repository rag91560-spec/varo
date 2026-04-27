"use client"

import { FolderIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDropTarget } from "@/hooks/use-media-dnd"
import { useLocale } from "@/hooks/use-locale"

interface FolderCardProps {
  id: number
  name: string
  itemCount?: number
  childFolderCount?: number
  onOpen: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onDropItem?: (itemId: number) => void
}

export function FolderCard({
  name,
  itemCount,
  childFolderCount,
  onOpen,
  onContextMenu,
  onDropItem,
}: FolderCardProps) {
  const { t } = useLocale()
  const drop = useDropTarget((payload) => {
    if (!onDropItem) return
    onDropItem(payload.id)
  })

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-lg border bg-surface transition-all cursor-pointer overflow-hidden select-none",
        drop.isOver
          ? "border-accent ring-2 ring-accent/50 scale-[1.02]"
          : "border-border-subtle hover:border-accent hover:shadow-md",
      )}
      onDoubleClick={onOpen}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      onDragOver={onDropItem ? drop.onDragOver : undefined}
      onDragLeave={onDropItem ? drop.onDragLeave : undefined}
      onDrop={onDropItem ? drop.onDrop : undefined}
    >
      <div
        className={cn(
          "aspect-square flex items-center justify-center transition-colors",
          drop.isOver
            ? "bg-gradient-to-br from-accent/30 to-accent/10"
            : "bg-gradient-to-br from-accent/10 to-accent/5",
        )}
      >
        <FolderIcon
          className={cn(
            "size-16 transition-colors",
            drop.isOver ? "text-accent" : "text-accent/70 group-hover:text-accent",
          )}
        />
      </div>
      <div className="p-2.5 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate" title={name}>
          {name}
        </div>
        <div className="text-xs text-text-tertiary flex items-center gap-1.5 mt-0.5">
          {childFolderCount !== undefined && childFolderCount > 0 && (
            <span>📁 {childFolderCount}</span>
          )}
          {itemCount !== undefined && itemCount > 0 && (
            <span>📄 {itemCount}</span>
          )}
          {(childFolderCount ?? 0) === 0 && (itemCount ?? 0) === 0 && (
            <span>{t("empty")}</span>
          )}
        </div>
      </div>
    </div>
  )
}
