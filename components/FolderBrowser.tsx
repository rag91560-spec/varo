"use client"

import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ChevronLeftIcon,
  ChevronUpIcon,
  FolderIcon,
  FileIcon,
  HardDriveIcon,
  FolderOpenIcon,
} from "lucide-react"

type FSEntry = {
  name: string
  path: string
  type: "drive" | "folder" | "file"
  size: number | null
  modified: string | null
}

interface FolderBrowserProps {
  /** File extension filter e.g. ".mp4,.mkv" */
  filter?: string
  /** Show only folders */
  foldersOnly?: boolean
  /** Callback when a file or folder is selected (single click) */
  onSelect?: (path: string, type: "drive" | "folder" | "file") => void
  /** Callback when a file is double-clicked */
  onDoubleClick?: (path: string) => void
  /** Initial path to navigate to */
  initialPath?: string
  /** Max height of the file list */
  maxHeight?: string
  /** CSS class */
  className?: string
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatDate(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function FolderBrowser({
  filter,
  foldersOnly = false,
  onSelect,
  onDoubleClick,
  initialPath = "",
  maxHeight = "280px",
  className,
}: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const [pathInput, setPathInput] = useState(initialPath)
  const [entries, setEntries] = useState<FSEntry[]>([])
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const navigate = useCallback(
    async (path: string, pushHistory = true) => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.filesystem.browse(path, filter, foldersOnly)
        if (pushHistory && currentPath !== path && currentPath !== "") {
          setHistory((h) => [...h, currentPath])
        }
        setCurrentPath(res.path)
        setPathInput(res.path)
        setParentPath(res.parent)
        setEntries(res.entries)
        setSelected(null)
        if (res.error) setError(res.error)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    },
    [currentPath, filter, foldersOnly]
  )

  // Initial load
  useEffect(() => {
    navigate(initialPath, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Allow external path updates
  useEffect(() => {
    if (initialPath && initialPath !== currentPath) {
      navigate(initialPath, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath])

  const goBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1]
      setHistory((h) => h.slice(0, -1))
      navigate(prev, false)
    }
  }

  const goUp = () => {
    if (parentPath != null) {
      navigate(parentPath)
    }
  }

  const handleEntryClick = (entry: FSEntry) => {
    setSelected(entry.path)
    if (entry.type === "file" && onSelect) {
      onSelect(entry.path, "file")
    } else if (entry.type === "folder" && foldersOnly && onSelect) {
      onSelect(entry.path, "folder")
    }
  }

  const handleEntryDoubleClick = (entry: FSEntry) => {
    if (entry.type === "drive" || entry.type === "folder") {
      navigate(entry.path)
      if (foldersOnly && onSelect) {
        onSelect(entry.path, "folder")
      }
    } else if (entry.type === "file") {
      if (onDoubleClick) onDoubleClick(entry.path)
      else if (onSelect) onSelect(entry.path, "file")
    }
  }

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pathInput.trim()) {
      navigate(pathInput.trim())
    }
  }

  const handleBrowseDialog = async () => {
    const p = await window.electronAPI?.selectGameFolder()
    if (p) {
      navigate(p)
      if (onSelect) onSelect(p, "folder")
    }
  }

  const entryIcon = (type: string) => {
    switch (type) {
      case "drive":
        return <HardDriveIcon className="size-4 text-text-secondary" />
      case "folder":
        return <FolderIcon className="size-4 text-accent" />
      default:
        return <FileIcon className="size-4 text-text-tertiary" />
    }
  }

  return (
    <div className={cn("rounded-lg border border-border-subtle bg-surface", className)}>
      {/* Navigation bar */}
      <div className="flex items-center gap-1 border-b border-border-subtle px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={goBack}
          disabled={history.length === 0}
          title="뒤로"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={goUp}
          disabled={parentPath == null}
          title="상위 폴더"
        >
          <ChevronUpIcon className="size-4" />
        </Button>

        <form onSubmit={handlePathSubmit} className="flex flex-1 gap-1">
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="경로를 입력하세요..."
            className="flex-1 rounded-md border border-border-subtle bg-background px-2 py-1 text-sm text-text-primary outline-none focus:border-accent"
          />
        </form>

        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleBrowseDialog}
          title="폴더 찾아보기"
        >
          <FolderOpenIcon className="size-4" />
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-1.5 text-xs text-error">{error}</div>
      )}

      {/* File list */}
      <div className="overflow-auto" style={{ maxHeight }}>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-text-secondary">
            불러오는 중...
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-text-tertiary">
            {error ? "접근할 수 없습니다" : "빈 폴더"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface-elevated text-left text-xs text-text-secondary">
              <tr>
                <th className="px-3 py-1.5 font-medium">이름</th>
                <th className="px-3 py-1.5 font-medium w-20">유형</th>
                <th className="px-3 py-1.5 font-medium w-20 text-right">크기</th>
                <th className="hidden sm:table-cell px-3 py-1.5 font-medium w-36">수정일</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.path}
                  className={cn(
                    "cursor-pointer border-t border-border-subtle transition-colors hover:bg-surface-elevated",
                    selected === entry.path && "bg-accent/10"
                  )}
                  onClick={() => handleEntryClick(entry)}
                  onDoubleClick={() => handleEntryDoubleClick(entry)}
                >
                  <td className="flex items-center gap-2 px-3 py-1.5 truncate">
                    {entryIcon(entry.type)}
                    <span className="truncate">{entry.name}</span>
                  </td>
                  <td className="px-3 py-1.5 text-text-tertiary">
                    {entry.type === "drive"
                      ? "드라이브"
                      : entry.type === "folder"
                        ? "폴더"
                        : entry.name.split(".").pop()?.toUpperCase() || "파일"}
                  </td>
                  <td className="px-3 py-1.5 text-right text-text-tertiary">
                    {formatSize(entry.size)}
                  </td>
                  <td className="hidden sm:table-cell px-3 py-1.5 text-text-tertiary">
                    {formatDate(entry.modified)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/**
 * Navigate FolderBrowser programmatically by updating initialPath.
 * Useful for DnD integration — pass dropped folder path as initialPath.
 */
export type { FolderBrowserProps }
