"use client"

import { useState, useEffect, useCallback } from "react"
import {
  KeyIcon,
  EyeIcon,
  EyeOffIcon,
  SaveIcon,
  FolderSearchIcon,
  CheckIcon,
  SearchIcon,
  ExternalLinkIcon,
  ChevronDownIcon,
  ShieldCheckIcon,
  SettingsIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Paywall } from "@/components/ui/paywall"
import { useLocale } from "@/hooks/use-locale"
import { useSettings, useLicenseStatus } from "@/hooks/use-api"
import { KEY_PROVIDERS } from "@/lib/providers"

export default function SettingsPage() {
  const { t } = useLocale()
  const { settings, loading, save } = useSettings()
  const { license, verify: verifyLicense, loading: licenseLoading, refresh: refreshLicense } = useLicenseStatus()
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [expandedGuide, setExpandedGuide] = useState<Record<string, boolean>>({})
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [scanDirs, setScanDirs] = useState<string[]>([])
  const [defaultProvider, setDefaultProvider] = useState("claude")
  const [defaultLang, setDefaultLang] = useState("ja")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [licenseKey, setLicenseKey] = useState("")

  // Load settings into local state
  useEffect(() => {
    if (!loading && settings) {
      const rawKeys = settings.api_keys
      if (rawKeys && typeof rawKeys === "object" && !Array.isArray(rawKeys)) {
        setKeys(rawKeys)
      } else if (typeof rawKeys === "string") {
        try { setKeys(JSON.parse(rawKeys)) } catch { /* malformed */ }
      }
      const rawDirs = settings.scan_directories
      if (Array.isArray(rawDirs)) {
        setScanDirs(rawDirs)
      } else if (typeof rawDirs === "string") {
        try { setScanDirs(JSON.parse(rawDirs)) } catch { /* malformed */ }
      }
      if (typeof settings.default_provider === "string") {
        setDefaultProvider(settings.default_provider)
      }
      if (typeof settings.default_source_lang === "string") {
        setDefaultLang(settings.default_source_lang)
      }
      if (typeof settings.license_key === "string") {
        setLicenseKey(settings.license_key)
      }
    }
  }, [loading, settings])

  const toggleKeyVisibility = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveError("")

    // Validate license key format (allow empty or XXXX-XXXX-... pattern)
    const trimmedKey = licenseKey.trim()
    if (trimmedKey && !/^[A-Za-z0-9-]{8,}$/.test(trimmedKey)) {
      setSaveError("Invalid license key format")
      setSaving(false)
      setTimeout(() => setSaveError(""), 5000)
      return
    }

    // Filter out empty scan directories
    const filteredDirs = scanDirs.filter((d) => d.trim() !== "")

    try {
      await save({
        api_keys: JSON.stringify(keys),
        scan_directories: JSON.stringify(filteredDirs),
        default_provider: defaultProvider,
        default_source_lang: defaultLang,
        license_key: trimmedKey,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("saveFailed"))
      setTimeout(() => setSaveError(""), 5000)
    } finally {
      setSaving(false)
    }
  }, [keys, scanDirs, defaultProvider, defaultLang, licenseKey, save])

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
          {t("settings")}
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {t("settingsDescription")}
        </p>
      </div>

      {/* General — License + Defaults */}
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="size-5 text-accent" />
            {t("general")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* License Key */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">
              <ShieldCheckIcon className="size-3.5" />
              {t("licenseKey")}
            </label>
            <p className="text-[11px] text-text-tertiary mb-2">
              {t("licenseKeyDescription")}
            </p>
            <div className="relative">
              <input
                type={showKeys["license"] ? "text" : "password"}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                autoComplete="off"
                className="w-full h-10 px-3 pr-10 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
              />
              <button
                onClick={() => toggleKeyVisibility("license")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
              >
                {showKeys["license"] ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              {license.valid ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/15 text-success text-xs font-medium">
                  <CheckIcon className="size-3" />
                  {t("licenseValid")}
                  {license.plan && <span className="text-success/70">({license.plan})</span>}
                </span>
              ) : licenseKey ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-error/15 text-error text-xs font-medium">
                  {t("licenseInvalid")}
                </span>
              ) : null}
              <button
                onClick={() => verifyLicense()}
                disabled={licenseLoading || !licenseKey}
                className="text-xs text-accent hover:text-accent/80 disabled:text-text-tertiary disabled:cursor-not-allowed transition-colors"
              >
                {licenseLoading ? t("licenseVerifying") : t("licenseVerify")}
              </button>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Default Provider */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                {t("defaultProvider")}
              </label>
              <select
                value={defaultProvider}
                onChange={(e) => setDefaultProvider(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                {KEY_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                {t("defaultSourceLang")}
              </label>
              <select
                value={defaultLang}
                onChange={(e) => setDefaultLang(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="ja">{t("japanese")}</option>
                <option value="en">{t("english")}</option>
                <option value="zh">{t("chinese")}</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Paywall show={!license.valid} onLicenseVerified={refreshLicense}>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <KeyIcon className="size-5 text-accent" />
          <h2 className="text-lg font-semibold text-text-primary">{t("apiKeys")}</h2>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          {t("apiKeysDescription")}
        </p>

        <div className="space-y-3">
          {KEY_PROVIDERS.map((provider) => {
            const hasKey = !!keys[provider.id]
            const isExpanded = expandedGuide[provider.id]

            return (
              <Card key={provider.id} className="bg-surface">
              <CardContent className="p-4">
                {/* Provider Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`size-8 rounded-[10px] flex items-center justify-center text-xs font-bold border ${
                        hasKey
                          ? "bg-success/15 text-success border-success/30"
                          : "bg-overlay-4 text-text-secondary border-overlay-6"
                      }`}
                    >
                      {hasKey ? <CheckIcon className="size-4" /> : <KeyIcon className="size-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">{provider.name}</p>
                      {provider.freeTier && (
                        <p className="text-[11px] text-accent flex items-center gap-1">
                            {provider.freeTier}
                        </p>
                      )}
                    </div>
                  </div>
                  {provider.pricing && (
                    <span className="text-[10px] text-text-tertiary font-mono">{provider.pricing}</span>
                  )}
                </div>

                {/* Key Input */}
                <div className="relative mb-2">
                  <input
                    type={showKeys[provider.id] ? "text" : "password"}
                    placeholder={provider.keyHint || "API key..."}
                    value={keys[provider.id] || ""}
                    onChange={(e) =>
                      setKeys((prev) => ({
                        ...prev,
                        [provider.id]: e.target.value,
                      }))
                    }
                    autoComplete="off"
                    className="w-full h-11 px-3 pr-10 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                  />
                  <button
                    onClick={() => toggleKeyVisibility(provider.id)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    {showKeys[provider.id] ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                  {provider.keyUrl && (
                    <a
                      href={provider.keyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors"
                    >
                      <ExternalLinkIcon className="size-3.5" />
                      {t("getKey")}
                    </a>
                  )}
                  {provider.keyGuide && (
                    <button
                      onClick={() => setExpandedGuide((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[10px] text-xs font-medium text-text-secondary hover:text-text-primary bg-surface-elevated hover:bg-overlay-6 transition-colors"
                    >
                        {t("guide")}
                      <ChevronDownIcon className={`size-3 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </div>

                {/* Guide Steps (Expandable) */}
                {isExpanded && provider.keyGuide && (
                  <div className="mt-3 p-3 rounded-lg bg-accent/5 border border-accent/10">
                    <ol className="space-y-2">
                      {provider.keyGuide.map((step, i) => (
                        <li key={i} className="flex gap-2.5 text-xs text-text-secondary">
                          <span
                            className="shrink-0 size-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-accent/15 text-accent"
                          >
                            {i + 1}
                          </span>
                          <span className="pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </CardContent>
            </Card>
            )
          })}
        </div>
      </div>
      </Paywall>

      {/* Scan Directories */}
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderSearchIcon className="size-5 text-accent" />
            {t("scanDirectories")}
          </CardTitle>
          <CardDescription>
            {t("scanDirectoriesDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {scanDirs.map((dir, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={dir}
                onChange={(e) => {
                  const next = [...scanDirs]
                  next[i] = e.target.value
                  setScanDirs(next)
                }}
                className="flex-1 h-11 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setScanDirs(scanDirs.filter((_, j) => j !== i))}
                className="shrink-0 text-text-tertiary"
              >
                {t("delete")}
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setScanDirs([...scanDirs, ""])}
          >
            {t("addPath")}
          </Button>
        </CardContent>
      </Card>

      {/* Save */}
      <Button
        variant="default"
        size="md"
        className="w-full"
        onClick={handleSave}
        loading={saving}
      >
        {saved ? (
          <>
            <CheckIcon className="size-4" />
            {t("saved")}
          </>
        ) : (
          <>
            <SaveIcon className="size-4" />
            {t("save")}
          </>
        )}
      </Button>
      {saveError && (
        <p className="text-xs text-red-400 text-center mt-2">{saveError}</p>
      )}
    </div>
  )
}
