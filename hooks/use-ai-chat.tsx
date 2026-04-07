"use client"

import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { useAgent } from "./use-agent"
import { useSettings } from "./use-api"
import { KEY_PROVIDERS, type ProviderInfo } from "@/lib/providers"

interface AvailableProvider {
  provider: ProviderInfo
  apiKey: string
}

interface AIChatContextValue {
  /** Whether the sidebar is open */
  open: boolean
  toggle: () => void
  setOpen: (v: boolean) => void

  /** Current game context (auto-detected from route) */
  gameId: number | null

  /** Agent hook instance */
  agent: ReturnType<typeof useAgent>

  /** Available providers (those with API keys set in settings) */
  availableProviders: AvailableProvider[]
  hasAnyKey: boolean

  /** Selected provider + model */
  selectedProviderId: string
  setSelectedProviderId: (v: string) => void
  selectedModel: string
  setSelectedModel: (v: string) => void

  /** Config */
  maxTurns: number
  setMaxTurns: (v: number) => void
  instructions: string
  setInstructions: (v: string) => void

  /** Quick actions */
  startAgent: () => void
  cancelAgent: () => void
  sendMessage: (text: string) => void
}

const AIChatContext = createContext<AIChatContextValue | null>(null)

/** Parse api_keys from settings into a Record<string, string> */
function parseApiKeys(raw: unknown): Record<string, string> {
  if (!raw) return {}
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (typeof raw === "object") return raw as Record<string, string>
  return {}
}

export function AIChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { settings } = useSettings()

  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen((v) => !v), [])

  // Detect gameId from route
  const gameId = useMemo(() => {
    const match = pathname.match(/^\/library\/(\d+)/)
    return match ? Number(match[1]) : null
  }, [pathname])

  // Parse stored API keys and find available providers
  const apiKeys = useMemo(() => parseApiKeys(settings.api_keys), [settings.api_keys])

  const availableProviders = useMemo(() => {
    const result: AvailableProvider[] = []
    for (const provider of KEY_PROVIDERS) {
      // Match provider id to settings key
      // Settings uses: claude_api -> "claude" or "anthropic", openai -> "openai", gemini -> "gemini", deepseek -> "deepseek"
      const key =
        apiKeys[provider.id] ||
        (provider.id === "claude_api" ? (apiKeys.claude || apiKeys.anthropic || "") : "") ||
        apiKeys[provider.id.replace("_api", "")] ||
        ""
      if (key.trim()) {
        result.push({ provider, apiKey: key.trim() })
      }
    }
    return result
  }, [apiKeys])

  const hasAnyKey = availableProviders.length > 0

  // Selected provider/model — default to first available
  const [selectedProviderId, setSelectedProviderId] = useState("")
  const [selectedModel, setSelectedModel] = useState("")

  // Auto-select first available provider when keys change
  useEffect(() => {
    if (availableProviders.length > 0 && !availableProviders.find((p) => p.provider.id === selectedProviderId)) {
      const first = availableProviders[0]
      setSelectedProviderId(first.provider.id)
      setSelectedModel(first.provider.defaultModel)
    }
  }, [availableProviders, selectedProviderId])

  // Update model when provider changes
  useEffect(() => {
    const ap = availableProviders.find((p) => p.provider.id === selectedProviderId)
    if (ap && !ap.provider.models.includes(selectedModel)) {
      setSelectedModel(ap.provider.defaultModel)
    }
  }, [selectedProviderId, availableProviders, selectedModel])

  const [maxTurns, setMaxTurns] = useState(20)
  const [instructions, setInstructions] = useState("")

  // Agent instance
  const agent = useAgent(gameId)

  const startAgent = useCallback(() => {
    const ap = availableProviders.find((p) => p.provider.id === selectedProviderId)
    if (!ap) return

    // Map provider id to backend provider name
    const providerName = selectedProviderId === "claude_api" ? "claude" : selectedProviderId
    agent.start(ap.apiKey, selectedModel, maxTurns, instructions, providerName)
  }, [availableProviders, selectedProviderId, selectedModel, maxTurns, instructions, agent])

  const cancelAgent = useCallback(() => {
    agent.cancel()
  }, [agent])

  const sendMessage = useCallback((text: string) => {
    agent.sendMessage(text)
  }, [agent])

  return (
    <AIChatContext.Provider
      value={{
        open,
        toggle,
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
        instructions,
        setInstructions,
        startAgent,
        cancelAgent,
        sendMessage,
      }}
    >
      {children}
    </AIChatContext.Provider>
  )
}

export function useAIChat() {
  const ctx = useContext(AIChatContext)
  if (!ctx) throw new Error("useAIChat must be used within AIChatProvider")
  return ctx
}
