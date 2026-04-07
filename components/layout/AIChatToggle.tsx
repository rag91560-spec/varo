"use client"

import { BrainCircuitIcon } from "lucide-react"
import { useAIChat } from "@/hooks/use-ai-chat"
import { cn } from "@/lib/utils"

export function AIChatToggle() {
  const { open, toggle, agent } = useAIChat()

  if (open) return null

  const isActive = agent.status === "running" || agent.status === "waiting"

  return (
    <button
      onClick={toggle}
      className={cn(
        "fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2.5 rounded-full shadow-lg transition-all",
        "bg-purple-600 hover:bg-purple-500 text-white",
        isActive && "ring-2 ring-purple-400/50 ring-offset-2 ring-offset-background"
      )}
      title="AI Chat"
    >
      <BrainCircuitIcon className="size-4" />
      <span className="text-xs font-medium">AI</span>
      {isActive && (
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      )}
    </button>
  )
}
