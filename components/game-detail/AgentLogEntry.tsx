"use client"

import { useState } from "react"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import type { AgentMessage } from "@/lib/types"

interface Props {
  message: AgentMessage
}

export function AgentLogEntry({ message }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { event, data } = message

  if (event === "heartbeat") return null

  if (event === "thinking") {
    return (
      <div className="text-muted-foreground text-xs py-0.5">
        <span className="opacity-60">⟳</span> Turn {data.turn as number}...
      </div>
    )
  }

  if (event === "text") {
    return (
      <div className="text-foreground text-sm py-1 whitespace-pre-wrap">
        {data.text as string}
      </div>
    )
  }

  if (event === "tool_call") {
    const input = data.input as Record<string, unknown>
    const inputStr = JSON.stringify(input, null, 2)
    return (
      <div className="py-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-mono"
        >
          <span className="text-blue-500">▶</span>
          {data.tool as string}({Object.keys(input).length > 0 ? "..." : ""})
          {inputStr.length > 50 && (
            expanded ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />
          )}
        </button>
        {expanded && (
          <pre className="text-[11px] text-muted-foreground mt-1 ml-4 overflow-x-auto max-h-40 bg-black/30 rounded p-2">
            {inputStr}
          </pre>
        )}
      </div>
    )
  }

  if (event === "tool_result") {
    const result = data.result as Record<string, unknown>
    const resultStr = JSON.stringify(result, null, 2)
    const isError = !!result?.error
    return (
      <div className="py-0.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-1 text-xs font-mono ${isError ? "text-red-400" : "text-emerald-400/70"} hover:opacity-80`}
        >
          <span>{isError ? "✗" : "✓"}</span>
          {data.tool as string} → {isError ? (result.error as string) : `${resultStr.length} chars`}
          {expanded ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
        </button>
        {expanded && (
          <pre className="text-[11px] text-muted-foreground mt-1 ml-4 overflow-x-auto max-h-60 bg-black/30 rounded p-2">
            {resultStr.slice(0, 5000)}
          </pre>
        )}
      </div>
    )
  }

  if (event === "tokens") {
    return null // Rendered in the stats bar instead
  }

  if (event === "complete") {
    return (
      <div className="text-emerald-400 text-sm py-2 border-t border-border/30 mt-2">
        ✓ {(data.summary as string)?.slice(0, 200) || "Analysis complete"}
      </div>
    )
  }

  if (event === "error") {
    return (
      <div className="text-red-400 text-sm py-1">
        ✗ {data.message as string}
      </div>
    )
  }

  if (event === "cancelled") {
    return (
      <div className="text-yellow-400 text-sm py-1">
        ⊘ Cancelled at turn {data.turns as number}
      </div>
    )
  }

  if (event === "waiting") {
    return null // Rendered via status indicator
  }

  if (event === "user_message") {
    return (
      <div className="py-1.5 border-t border-border/20 mt-1">
        <span className="text-xs text-blue-300/70">You:</span>
        <span className="text-sm text-foreground ml-2">{data.text as string}</span>
      </div>
    )
  }

  if (event === "started" || event === "init") {
    return null
  }

  return (
    <div className="text-muted-foreground text-xs py-0.5">
      [{event}] {JSON.stringify(data).slice(0, 100)}
    </div>
  )
}
