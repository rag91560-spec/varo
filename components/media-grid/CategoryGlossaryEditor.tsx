"use client"

import { useEffect, useState } from "react"
import { XIcon, PlusIcon, Trash2Icon, SaveIcon, Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"

interface CategoryGlossaryEditorProps {
  categoryId: number
  categoryName: string
  onClose: () => void
  onSaved?: () => void
}

interface Row {
  id: string
  source: string
  target: string
}

let _rowSeq = 0
const newRow = (source = "", target = ""): Row => ({
  id: `row-${++_rowSeq}-${Date.now()}`,
  source,
  target,
})

export function CategoryGlossaryEditor({
  categoryId,
  categoryName,
  onClose,
  onSaved,
}: CategoryGlossaryEditorProps) {
  const { t } = useLocale()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError("")
      try {
        const data = await api.categories.getGlossary(categoryId)
        if (cancelled) return
        const loaded = Object.entries(data || {}).map(([source, target]) =>
          newRow(source, String(target)),
        )
        setRows(loaded.length > 0 ? loaded : [newRow()])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [categoryId])

  const updateRow = (id: string, field: "source" | "target", value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  const addRow = () => setRows((prev) => [...prev, newRow()])

  const removeRow = (id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id)
      return next.length > 0 ? next : [newRow()]
    })
  }

  const handleSave = async () => {
    setError("")
    setSaving(true)
    try {
      const glossary: Record<string, string> = {}
      for (const row of rows) {
        const src = row.source.trim()
        const tgt = row.target.trim()
        if (src && tgt) {
          glossary[src] = tgt
        }
      }
      await api.categories.putGlossary(categoryId, glossary)
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl border border-border-subtle bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold text-text-primary">
              {t("editGlossary")}
            </h2>
            <span className="text-xs text-text-tertiary truncate">{categoryName}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-text-tertiary text-sm gap-2">
              <Loader2Icon className="size-4 animate-spin" />
              {t("loading")}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-text-tertiary px-1 pb-1">
                <span>{t("glossarySource")}</span>
                <span>{t("glossaryTarget")}</span>
                <span className="w-7" />
              </div>

              {rows.map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <input
                    value={row.source}
                    onChange={(e) => updateRow(row.id, "source", e.target.value)}
                    placeholder={t("glossarySourcePlaceholder")}
                    className="px-3 py-1.5 text-sm rounded-md border border-border-subtle bg-surface-2 text-text-primary focus:outline-none focus:border-accent"
                  />
                  <input
                    value={row.target}
                    onChange={(e) => updateRow(row.id, "target", e.target.value)}
                    placeholder={t("glossaryTargetPlaceholder")}
                    className="px-3 py-1.5 text-sm rounded-md border border-border-subtle bg-surface-2 text-text-primary focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => removeRow(row.id)}
                    className="p-1.5 rounded-md text-text-tertiary hover:text-red-400 hover:bg-overlay-4 transition-colors"
                    title={t("delete")}
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              ))}

              <button
                onClick={addRow}
                className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-md border border-dashed border-border-subtle text-xs text-text-tertiary hover:text-accent hover:border-accent transition-colors"
              >
                <PlusIcon className="size-3.5" />
                {t("addRow")}
              </button>
            </div>
          )}

          {error && (
            <p className="mt-3 text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={loading || saving}>
            {saving ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <SaveIcon className="size-3.5" />
            )}
            {t("save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
