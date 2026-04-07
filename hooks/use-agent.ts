"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { api } from "@/lib/api"
import type { AgentMessage, AgentPollResponse } from "@/lib/types"

export type AgentStatus = "idle" | "running" | "waiting" | "completed" | "error" | "cancelled"

export function useAgent(gameId: number | null) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [status, setStatus] = useState<AgentStatus>("idle")
  const [turns, setTurns] = useState(0)
  const [maxTurns, setMaxTurns] = useState(20)
  const [inputTokens, setInputTokens] = useState(0)
  const [outputTokens, setOutputTokens] = useState(0)
  const [costUsd, setCostUsd] = useState(0)
  const [model, setModel] = useState("")
  const [summary, setSummary] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    if (gameId === null) return
    stopPolling()
    let idleCount = 0

    const poll = async () => {
      try {
        const res = await fetch(api.agent.pollUrl(gameId))
        if (!res.ok) return
        const data: AgentPollResponse = await res.json()

        if (data.status === "running" || data.status === "waiting") {
          idleCount = 0
          setStatus(data.status as AgentStatus)
          if (data.turns !== undefined) setTurns(data.turns)
          if (data.max_turns !== undefined) setMaxTurns(data.max_turns)
          if (data.input_tokens !== undefined) setInputTokens(data.input_tokens)
          if (data.output_tokens !== undefined) setOutputTokens(data.output_tokens)
          if (data.model) setModel(data.model)
          if (data.messages?.length) {
            setMessages(data.messages)
          }
        } else if (data.status === "completed") {
          setStatus("completed")
          setSummary(data.result_summary || "")
          if (data.turns !== undefined) setTurns(data.turns)
          if (data.input_tokens !== undefined) setInputTokens(data.input_tokens)
          if (data.output_tokens !== undefined) setOutputTokens(data.output_tokens)
          if (data.messages?.length) setMessages(data.messages)
          stopPolling()
        } else if (data.status === "error") {
          setStatus("error")
          setErrorMessage(data.error_message || "Unknown error")
          if (data.messages?.length) setMessages(data.messages)
          stopPolling()
        } else if (data.status === "cancelled") {
          setStatus("cancelled")
          if (data.messages?.length) setMessages(data.messages)
          stopPolling()
        } else {
          idleCount++
          if (idleCount > 20) {
            setStatus("idle")
            stopPolling()
          }
        }
      } catch { /* ignore */ }
    }

    poll()
    pollRef.current = setInterval(poll, 2000)
  }, [gameId, stopPolling])

  const start = useCallback(async (
    apiKey: string,
    agentModel?: string,
    maxTurnsVal?: number,
    instructions?: string,
    provider?: string,
  ) => {
    if (gameId === null) return
    setMessages([])
    setStatus("running")
    setTurns(0)
    setInputTokens(0)
    setOutputTokens(0)
    setCostUsd(0)
    setSummary("")
    setErrorMessage("")

    try {
      const result = await api.agent.start(gameId, {
        api_key: apiKey,
        provider,
        model: agentModel,
        max_turns: maxTurnsVal,
        instructions,
      })
      setModel(result.model)
      setMaxTurns(result.max_turns)
      startPolling()
    } catch (e: unknown) {
      setStatus("error")
      setErrorMessage(e instanceof Error ? e.message : "Failed to start agent")
    }
  }, [gameId, startPolling])

  const sendMessage = useCallback(async (text: string) => {
    if (gameId === null || !text.trim()) return
    try {
      await api.agent.message(gameId, text.trim())
    } catch { /* ignore — agent may have moved on */ }
  }, [gameId])

  const cancel = useCallback(async () => {
    if (gameId === null) return
    try {
      await api.agent.cancel(gameId)
    } catch { /* ignore */ }
  }, [gameId])

  const reset = useCallback(() => {
    stopPolling()
    setMessages([])
    setStatus("idle")
    setTurns(0)
    setInputTokens(0)
    setOutputTokens(0)
    setCostUsd(0)
    setSummary("")
    setErrorMessage("")
  }, [stopPolling])

  // Update cost whenever tokens change
  useEffect(() => {
    const cost = (inputTokens * 3.0 + outputTokens * 15.0) / 1_000_000
    setCostUsd(Math.round(cost * 10000) / 10000)
  }, [inputTokens, outputTokens])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  return {
    messages,
    status,
    turns,
    maxTurns,
    inputTokens,
    outputTokens,
    costUsd,
    model,
    summary,
    errorMessage,
    start,
    sendMessage,
    cancel,
    reset,
  }
}
