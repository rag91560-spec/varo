"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import {
  PlayIcon,
  PauseIcon,
  Volume2Icon,
  VolumeXIcon,
  Volume1Icon,
  MaximizeIcon,
  MinimizeIcon,
  XIcon,
  SubtitlesIcon,
} from "lucide-react"
import type { VideoItem } from "@/lib/types"
import { api } from "@/lib/api"
import { useLocale } from "@/hooks/use-locale"
import { useSubtitles, useSubtitleSegments } from "@/hooks/use-subtitle-job"
import { SubtitleOverlay } from "@/components/subtitle/SubtitleOverlay"

interface StandaloneVideoPlayerProps {
  readonly video: VideoItem
  onClose?: () => void
  onOpenSubtitles?: () => void
}

function getYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/))([a-zA-Z0-9_-]{11})/
  )
  return match?.[1] ?? null
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  return `${m}:${s.toString().padStart(2, "0")}`
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

function useVideoPlayer(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(() => {
    try { return parseFloat(localStorage.getItem("vp-volume") || "1") } catch { return 1 }
  })
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(() => {
    try { return parseFloat(localStorage.getItem("vp-rate") || "1") } catch { return 1 }
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [seeking, setSeeking] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number>(0)

  // Sync time via rAF
  useEffect(() => {
    const update = () => {
      const v = videoRef.current
      if (v && !seeking) {
        setCurrentTime(v.currentTime)
        if (v.buffered.length > 0) {
          setBuffered(v.buffered.end(v.buffered.length - 1))
        }
      }
      rafRef.current = requestAnimationFrame(update)
    }
    rafRef.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(rafRef.current)
  }, [videoRef, seeking])

  // Video event listeners
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onDuration = () => setDuration(v.duration)
    const onEnded = () => { setPlaying(false); setControlsVisible(true) }
    v.addEventListener("play", onPlay)
    v.addEventListener("pause", onPause)
    v.addEventListener("durationchange", onDuration)
    v.addEventListener("ended", onEnded)
    // Apply saved settings
    v.volume = volume
    v.playbackRate = playbackRate
    return () => {
      v.removeEventListener("play", onPlay)
      v.removeEventListener("pause", onPause)
      v.removeEventListener("durationchange", onDuration)
      v.removeEventListener("ended", onEnded)
    }
  }, [videoRef]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fullscreen change listener
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false)
      }
    }, 3000)
  }, [videoRef])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [videoRef])

  const seek = useCallback((time: number) => {
    const v = videoRef.current
    if (v) {
      v.currentTime = Math.max(0, Math.min(time, v.duration || 0))
      setCurrentTime(v.currentTime)
    }
  }, [videoRef])

  const changeVolume = useCallback((val: number) => {
    const v = videoRef.current
    const clamped = Math.max(0, Math.min(1, val))
    setVolume(clamped)
    if (v) {
      v.volume = clamped
      if (clamped > 0) v.muted = false
      setMuted(v.muted)
    }
    try { localStorage.setItem("vp-volume", String(clamped)) } catch {}
  }, [videoRef])

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }, [videoRef])

  const changeRate = useCallback((rate: number) => {
    const v = videoRef.current
    if (v) v.playbackRate = rate
    setPlaybackRate(rate)
    try { localStorage.setItem("vp-rate", String(rate)) } catch {}
  }, [videoRef])

  return {
    playing, currentTime, duration, buffered, volume, muted,
    playbackRate, isFullscreen, controlsVisible, seeking, setSeeking,
    togglePlay, seek, changeVolume, toggleMute, changeRate,
    resetHideTimer, setControlsVisible,
  }
}

