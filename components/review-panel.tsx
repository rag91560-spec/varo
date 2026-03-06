"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { useLocale } from "@/hooks/use-locale"
import type { TranslationEntry } from "@/lib/types"

type ReviewStatus = "all" | "approved" | "needs_revision" | "flagged"

interface ReviewPanelProps {
  entries: TranslationEntry[]
  activeFilter: ReviewStatus
  onFilterChange: (filter: ReviewStatus) => void
  className?: string
}

interface FilterTab {
  key: ReviewStatus
  labelKey: "filterAll" | "reviewApproved" | "reviewNeedsRevision" | "reviewFlagged"
  color: string
  dotColor: string
}

const FILTER_TABS: FilterTab[] = [
  { key: "all", labelKey: "filterAll", color: "text-text-secondary", dotColor: "bg-text-muted" },
  { key: "approved", labelKey: "reviewApproved", color: "text-success", dotColor: "bg-success" },
  { key: "needs_revision", labelKey: "reviewNeedsRevision", color: "text-warning", dotColor: "bg-warning" },
  { key: "flagged", labelKey: "reviewFlagged", color: "text-error", dotColor: "bg-error" },
]

export function ReviewPanel({ entries, activeFilter, onFilterChange, className }: ReviewPanelProps) {
  const { t } = useLocale()

  const stats = useMemo(() => {
    const total = entries.length
    const approved = entries.filter((e) => e.review_status === "approved").length
    const needsRevision = entries.filter((e) => e.review_status === "needs_revision").length
    const flagged = entries.filter((e) => e.review_status === "flagged").length
    const unreviewed = entries.filter((e) => !e.review_status || e.review_status === "unreviewed").length
    const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0
    return { total, approved, needsRevision, flagged, unreviewed, approvalRate }
  }, [entries])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Summary bar */}
      <div className="flex items-center gap-4 rounded-lg border border-border bg-surface-elevated px-4 py-2.5 text-sm">
        <span className="font-semibold text-text-primary">
          {t("reviewApprovalRate")}: {stats.approvalRate}%
        </span>
        <div className="h-4 w-px bg-border" />
        <span className="text-text-secondary">
          {t("reviewUnreviewed")}: {stats.unreviewed}
        </span>
        {/* Progress bar */}
        <div className="ml-auto flex-1 max-w-40">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-success transition-all duration-300"
              style={{ width: `${stats.approvalRate}%` }}
            />
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
        {FILTER_TABS.map(({ key, labelKey, color, dotColor }) => {
          const count =
            key === "all"
              ? stats.total
              : key === "approved"
              ? stats.approved
              : key === "needs_revision"
              ? stats.needsRevision
              : stats.flagged

          return (
            <button
              key={key}
              onClick={() => onFilterChange(key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                activeFilter === key
                  ? "bg-surface-elevated text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated/50"
              )}
            >
              <span className={cn("size-1.5 rounded-full", dotColor)} />
              <span>{t(labelKey)}</span>
              <span className={cn("ml-0.5 tabular-nums", color)}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Keyboard shortcut guide */}
      <div className="rounded-lg border border-border/50 bg-surface px-4 py-2.5">
        <p className="mb-1.5 text-xs font-medium text-text-secondary">{t("keyboardShortcuts")}</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-text-muted">
          <ShortcutRow keys={["A"]} label={t("reviewApproved")} />
          <ShortcutRow keys={["R"]} label={t("reviewNeedsRevision")} />
          <ShortcutRow keys={["F"]} label={t("reviewFlagged")} />
          <ShortcutRow keys={["↑", "↓"]} label={t("prevNextItem")} />
          <ShortcutRow keys={["E"]} label={t("editString")} />
          <ShortcutRow keys={["Esc"]} label={t("cancel")} />
        </div>
      </div>
    </div>
  )
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {keys.map((k) => (
          <kbd
            key={k}
            className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border bg-surface-elevated px-1 font-mono text-[10px] text-text-secondary"
          >
            {k}
          </kbd>
        ))}
      </div>
      <span>{label}</span>
    </div>
  )
}
