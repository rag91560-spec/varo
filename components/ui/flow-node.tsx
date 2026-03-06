"use client"

import { Handle, Position } from "@xyflow/react"
import { cn } from "@/lib/utils"

export interface FlowNodeData {
  label: string
  total: number
  translated: number
  errors: number
  type: "section" | "branch" | "common"
}

function getNodeColors(data: FlowNodeData): {
  border: string
  bg: string
  badge: string
} {
  if (data.errors > 0) {
    return {
      border: "border-red-500/70",
      bg: "bg-red-950/60",
      badge: "bg-red-500 text-white",
    }
  }
  if (data.total === 0) {
    return {
      border: "border-overlay-6",
      bg: "bg-overlay-2",
      badge: "bg-overlay-4 text-text-secondary",
    }
  }
  const pct = data.translated / data.total
  if (pct >= 1) {
    return {
      border: "border-green-500/70",
      bg: "bg-green-950/60",
      badge: "bg-green-500 text-white",
    }
  }
  if (pct > 0) {
    return {
      border: "border-yellow-500/70",
      bg: "bg-yellow-950/60",
      badge: "bg-yellow-500 text-black",
    }
  }
  return {
    border: "border-overlay-6",
    bg: "bg-overlay-2",
    badge: "bg-overlay-4 text-text-secondary",
  }
}

function ProgressBar({ pct }: { pct: number }) {
  const clampedPct = Math.min(100, Math.max(0, Math.round(pct * 100)))
  let barColor = "bg-slate-500"
  if (pct >= 1) barColor = "bg-green-500"
  else if (pct > 0) barColor = "bg-yellow-500"

  return (
    <div className="h-1.5 w-full rounded-full bg-overlay-4 overflow-hidden mt-1.5">
      <div
        className={cn("h-full rounded-full transition-all", barColor)}
        style={{ width: `${clampedPct}%` }}
      />
    </div>
  )
}

export function FlowNode({ data }: { data: FlowNodeData }) {
  const colors = getNodeColors(data)
  const pct = data.total > 0 ? data.translated / data.total : 0
  const pctLabel = data.total > 0 ? `${Math.round(pct * 100)}%` : "0%"

  return (
    <div
      className={cn(
        "min-w-[140px] max-w-[200px] rounded-lg border px-3 py-2 text-xs shadow-md cursor-pointer select-none",
        colors.bg,
        colors.border
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-overlay-6 !border-overlay-6" />

      {/* Label */}
      <div className="font-medium text-text-primary truncate leading-tight" title={data.label}>
        {data.label}
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between mt-1.5 gap-1">
        <span className="text-text-secondary">
          {data.translated}/{data.total}
        </span>
        <span className={cn("rounded px-1 py-0.5 text-[10px] font-bold leading-none", colors.badge)}>
          {pctLabel}
        </span>
      </div>

      {/* Progress bar */}
      <ProgressBar pct={pct} />

      {/* QA error badge */}
      {data.errors > 0 && (
        <div className="mt-1.5 flex items-center gap-1">
          <span className="rounded bg-red-500/80 px-1 py-0.5 text-[10px] font-bold text-white leading-none">
            QA {data.errors}
          </span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-overlay-6 !border-overlay-6" />
    </div>
  )
}