// ─── SeekBar ───
function SeekBar({
  currentTime, duration, buffered, onSeek, onSeekStart, onSeekEnd,
}: {
  currentTime: number; duration: number; buffered: number
  onSeek: (t: number) => void; onSeekStart: () => void; onSeekEnd: () => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hovering, setHovering] = useState(false)
  const [hoverX, setHoverX] = useState(0)
  const [dragging, setDragging] = useState(false)

  const progress = duration > 0 ? currentTime / duration : 0
  const bufferedPct = duration > 0 ? buffered / duration : 0
  const hoverTime = useMemo(() => {
    if (!trackRef.current || !duration) return 0
    const rect = trackRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(duration, (hoverX / rect.width) * duration))
  }, [hoverX, duration])

  const getTimeFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!trackRef.current || !duration) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    return ratio * duration
  }, [duration])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    onSeekStart()
    onSeek(getTimeFromEvent(e))

    const onMove = (ev: MouseEvent) => onSeek(getTimeFromEvent(ev))
    const onUp = (ev: MouseEvent) => {
      onSeek(getTimeFromEvent(ev))
      setDragging(false)
      onSeekEnd()
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [getTimeFromEvent, onSeek, onSeekStart, onSeekEnd])

  return (
    <div
      ref={trackRef}
      className="group relative w-full cursor-pointer select-none"
      style={{ height: 16, display: "flex", alignItems: "center" }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onMouseMove={(e) => {
        if (!trackRef.current) return
        const rect = trackRef.current.getBoundingClientRect()
        setHoverX(e.clientX - rect.left)
      }}
      onMouseDown={onMouseDown}
    >
      {/* Track background */}
      <div className={`absolute left-0 right-0 rounded-full transition-all duration-150 ${hovering || dragging ? "h-[5px]" : "h-[3px]"}`}
        style={{ background: "rgba(255,255,255,0.2)" }}
      >
        {/* Buffered */}
        <div className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${bufferedPct * 100}%`, background: "rgba(255,255,255,0.3)" }}
        />
        {/* Progress */}
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {/* Thumb */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-accent transition-all duration-150 ${hovering || dragging ? "w-3 h-3 opacity-100" : "w-0 h-0 opacity-0"}`}
        style={{ left: `${progress * 100}%` }}
      />
      {/* Hover tooltip */}
      {(hovering || dragging) && duration > 0 && (
        <div
          className="absolute -top-8 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/90 text-[11px] text-white whitespace-nowrap pointer-events-none"
          style={{ left: hoverX }}
        >
          {formatTime(hoverTime)}
        </div>
      )}
    </div>
  )
}

