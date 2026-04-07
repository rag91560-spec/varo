"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { SendIcon } from "lucide-react"
import type { AgentMessage } from "@/lib/types"
import type { AgentStatus } from "@/hooks/use-agent"
import { AgentLogEntry } from "./AgentLogEntry"
import { useLocale } from "@/hooks/use-locale"

interface Props {
  messages: AgentMessage[]
  status: AgentStatus
  turns: number
  maxTurns: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  model: string
  onSendMessage?: (text: string) => void
}

export function AgentPanel({
  messages,
  status,
  turns,
  maxTurns,
  inputTokens,
  outputTokens,
  costUsd,
  model,
  onSendMessage,
}: Props) {
  const { t } = useLocale()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [inputText, setInputText] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [messages])

  // Focus input when waiting
  useEffect(() => {
    if (status === "waiting" && inputRef.current) {
      inputRef.current.focus()
    }
  }, [status])

  const handleSend = useCallback(() => {
    if (!inputText.trim() || !onSendMessage) return
    onSendMessage(inputText.trim())
    setInputText("")
  }, [inputText, onSendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const isActive = status === "running" || status === "waiting"

  return (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/50 border-b border-border text-xs text-muted-foreground shrink-0">
        {model && <span className="font-mono">{model.replace("claude-", "").replace(/-\d+$/, "")}</span>}
        <span>{t("aiAgentTurns")}: {turns}/{maxTurns}</span>
        <span>{t("aiAgentTokens")}: {(inputTokens + outputTokens).toLocaleString()}</span>
        <span>{t("aiAgentCost")}: ${costUsd.toFixed(4)}</span>
        {status === "running" && (
          <span className="ml-auto flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {t("aiAgentRunning")}
          </span>
        )}
        {status === "waiting" && (
          <span className="ml-auto flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            입력 대기 중
          </span>
        )}
      </div>

      {/* Log area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-sm bg-[#0d1117] min-h-0"
      >
        {messages.length === 0 && status === "idle" ? (
          <div className="text-muted-foreground text-center py-8">
            {t("aiAgentDesc")}
          </div>
        ) : (
          messages.map((msg, i) => (
            <AgentLogEntry key={i} message={msg} />
          ))
        )}
      </div>

      {/* Chat input — shown when agent is active */}
      {isActive && onSendMessage && (
        <div className="shrink-0 border-t border-border bg-muted/30 p-2">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={status === "waiting" ? "메시지를 입력하세요..." : "AI가 작업 중..."}
              rows={1}
              className="flex-1 px-3 py-1.5 text-sm bg-[#0d1117] border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/50"
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="px-3 py-1.5 bg-accent text-white rounded-md hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <SendIcon className="w-4 h-4" />
            </button>
          </div>
          {status === "waiting" && (
            <p className="text-[11px] text-yellow-400/70 mt-1">
              AI가 응답을 기다리고 있습니다. 추가 지시나 Enter로 계속 진행하세요.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
