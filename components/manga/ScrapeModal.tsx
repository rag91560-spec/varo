"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { XIcon, Loader2Icon, CheckCircleIcon, AlertCircleIcon, UploadIcon, ImageIcon, SearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FolderBrowser } from "@/components/FolderBrowser"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"

interface ScrapeModalProps {
  open: boolean
  onClose: () => void
  onComplete: () => void
}

type Tab = "upload" | "browse"

export function ScrapeModal({ open, onClose, onComplete }: ScrapeModalProps) {
  const [tab, setTab] = useState<Tab>("upload")

  useEffect(() => {
    if (!open) setTab("upload")
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface border border-border-subtle rounded-2xl w-full max-w-md mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab("upload")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                tab === "upload"
                  ? "bg-accent/10 text-accent"
                  : "text-text-tertiary hover:text-text-primary"
              )}
            >
              파일 업로드
            </button>
            <button
              onClick={() => setTab("browse")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                tab === "browse"
                  ? "bg-accent/10 text-accent"
                  : "text-text-tertiary hover:text-text-primary"
              )}
            >
              탐색
            </button>
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-colors">
            <XIcon className="size-5" />
          </button>
        </div>

        {/* Content */}
        {tab === "upload" ? (
          <UploadTab onClose={onClose} onComplete={onComplete} open={open} />
        ) : (
          <BrowseTab onClose={onClose} onComplete={onComplete} />
        )}
      </div>
    </div>
  )
}

// --- Upload Tab ---

function UploadTab({ onClose, onComplete, open }: { onClose: () => void; onComplete: () => void; open: boolean }) {
  const [title, setTitle] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setTitle("")
      setFiles([])
      setPreviews([])
      setUploading(false)
      setProgress(0)
      setError("")
    }
  }, [open])

  // Generate previews when files change
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [files])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files).sort((a, b) => a.name.localeCompare(b.name))
      setFiles(selected)
      setError("")
    }
  }, [])

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return
    if (!title.trim()) {
      setError("제목을 입력해주세요")
      return
    }
    setUploading(true)
    setError("")
    setProgress(0)

    try {
      await api.manga.upload(title.trim(), files)
      setProgress(100)
      setTimeout(() => {
        onComplete()
        onClose()
      }, 1000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "업로드 실패")
      setUploading(false)
    }
  }, [title, files, onComplete, onClose])

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  return (
    <div className="p-5 space-y-4">
      {/* Title input */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목..."
        className={cn(
          "w-full px-3 py-2.5 rounded-lg text-sm",
          "bg-surface-elevated border border-border-subtle",
          "text-text-primary placeholder:text-text-tertiary",
          "focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
        )}
        disabled={uploading}
      />

      {/* File selection */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {files.length === 0 ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "w-full py-8 rounded-lg border-2 border-dashed border-border-subtle",
            "flex flex-col items-center gap-2 text-text-tertiary",
            "hover:border-accent/50 hover:text-text-secondary transition-colors"
          )}
          disabled={uploading}
        >
          <UploadIcon className="size-8" />
          <span className="text-sm">이미지 파일 선택</span>
          <span className="text-xs">여러 파일 선택 가능</span>
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">
              <ImageIcon className="size-4 inline mr-1" />
              {files.length}장 선택됨
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-accent hover:underline"
              disabled={uploading}
            >
              다시 선택
            </button>
          </div>

          {/* Preview grid */}
          <div className="grid grid-cols-5 gap-1.5 max-h-48 overflow-y-auto">
            {previews.map((src, i) => (
              <div key={i} className="relative aspect-[3/4] rounded overflow-hidden group">
                <img src={src} alt={`Preview ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeFile(i)}
                  className="absolute top-0.5 right-0.5 size-4 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  disabled={uploading}
                >
                  <XIcon className="size-3" />
                </button>
                <span className="absolute bottom-0.5 left-0.5 text-[10px] text-white bg-black/50 px-1 rounded">
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-error">
          <AlertCircleIcon className="size-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Progress */}
      {uploading && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            {progress >= 100 ? (
              <>
                <CheckCircleIcon className="size-4 text-green-500" />
                <span className="text-green-500">완료!</span>
              </>
            ) : (
              <>
                <Loader2Icon className="size-4 animate-spin text-accent" />
                <span className="text-text-secondary">업로드 중...</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Upload button */}
      <Button
        onClick={handleUpload}
        loading={uploading}
        disabled={files.length === 0}
        className="w-full"
      >
        업로드 ({files.length}장)
      </Button>
    </div>
  )
}

// --- Browse Tab ---

function BrowseTab({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [selectedFolder, setSelectedFolder] = useState("")
  const [title, setTitle] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleAdd = async () => {
    if (!selectedFolder || !title.trim()) return
    setLoading(true)
    setError("")
    try {
      // Fetch image files in the selected folder via filesystem API
      const res = await api.filesystem.browse(selectedFolder, ".jpg,.jpeg,.png,.bmp,.webp")
      const imageFiles = res.entries.filter(e => e.type === "file")
      if (imageFiles.length === 0) {
        setError("이미지 파일이 없습니다")
        setLoading(false)
        return
      }
      // Fetch files from paths and upload
      const files: File[] = []
      for (const entry of imageFiles) {
        const resp = await fetch(`/api/filesystem/serve?path=${encodeURIComponent(entry.path)}`)
        if (resp.ok) {
          const blob = await resp.blob()
          files.push(new File([blob], entry.name, { type: blob.type }))
        }
      }
      if (files.length === 0) {
        setError("파일을 읽을 수 없습니다")
        setLoading(false)
        return
      }
      await api.manga.upload(title.trim(), files)
      onComplete()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "추가 실패")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-5 space-y-3">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목..."
        className={cn(
          "w-full px-3 py-2 rounded-lg text-sm",
          "bg-surface-elevated border border-border-subtle",
          "text-text-primary placeholder:text-text-tertiary",
          "focus:outline-none focus:border-accent/50"
        )}
      />
      <FolderBrowser
        filter=".jpg,.jpeg,.png,.bmp,.webp"
        foldersOnly
        onSelect={(path) => setSelectedFolder(path)}
        maxHeight="200px"
      />
      {selectedFolder && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs text-text-secondary truncate">{selectedFolder}</span>
          <Button size="sm" onClick={handleAdd} loading={loading} disabled={!title.trim()}>
            폴더에서 추가
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  )
}