// ─── SpeedMenu ───
function SpeedMenu({ rate, onChange }: { rate: number; onChange: (r: number) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-1 text-xs text-white/80 hover:text-white rounded hover:bg-white/10 transition-colors font-medium"
      >
        {rate === 1 ? "1x" : `${rate}x`}
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 right-0 bg-black/95 rounded-lg border border-white/10 py-1 min-w-[72px] shadow-xl">
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              onClick={() => { onChange(r); setOpen(false) }}
              className={`block w-full text-left px-3 py-1.5 text-xs transition-colors ${
                r === rate ? "text-accent bg-white/10" : "text-white/80 hover:text-white hover:bg-white/5"
              }`}
            >
              {r}x
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── VolumeControl ───
function VolumeControl({
  volume, muted, onVolumeChange, onToggleMute,
}: {
  volume: number; muted: boolean; onVolumeChange: (v: number) => void; onToggleMute: () => void
}) {
  const [hovering, setHovering] = useState(false)
  const sliderRef = useRef<HTMLDivElement>(null)

  const effectiveVol = muted ? 0 : volume
  const VolumeIcon = muted || volume === 0 ? VolumeXIcon : volume < 0.5 ? Volume1Icon : Volume2Icon

  const handleSliderClick = useCallback((e: React.MouseEvent) => {
    if (!sliderRef.current) return
    const rect = sliderRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onVolumeChange(ratio)
  }, [onVolumeChange])

  return (
    <div
      className="flex items-center gap-1.5 group/vol"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button onClick={onToggleMute} className="p-1 text-white/80 hover:text-white transition-colors">
        <VolumeIcon className="size-4" />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${hovering ? "w-20 opacity-100" : "w-0 opacity-0"}`}
      >
        <div
          ref={sliderRef}
          className="relative h-4 flex items-center cursor-pointer"
          onClick={handleSliderClick}
          onMouseDown={(e) => {
            e.preventDefault()
            handleSliderClick(e)
            const onMove = (ev: MouseEvent) => {
              if (!sliderRef.current) return
              const rect = sliderRef.current.getBoundingClientRect()
              const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
              onVolumeChange(ratio)
            }
            const onUp = () => {
              window.removeEventListener("mousemove", onMove)
              window.removeEventListener("mouseup", onUp)
            }
            window.addEventListener("mousemove", onMove)
            window.addEventListener("mouseup", onUp)
          }}
        >
          <div className="absolute left-0 right-0 h-[3px] rounded-full bg-white/20">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/80"
              style={{ width: `${effectiveVol * 100}%` }}
            />
          </div>
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white"
            style={{ left: `${effectiveVol * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── CenterPlayFeedback ───
function CenterPlayFeedback({ playing }: { playing: boolean }) {
  const [show, setShow] = useState(false)
  const [icon, setIcon] = useState<"play" | "pause">("play")
  const prevPlaying = useRef(playing)

  useEffect(() => {
    if (prevPlaying.current !== playing) {
      setIcon(playing ? "play" : "pause")
      setShow(true)
      const timer = setTimeout(() => setShow(false), 500)
      prevPlaying.current = playing
      return () => clearTimeout(timer)
    }
  }, [playing])

  if (!show) return null
  const Icon = icon === "play" ? PlayIcon : PauseIcon

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="bg-black/50 rounded-full p-4 animate-ping-once">
        <Icon className="size-10 text-white" fill="white" />
      </div>
    </div>
  )
}

// ─── Main Component ───
export function StandaloneVideoPlayer({ video, onClose, onOpenSubtitles }: StandaloneVideoPlayerProps) {
  const { t } = useLocale()
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const player = useVideoPlayer(videoRef)

  // CC subtitle overlay
  const [ccEnabled, setCcEnabled] = useState(() => {
    try { return localStorage.getItem("vp-cc") !== "0" } catch { return true }
  })
  const { subtitles } = useSubtitles("video", video.type === "local" ? video.id : null)
  const translatedSub = useMemo(
    () => subtitles.find((s) => s.status === "translated") ?? null,
    [subtitles],
  )
  const { segments: ccSegments } = useSubtitleSegments(ccEnabled && translatedSub ? translatedSub.id : null)

  const toggleCC = useCallback(() => {
    setCcEnabled((prev) => {
      const next = !prev
      try { localStorage.setItem("vp-cc", next ? "1" : "0") } catch {}
      return next
    })
  }, [])

  const isYouTube = video.type === "url" && !!getYouTubeId(video.source)

  // Toggle fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {})
    } else {
      await containerRef.current.requestFullscreen().catch(() => {})
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    if (isYouTube) return
    const handler = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault()
          player.togglePlay()
          player.resetHideTimer()
          break
        case "ArrowLeft":
          e.preventDefault()
          player.seek(player.currentTime - 5)
          player.resetHideTimer()
          break
        case "ArrowRight":
          e.preventDefault()
          player.seek(player.currentTime + 5)
          player.resetHideTimer()
          break
        case "ArrowUp":
          e.preventDefault()
          player.changeVolume(player.volume + 0.1)
          player.resetHideTimer()
          break
        case "ArrowDown":
          e.preventDefault()
          player.changeVolume(player.volume - 0.1)
          player.resetHideTimer()
          break
        case "m":
          player.toggleMute()
          player.resetHideTimer()
          break
        case "f":
          toggleFullscreen()
          break
        case "Escape":
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {})
          } else {
            onClose?.()
          }
          break
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [isYouTube, player, toggleFullscreen, onClose])

  // YouTube fallback
  if (isYouTube) {
    const ytId = getYouTubeId(video.source)
    return (
      <div ref={containerRef} className="relative bg-black rounded-lg overflow-hidden w-full h-full flex flex-col">
        {/* Title overlay */}
        <div className="absolute top-0 left-0 right-0 z-20 p-4 bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex items-center justify-between">
            <h2 className="text-white text-sm font-medium truncate pr-4">{video.title}</h2>
            {onClose && (
              <button onClick={onClose} className="text-white/70 hover:text-white transition-colors shrink-0">
                <XIcon className="size-5" />
              </button>
            )}
          </div>
        </div>
        <iframe
          key={video.id}
          src={`https://www.youtube.com/embed/${ytId}?autoplay=1`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="w-full flex-1"
        />
      </div>
    )
  }

  const videoSrc = video.type === "local" ? api.videos.serveUrl(video.id) : video.source

  return (
    <div
      ref={containerRef}
      className="relative bg-black rounded-lg overflow-hidden w-full h-full select-none"
      onMouseMove={player.resetHideTimer}
      onMouseLeave={() => {
        if (player.playing) player.setControlsVisible(false)
      }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        key={video.id}
        src={videoSrc}
        autoPlay
        className="w-full h-full object-contain"
        onClick={player.togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {/* CC subtitle overlay */}
      {ccEnabled && ccSegments.length > 0 && (
        <SubtitleOverlay
          segments={ccSegments}
          currentTime={player.currentTime}
          displayMode="translated"
        />
      )}

      {/* Center play/pause feedback */}
      <CenterPlayFeedback playing={player.playing} />

      {/* Title overlay (top) */}
      <div
        className={`absolute top-0 left-0 right-0 z-20 p-4 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300 ${
          player.controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-white text-sm font-medium truncate pr-4">{video.title}</h2>
          {onClose && (
            <button onClick={onClose} className="text-white/70 hover:text-white transition-colors shrink-0">
              <XIcon className="size-5" />
            </button>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-300 ${
          player.controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Seek bar */}
        <div className="px-4">
          <SeekBar
            currentTime={player.currentTime}
            duration={player.duration}
            buffered={player.buffered}
            onSeek={player.seek}
            onSeekStart={() => player.setSeeking(true)}
            onSeekEnd={() => player.setSeeking(false)}
          />
        </div>

        {/* Control row */}
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          {/* Left controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={player.togglePlay}
              className="p-1 text-white/90 hover:text-white transition-colors"
              title={player.playing ? t("videoPlayerPause") : t("videoPlayerPlay")}
            >
              {player.playing ? (
                <PauseIcon className="size-5" fill="white" />
              ) : (
                <PlayIcon className="size-5" fill="white" />
              )}
            </button>

            <VolumeControl
              volume={player.volume}
              muted={player.muted}
              onVolumeChange={player.changeVolume}
              onToggleMute={player.toggleMute}
            />

            <span className="text-xs text-white/70 ml-1 tabular-nums">
              {formatTime(player.currentTime)} / {formatTime(player.duration)}
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1">
            <SpeedMenu rate={player.playbackRate} onChange={player.changeRate} />

            {/* CC toggle */}
            {video.type === "local" && (
              <button
                onClick={toggleCC}
                className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition-colors ${
                  ccEnabled
                    ? "text-white bg-white/20 border-b-2 border-accent"
                    : "text-white/50 hover:text-white/80"
                }`}
                title="CC"
              >
                CC
              </button>
            )}

            {onOpenSubtitles && video.type === "local" && (
              <button
                onClick={onOpenSubtitles}
                className="p-1.5 text-white/70 hover:text-white transition-colors"
                title={t("videoPlayerSubtitles")}
              >
                <SubtitlesIcon className="size-4" />
              </button>
            )}

            <button
              onClick={toggleFullscreen}
              className="p-1.5 text-white/70 hover:text-white transition-colors"
              title={player.isFullscreen ? t("videoPlayerExitFullscreen") : t("videoPlayerFullscreen")}
            >
              {player.isFullscreen ? (
                <MinimizeIcon className="size-4" />
              ) : (
                <MaximizeIcon className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Click-to-play overlay when paused and controls hidden (initial state) */}
      {!player.playing && player.currentTime === 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer z-10"
          onClick={player.togglePlay}
        >
          <div className="bg-black/40 rounded-full p-5">
            <PlayIcon className="size-12 text-white" fill="white" />
          </div>
        </div>
      )}
    </div>
  )
}
