"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import {
  XIcon,
  SendIcon,
  SettingsIcon,
  PlayIcon,
  SquareIcon,
  BrainCircuitIcon,
  RotateCcwIcon,
} from "lucide-react"
import { useAIChat } from "@/hooks/use-ai-chat"
import { useGame } from "@/hooks/use-api"
import { useLocale } from "@/hooks/use-locale"
import { AgentLogEntry } from "@/components/game-detail/AgentLogEntry"
import { cn } from "@/lib/utils"

export function AIChatSidebar() {
  const { t } = useLocale()
  const {
    open,
    setOpen,
    gameId,
    agent,
    availableProviders,
    hasAnyKey,
    selectedProviderId,
    setSelectedProviderId,
    selectedModel,
    setSelectedModel,
    maxTurns,
    setMaxTurns,
    startAgent,
    cancelAgent,
    sendMessage,
  } = useAIChat()

  const { game } = useGame(gameId ?? 0)
  const [inputText, setInputText] = useState("")
  const [showConfig, setShowConfig] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isActive = agent.status === "running" || agent.status === "waiting"
  const isDone = agent.status === "completed" || agent.status === "error" || agent.status === "cancelled"
  const isIdle = agent.status === "idle"

  const currentProvider = availableProviders.find((p) => p.provider.id === selectedProviderId)

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      if (isNearBottom) el.scrollTop = el.scrollHeight
    }
  }, [agent.messages])

  // Focus input when waiting
  useEffect(() => {
    if (agent.status === "waiting" && inputRef.current) {
      inputRef.current.focus()
    }
  }, [agent.status])

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (!text) return

    if (isIdle || isDone) {
      if (!hasAnyKey || !gameId) return
      setInputText("")
      // Start agent — instructions will be the user's text
      const ap = availableProviders.find((p) => p.provider.id === selectedProviderId)
      if (!ap) return
      const providerName = selectedProviderId === "claude_api" ? "claude" : selectedProviderId
      agent.start(ap.apiKey, selectedModel, maxTurns, text, providerName)
      return
    }

    if (isActive) {
      sendMessage(text)
      setInputText("")
    }
  }, [inputText, isIdle, isDone, isActive, hasAnyKey, gameId, availableProviders, selectedProviderId, selectedModel, maxTurns, agent, sendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  if (!open) return null

  // Short model display name
  const modelShort = selectedModel
    .replace("claude-", "")
    .replace("gemini-", "")
    .replace(/-\d{8,}$/, "")

  return (
    <div className="flex flex-col h-screen w-[380px] shrink-0 sticky top-0 border-l border-border-subtle bg-sidebar-bg">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 h-14 shrink-0 border-b border-border-subtle">
        <BrainCircuitIcon className="size-4 text-purple-400" />
        <span className="text-sm font-semibold text-text-primary flex-1">AI Chat</span>

        {isActive && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {agent.status === "waiting" ? "대기 중" : t("aiAgentRunning")}
          </span>
        )}

        <button
          onClick={() => setShowConfig((v) => !v)}
          className="size-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors"
          title="Settings"
        >
          <SettingsIcon className="size-3.5" />
        </button>
        <button
          onClick={() => setOpen(false)}
          className="size-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      {/* Game context bar */}
      {gameId && game ? (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-overlay-2 border-b border-border-subtle text-xs text-text-secondary shrink-0">
          <span className="truncate">{game.title}</span>
          {game.engine && game.engine !== "unknown" && (
            <span className="text-text-tertiary">({game.engine})</span>
          )}
          {(!game.engine || game.engine === "unknown") && (
            <span className="text-purple-400 text-[10px] px-1 py-0.5 rounded bg-purple-500/15">미감지</span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-overlay-2 border-b border-border-subtle text-xs text-text-tertiary shrink-0">
          게임을 선택하면 AI가 해당 게임을 분석합니다
        </div>
      )}

      {/* Config panel (collapsible) */}
      {showConfig && (
        <div className="shrink-0 border-b border-border-subtle p-3 space-y-2 bg-overlay-2/50">
          {/* Provider selector */}
          <div>
            <label className="text-[11px] font-medium text-text-tertiary">AI 프로바이더</label>
            {availableProviders.length === 0 ? (
              <p className="text-[11px] text-yellow-500 mt-0.5">
                설정에서 API 키를 먼저 등록하세요
              </p>
            ) : (
              <select
                value={selectedProviderId}
                onChange={(e) => setSelectedProviderId(e.target.value)}
                className="w-full mt-0.5 px-2 py-1 text-xs bg-overlay-4 border border-border-subtle rounded focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {availableProviders.map((ap) => (
                  <option key={ap.provider.id} value={ap.provider.id}>
                    {ap.provider.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Model + Turns */}
          {currentProvider && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[11px] font-medium text-text-tertiary">{t("aiAgentModel")}</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full mt-0.5 px-2 py-1 text-xs bg-overlay-4 border border-border-subtle rounded focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {currentProvider.provider.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="w-16">
                <label className="text-[11px] font-medium text-text-tertiary">{t("aiAgentTurns")}</label>
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(Number(e.target.value))}
                  className="w-full mt-0.5 px-2 py-1 text-xs bg-overlay-4 border border-border-subtle rounded focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
          )}

          {/* API key hint */}
          {currentProvider && (
            <p className="text-[10px] text-text-tertiary">
              {currentProvider.provider.name} 키 등록됨 ({currentProvider.apiKey.slice(0, 8)}...)
            </p>
          )}
        </div>
      )}

      {/* Stats bar */}
      {(isActive || isDone) && (
        <div className="flex items-center gap-2 px-3 py-1 bg-overlay-2/30 border-b border-border-subtle text-[11px] text-text-tertiary shrink-0">
          <span className="font-mono">{agent.model.replace("claude-", "").replace("gemini-", "").replace(/-\d{8,}$/, "")}</span>
          <span>{agent.turns}/{agent.maxTurns}T</span>
          <span>{(agent.inputTokens + agent.outputTokens).toLocaleString()}tok</span>
          <span>${agent.costUsd.toFixed(4)}</span>
          <div className="ml-auto flex items-center gap-1">
            {isActive && (
              <button
                onClick={cancelAgent}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                title={t("aiAgentCancel")}
              >
                <SquareIcon className="size-3" />
              </button>
            )}
            {isDone && (
              <button
                onClick={agent.reset}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-text-secondary hover:bg-overlay-4 transition-colors"
                title="Reset"
              >
                <RotateCcwIcon className="size-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Chat/Log area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-sm bg-[#0d1117] min-h-0"
      >
        {agent.messages.length === 0 && isIdle ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <BrainCircuitIcon className="size-8 text-purple-400/30" />
            <p className="text-text-tertiary text-xs max-w-[260px]">
              {gameId
                ? t("aiAgentDesc")
                : "게임 상세 페이지에서 AI 분석을 시작할 수 있습니다"}
            </p>
            {!hasAnyKey && (
              <p className="text-yellow-500/70 text-[11px]">{t("aiAgentNoKey")}</p>
            )}
            {hasAnyKey && availableProviders.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-center">
                {availableProviders.map((ap) => (
                  <span key={ap.provider.id} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                    {ap.provider.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          agent.messages.map((msg, i) => (
            <AgentLogEntry key={i} message={msg} />
          ))
        )}
      </div>

      {/* Bottom input area */}
      <div className="shrink-0 border-t border-border-subtle bg-overlay-2/30 p-2">
        {agent.status === "waiting" && (
          <p className="text-[10px] text-yellow-400/70 mb-1 px-1">
            AI가 응답을 기다리고 있습니다
          </p>
        )}

        <div className="flex gap-1.5">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !gameId
                ? "게임을 먼저 선택하세요"
                : !hasAnyKey
                  ? "API 키를 설정에서 등록하세요"
                  : isActive
                    ? agent.status === "waiting"
                      ? "메시지를 입력하세요..."
                      : "AI가 작업 중..."
                    : "분석할 내용을 입력하세요..."
            }
            disabled={!gameId || !hasAnyKey || (!isIdle && !isActive && !isDone)}
            rows={1}
            className="flex-1 px-2.5 py-1.5 text-xs bg-[#0d1117] border border-border-subtle rounded-md focus:outline-none focus:ring-1 focus:ring-accent resize-none placeholder:text-text-tertiary/50 disabled:opacity-40"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || !gameId || !hasAnyKey || (!isIdle && !isActive && !isDone)}
            className="px-2.5 py-1.5 bg-accent text-white rounded-md hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {isIdle || isDone ? (
              <PlayIcon className="size-3.5" />
            ) : (
              <SendIcon className="size-3.5" />
            )}
          </button>
        </div>

        {/* Bottom bar: provider + model */}
        <div className="flex items-center gap-2 mt-1.5 px-1 text-[10px] text-text-tertiary">
          {currentProvider && (
            <span className="font-mono">{currentProvider.provider.name} · {modelShort}</span>
          )}
          {isDone && agent.status === "completed" && (
            <span className="text-emerald-400 ml-auto">{t("aiAgentComplete")}</span>
          )}
          {isDone && agent.status === "error" && (
            <span className="text-red-400 truncate ml-auto">{agent.errorMessage}</span>
          )}
        </div>
      </div>
    </div>
  )
}
