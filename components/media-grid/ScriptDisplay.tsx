"use client"

import { useRef, useEffect, useMemo } from "react"
import type { ScriptData, ScriptCue } from "@/lib/script-parser"
import { cn } from "@/lib/utils"

interface ScriptDisplayProps {
  script: ScriptData
  currentTime?: number
  onSeek?: (time: number) => void
  translations?: string[]
}

export function ScriptDisplay({ script, currentTime = 0, onSeek, translations }: ScriptDisplayProps) {
  const activeRef = useRef<HTMLDivElement>(null)

  const activeCueIndex = useMemo(() => {
    if (script.type !== "timed") return -1
    for (let i = script.cues.length - 1; i >= 0; i--) {
      if (currentTime >= script.cues[i].startTime) return i
    }
    return -1
  }, [script, currentTime])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [activeCueIndex])

  if (script.type === "timed") {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-0.5">
        {script.cues.map((cue, i) => {
          const isActive = i === activeCueIndex
          const isPast = i < activeCueIndex
          // Distance from active cue (for proximity-based opacity)
          const distance = activeCueIndex >= 0 ? Math.abs(i - activeCueIndex) : 999
          const nearOpacity = distance <= 2 ? 0.7 : distance <= 4 ? 0.4 : 0.25
          return (
            <div
              key={cue.index}
              ref={isActive ? activeRef : undefined}
              className={cn(
                "px-4 rounded-lg transition-all duration-500 ease-out",
                isActive
                  ? "py-4 border-l-3 border-accent bg-accent/8 scale-100"
                  : "py-2 border-l-3 border-transparent",
                onSeek && "cursor-pointer hover:bg-overlay-4",
              )}
              onClick={() => onSeek?.(cue.startTime)}
            >
              <p
                className="whitespace-pre-wrap transition-all duration-500 ease-out"
                style={isActive ? undefined : { opacity: isPast ? nearOpacity * 0.7 : nearOpacity }}
              >
                <span className={cn(
                  isActive
                    ? "text-text-primary text-xl font-semibold leading-relaxed"
                    : isPast
                      ? "text-text-tertiary text-base"
                      : "text-text-secondary text-base",
                )}>
                  {cue.text}
                </span>
              </p>
              {translations?.[i] && (
                <p
                  className={cn(
                    "whitespace-pre-wrap transition-all duration-500 mt-1",
                    isActive
                      ? "text-accent text-base font-medium"
                      : "text-accent/50 text-sm",
                  )}
                  style={isActive ? undefined : { opacity: isPast ? nearOpacity * 0.7 : nearOpacity }}
                >
                  {translations[i]}
                </p>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Plain text mode — build translation index mapping (skip empty lines)
  let transIdx = 0
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      {script.lines.map((line, i) => {
        const trans = line.trim() ? translations?.[transIdx++] : undefined
        return (
          <div key={i} className="py-0.5">
            <p className="text-text-secondary text-base leading-relaxed">
              {line || "\u00A0"}
            </p>
            {trans && (
              <p className="text-accent/80 text-sm leading-relaxed">
                {trans}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
