"use client"

import { useState, useCallback, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, PlayIcon, SquareIcon, Loader2Icon, BrainCircuitIcon } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"
import { useGame, useSettings } from "@/hooks/use-api"
import { useAgent } from "@/hooks/use-agent"
import { AgentPanel } from "@/components/game-detail/AgentPanel"

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params)
  const gameId = Number(rawId)
  const router = useRouter()
  const { t } = useLocale()
  const { game, loading: gameLoading } = useGame(gameId)
  const { settings } = useSettings()

  // API key from settings
  const savedApiKey = (() => {
    if (!settings.api_keys) return ""
    if (typeof settings.api_keys === "string") {
      try {
        const parsed = JSON.parse(settings.api_keys)
        return parsed.claude || parsed.anthropic || ""
      } catch {
        return ""
      }
    }
    return settings.api_keys.claude || settings.api_keys.anthropic || ""
  })()

  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("claude-sonnet-4-20250514")
  const [maxTurns, setMaxTurns] = useState(20)
  const [instructions, setInstructions] = useState("")

  useEffect(() => {
    if (savedApiKey && !apiKey) setApiKey(savedApiKey)
  }, [savedApiKey, apiKey])

  const agent = useAgent(gameId)

  const handleStart = useCallback(() => {
    if (!apiKey.trim()) return
    agent.start(apiKey.trim(), model, maxTurns, instructions)
  }, [apiKey, model, maxTurns, instructions, agent])

  const handleCancel = useCallback(() => {
    agent.cancel()
  }, [agent])

  const handleSendMessage = useCallback((text: string) => {
    agent.sendMessage(text)
  }, [agent])

  if (gameLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2Icon className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!game) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p>{t("gameNotFound")}</p>
        <Button variant="ghost" onClick={() => router.push("/library")}>
          {t("backToLibrary")}
        </Button>
      </div>
    )
  }

  const isActive = agent.status === "running" || agent.status === "waiting"
  const isDone = agent.status === "completed" || agent.status === "error" || agent.status === "cancelled"

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <Link href={`/library/${gameId}`}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeftIcon className="w-4 h-4" />
          </Button>
        </Link>
        <BrainCircuitIcon className="w-5 h-5 text-purple-400" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold truncate">{game.title} — {t("aiAgent")}</h1>
        </div>

        {/* Action buttons */}
        {isActive && (
          <Button variant="destructive" size="sm" onClick={handleCancel} className="gap-1 shrink-0">
            <SquareIcon className="w-3.5 h-3.5" />
            {t("aiAgentCancel")}
          </Button>
        )}
        {isDone && (
          <Button variant="secondary" size="sm" onClick={agent.reset} className="gap-1 shrink-0">
            <PlayIcon className="w-3.5 h-3.5" />
            {t("aiAgentStart")}
          </Button>
        )}
        {isDone && agent.status === "completed" && (
          <span className="text-xs text-emerald-400">{t("aiAgentComplete")}</span>
        )}
        {isDone && agent.status === "error" && (
          <span className="text-xs text-red-400 truncate max-w-48">{agent.errorMessage}</span>
        )}
      </div>

      {/* Config (only when idle) */}
      {!isActive && !isDone && (
        <div className="shrink-0 border-b border-border">
          <div className="p-4 space-y-3 max-w-2xl">
            {/* API Key */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("aiAgentApiKey")}</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="w-full mt-1 px-3 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {savedApiKey && (
                <p className="text-[11px] text-muted-foreground mt-0.5">{t("aiAgentApiKeyHint")}</p>
              )}
            </div>

            {/* Model + Turns */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground">{t("aiAgentModel")}</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full mt-1 px-3 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                  <option value="claude-haiku-4-20250414">Claude Haiku 4</option>
                  <option value="claude-opus-4-20250514">Claude Opus 4</option>
                </select>
              </div>
              <div className="w-24">
                <label className="text-xs font-medium text-muted-foreground">Max {t("aiAgentTurns")}</label>
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            {/* Instructions */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("aiAgentInstructions")}</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={t("aiAgentInstructionsHint")}
                rows={2}
                className="w-full mt-1 px-3 py-1.5 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            <Button onClick={handleStart} disabled={!apiKey.trim()} className="w-full gap-2">
              <PlayIcon className="w-4 h-4" />
              {t("aiAgentStart")}
            </Button>

            {!apiKey.trim() && (
              <p className="text-xs text-yellow-500">{t("aiAgentNoKey")}</p>
            )}
          </div>
        </div>
      )}

      {/* Agent Panel — fills remaining space */}
      <div className="flex-1 min-h-0">
        <AgentPanel
          messages={agent.messages}
          status={agent.status}
          turns={agent.turns}
          maxTurns={agent.maxTurns}
          inputTokens={agent.inputTokens}
          outputTokens={agent.outputTokens}
          costUsd={agent.costUsd}
          model={agent.model}
          onSendMessage={isActive ? handleSendMessage : undefined}
        />
      </div>
    </div>
  )
}
