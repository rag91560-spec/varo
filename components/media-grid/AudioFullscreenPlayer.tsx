"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import {
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
  MusicIcon,
  UploadIcon,
  PencilIcon,
  Trash2Icon,
  FileTextIcon,
  LanguagesIcon,
  LoaderIcon,
  SparklesIcon,
} from "lucide-react"
import type { AudioItem } from "@/lib/types"
import { api } from "@/lib/api"
import { useLocale } from "@/hooks/use-locale"
import { cn } from "@/lib/utils"
import { parseScript } from "@/lib/script-parser"
import { ScriptDisplay } from "./ScriptDisplay"

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

interface AudioFullscreenPlayerProps {
  track: AudioItem
  playlist: AudioItem[]
  onTrackChange: (item: AudioItem) => void
  onClose: () => void
  onTrackUpdate: (item: AudioItem) => void
}

export function AudioFullscreenPlayer({
  track,
  playlist,
  onTrackChange,
  onClose,
  onTrackUpdate,
}: AudioFullscreenPlayerProps) {
  const { t } = useLocale()
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [scriptMode, setScriptMode] = useState<"none" | "upload" | "edit">("none")
  const [editText, setEditText] = useState("")
  const [translating, setTranslating] = useState(false)
  const [translations, setTranslations] = useState<string[] | null>(null)
  const [autoCaptioning, setAutoCaptioning] = useState(false)
  const [autoCaptionProgress, setAutoCaptionProgress] = useState(0)
  const [autoCaptionMsg, setAutoCaptionMsg] = useState("")
  const autoCaptionEsRef = useRef<EventSource | null>(null)

  const currentIndex = playlist.findIndex((a) => a.id === track.id)
  const scriptData = useMemo(
    () => (track.script_text ? parseScript(track.script_text) : null),
    [track.script_text],
  )

  // Restore translations from saved data
  useEffect(() => {
    if (track.translated_script) {
      try {
        setTranslations(JSON.parse(track.translated_script))
      } catch {
        setTranslations(null)
      }
    } else {
      setTranslations(null)
    }
  }, [track.id, track.translated_script])

  // Play track
  useEffect(() => {
    if (!audioRef.current) return
    const src = track.type === "local" ? api.audio.serveUrl(track.id) : track.source
    audioRef.current.src = src
    audioRef.current.volume = volume
    audioRef.current.muted = muted
    audioRef.current.play().then(() => setPlaying(true)).catch(() => {})
  }, [track.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const play = useCallback(() => { audioRef.current?.play(); setPlaying(true) }, [])
  const pause = useCallback(() => { audioRef.current?.pause(); setPlaying(false) }, [])

  const prev = useCallback(() => {
    if (currentIndex > 0) onTrackChange(playlist[currentIndex - 1])
  }, [currentIndex, playlist, onTrackChange])

  const next = useCallback(() => {
    if (currentIndex < playlist.length - 1) onTrackChange(playlist[currentIndex + 1])
  }, [currentIndex, playlist, onTrackChange])

  const handleEnded = useCallback(() => {
    if (currentIndex < playlist.length - 1) next()
    else setPlaying(false)
  }, [currentIndex, playlist.length, next])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (audioRef.current) { audioRef.current.currentTime = time; setCurrentTime(time) }
  }, [])

  const seekTo = useCallback((time: number) => {
    if (audioRef.current) { audioRef.current.currentTime = time; setCurrentTime(time) }
  }, [])

  const handleVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (audioRef.current) audioRef.current.volume = v
    if (v > 0) setMuted(false)
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      if (audioRef.current) audioRef.current.muted = !m
      return !m
    })
  }, [])

  // Script upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const updated = await api.audio.uploadScript(track.id, file)
      onTrackUpdate(updated)
      setScriptMode("none")
    } catch {}
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleSaveScript = async () => {
    try {
      const updated = await api.audio.updateScript(track.id, editText)
      onTrackUpdate(updated)
      setScriptMode("none")
    } catch {}
  }

  const handleRemoveScript = async () => {
    try {
      const updated = await api.audio.updateScript(track.id, "")
      onTrackUpdate(updated)
    } catch {}
  }

  const handleTranslateScript = async () => {
    setTranslating(true)
    try {
      const result = await api.audio.translateScript(track.id)
      setTranslations(result.translated)
      onTrackUpdate(result.item)
    } catch {}
    setTranslating(false)
  }

  const handleAutoCaption = async () => {
    setAutoCaptioning(true)
    setAutoCaptionProgress(0)
    setAutoCaptionMsg(t("starting"))
    try {
      const { job_id } = await api.audio.autoCaption(track.id, { source_lang: "ja", target_lang: "ko" })
      const es = new EventSource(api.audio.autoCaptionStatusUrl(job_id))
      autoCaptionEsRef.current = es
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.event === "progress") {
            setAutoCaptionProgress(msg.data?.progress ?? 0)
            setAutoCaptionMsg(msg.data?.message ?? "")
          } else if (msg.event === "complete") {
            es.close()
            autoCaptionEsRef.current = null
            setAutoCaptioning(false)
            if (msg.data?.item) onTrackUpdate(msg.data.item)
          } else if (msg.event === "error") {
            es.close()
            autoCaptionEsRef.current = null
            setAutoCaptioning(false)
            setAutoCaptionMsg(msg.data?.error ?? t("errorOccurred"))
          }
        } catch {}
      }
      es.onerror = () => {
        es.close()
        autoCaptionEsRef.current = null
        setAutoCaptioning(false)
      }
    } catch {
      setAutoCaptioning(false)
    }
  }

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => { autoCaptionEsRef.current?.close() }
  }, [])

  const thumbnailUrl = track.thumbnail || null

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl flex flex-col">
      <audio
        ref={audioRef}
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
        onEnded={handleEnded}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".srt,.vtt,.txt"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Header */}
      <div className="flex items-center justify-start p-4">
        <button
          onClick={onClose}
          className="size-10 flex items-center justify-center rounded-full hover:bg-overlay-6 text-text-secondary hover:text-text-primary transition-colors"
        >
          <XIcon className="size-5" />
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center min-h-0 px-6">
        {/* Thumbnail */}
        <div className="relative mb-4">
          {thumbnailUrl && (
            <div
              className="absolute inset-0 scale-150 blur-3xl opacity-20 rounded-full"
              style={{ backgroundImage: `url(${thumbnailUrl})`, backgroundSize: "cover" }}
            />
          )}
          <div className="relative size-40 rounded-2xl bg-overlay-6 flex items-center justify-center overflow-hidden shadow-xl">
            {thumbnailUrl ? (
              <img src={thumbnailUrl} alt="" className="size-full object-cover" />
            ) : (
              <MusicIcon className="size-12 text-text-tertiary" />
            )}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-text-primary text-center mb-4 max-w-md truncate">
          {track.title}
        </h2>

        {/* Script area */}
        <div className="flex-1 w-full max-w-2xl min-h-0 flex flex-col rounded-xl border border-border-subtle bg-surface/50 mb-4 overflow-hidden">
          {scriptData ? (
            <>
              {/* Script header with edit/delete */}
              <div className="flex items-center justify-end gap-1 px-3 py-1.5 border-b border-border-subtle">
                <button
                  onClick={handleTranslateScript}
                  disabled={translating}
                  className={cn(
                    "size-7 flex items-center justify-center rounded transition-colors",
                    translations ? "text-accent hover:text-accent/80" : "text-text-tertiary hover:text-text-primary",
                    translating && "animate-pulse",
                  )}
                  title={translating ? t("translatingScript") : translations ? t("retranslateScript") : t("translateScript")}
                >
                  {translating ? <LoaderIcon className="size-3.5 animate-spin" /> : <LanguagesIcon className="size-3.5" />}
                </button>
                <button
                  onClick={() => { setEditText(track.script_text || ""); setScriptMode("edit") }}
                  className="size-7 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"
                  title={t("editScript")}
                >
                  <PencilIcon className="size-3.5" />
                </button>
                <button
                  onClick={handleRemoveScript}
                  className="size-7 flex items-center justify-center rounded text-text-tertiary hover:text-status-error transition-colors"
                  title={t("removeScript")}
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </div>
              {scriptMode === "edit" ? (
                <div className="flex-1 flex flex-col p-3 gap-2 min-h-0">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="flex-1 w-full bg-transparent text-text-primary text-sm font-mono resize-none outline-none min-h-0"
                    placeholder={t("scriptPlaceholder")}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setScriptMode("none")}
                      className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-md transition-colors"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      onClick={handleSaveScript}
                      className="px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:brightness-110 transition-all"
                    >
                      {t("save")}
                    </button>
                  </div>
                </div>
              ) : (
                <ScriptDisplay
                  script={scriptData}
                  currentTime={currentTime}
                  onSeek={seekTo}
                  translations={translations ?? undefined}
                />
              )}
            </>
          ) : scriptMode === "edit" ? (
            <div className="flex-1 flex flex-col p-3 gap-2 min-h-0">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="flex-1 w-full bg-transparent text-text-primary text-sm font-mono resize-none outline-none min-h-0"
                placeholder={t("scriptPlaceholder")}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setScriptMode("none")}
                  className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-md transition-colors"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={handleSaveScript}
                  className="px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:brightness-110 transition-all"
                >
                  {t("save")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
              {autoCaptioning ? (
                <>
                  <LoaderIcon className="size-8 text-accent animate-spin" />
                  <p className="text-sm text-text-secondary">{autoCaptionMsg || t("generatingAiLyrics")}</p>
                  <div className="w-full max-w-xs bg-overlay-6 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-300 rounded-full"
                      style={{ width: `${autoCaptionProgress}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-text-tertiary">{autoCaptionProgress}%</span>
                </>
              ) : (
                <>
                  <FileTextIcon className="size-10 text-text-tertiary opacity-40" />
                  <p className="text-sm text-text-tertiary">{t("noScript")}</p>
                  <button
                    onClick={handleAutoCaption}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm bg-accent text-white rounded-xl hover:brightness-110 transition-all active:scale-95 shadow-md"
                  >
                    <SparklesIcon className="size-4" />
                    {t("generateAiLyrics")}
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-overlay-6 text-text-secondary hover:text-text-primary rounded-lg transition-colors"
                    >
                      <UploadIcon className="size-3.5" />
                      {t("uploadScriptFile")}
                    </button>
                    <button
                      onClick={() => { setEditText(""); setScriptMode("edit") }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-overlay-6 text-text-secondary hover:text-text-primary rounded-lg transition-colors"
                    >
                      <PencilIcon className="size-3.5" />
                      {t("pasteScript")}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Player controls */}
      <div className="px-6 pb-6 max-w-2xl mx-auto w-full">
        {/* Seek bar */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[11px] text-text-tertiary font-mono w-10 text-right">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 h-1 accent-accent cursor-pointer"
          />
          <span className="text-[11px] text-text-tertiary font-mono w-10">
            {formatTime(duration)}
          </span>
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={prev}
            disabled={currentIndex <= 0}
            className="size-10 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors"
          >
            <SkipBackIcon className="size-5" />
          </button>
          <button
            onClick={playing ? pause : play}
            className="size-14 flex items-center justify-center rounded-full bg-accent text-white hover:brightness-110 transition-all active:scale-95 shadow-lg"
          >
            {playing
              ? <PauseIcon className="size-6 fill-white" />
              : <PlayIcon className="size-6 fill-white ml-0.5" />
            }
          </button>
          <button
            onClick={next}
            disabled={currentIndex >= playlist.length - 1}
            className="size-10 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors"
          >
            <SkipForwardIcon className="size-5" />
          </button>
        </div>

        {/* Volume */}
        <div className="flex items-center justify-center gap-2 mt-3">
          <button onClick={toggleMute} className="text-text-tertiary hover:text-text-primary transition-colors">
            {muted || volume === 0
              ? <VolumeXIcon className="size-4" />
              : <Volume2Icon className="size-4" />
            }
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={handleVolume}
            className="w-28 h-1 accent-accent cursor-pointer"
          />
        </div>
      </div>
    </div>
  )
}
