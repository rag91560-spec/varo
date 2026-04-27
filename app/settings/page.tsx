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
  Loader2Icon,
  ZapIcon,
  XCircleIcon,
  KeyboardIcon,
  FileWarningIcon,
  CopyIcon,
  Trash2Icon,
  DownloadIcon,
  RefreshCwIcon,
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
import { api } from "@/lib/api"

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
  const [testingKey, setTestingKey] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; error?: string }>>({})
  const [killHotkey, setKillHotkey] = useState("Ctrl+Shift+Q")
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false)
  const [hotkeyStatus, setHotkeyStatus] = useState<"idle" | "success" | "error">("idle")
  const [crashLog, setCrashLog] = useState<string | null>(null)
  const [crashLogLoading, setCrashLogLoading] = useState(false)
  const [crashLogCopied, setCrashLogCopied] = useState(false)

  // Update state
  const [appVersion, setAppVersion] = useState("")
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "downloading" | "downloaded" | "latest" | "error">("idle")
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateError, setUpdateError] = useState("")
  const [isElectron, setIsElectron] = useState(false)

  useEffect(() => {
    const electron = typeof window !== "undefined" && !!window.electronAPI
    setIsElectron(electron)
    if (electron && window.electronAPI) {
      window.electronAPI.getAppVersion().then((v: string) => setAppVersion(v))
      const offAvailable = window.electronAPI.onUpdateAvailable(() => setUpdateStatus("downloading"))
      const offProgress = window.electronAPI.onUpdateProgress((data: { percent: number }) => setUpdateProgress(Math.round(data.percent)))
      const offDownloaded = window.electronAPI.onUpdateDownloaded(() => setUpdateStatus("downloaded"))
      return () => { offAvailable(); offProgress(); offDownloaded() }
    }
  }, [])


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
      if (typeof settings.hotkey_kill === "string") {
        setKillHotkey(settings.hotkey_kill)
      }
    }
  }, [loading, settings])

  const toggleKeyVisibility = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleTestKey = useCallback(async (providerId: string) => {
    const key = keys[providerId]
    if (!key) return
    setTestingKey(providerId)
    setTestResult((prev) => {
      const next = { ...prev }
      delete next[providerId]
      return next
    })
    try {
      const res = await api.settings.testKey(providerId, key)
      setTestResult((prev) => ({ ...prev, [providerId]: res }))
    } catch {
      setTestResult((prev) => ({ ...prev, [providerId]: { ok: false, error: t("connectionFailed") } }))
    } finally {
      setTestingKey(null)
    }
  }, [keys, t])

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
        api_keys: keys,
        scan_directories: filteredDirs,
        default_provider: defaultProvider,
        default_source_lang: defaultLang,
        license_key: trimmedKey,
        hotkey_kill: killHotkey,
      })
      // Register kill hotkey in Electron
      if (killHotkey && window.electronAPI) {
        const electronAccelerator = killHotkey.replace("Ctrl", "CommandOrControl")
        window.electronAPI.registerKillHotkey(electronAccelerator)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("saveFailed"))
      setTimeout(() => setSaveError(""), 5000)
    } finally {
      setSaving(false)
    }
  }, [keys, scanDirs, defaultProvider, defaultLang, licenseKey, killHotkey, save])

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
                onClick={async () => { await save({ license_key: licenseKey.trim() }); verifyLicense() }}
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
                className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50 [&>option]:bg-[#1a1a2e] [&>option]:text-white"
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
                className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50 [&>option]:bg-[#1a1a2e] [&>option]:text-white"
              >
                <option value="ja">{t("japanese")}</option>
                <option value="en">{t("english")}</option>
                <option value="zh">{t("chinese")}</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shortcuts */}
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyboardIcon className="size-5 text-accent" />
            {t("shortcuts")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1 block">
              {t("killHotkey")}
            </label>
            <p className="text-[11px] text-text-tertiary mb-2">
              {t("killHotkeyDescription")}
            </p>
            <input
              type="text"
              readOnly
              value={isCapturingHotkey ? t("pressKeys") : killHotkey}
              onFocus={() => setIsCapturingHotkey(true)}
              onBlur={() => setIsCapturingHotkey(false)}
              onKeyDown={(e) => {
                if (!isCapturingHotkey) return
                e.preventDefault()
                // Ignore lone modifier keys
                if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return
                const parts: string[] = []
                if (e.ctrlKey) parts.push("Ctrl")
                if (e.shiftKey) parts.push("Shift")
                if (e.altKey) parts.push("Alt")
                // Normalize key name
                let key = e.key
                if (key === " ") key = "Space"
                else if (key.length === 1) key = key.toUpperCase()
                parts.push(key)
                setKillHotkey(parts.join("+"))
                setIsCapturingHotkey(false)
                ;(e.target as HTMLInputElement).blur()
              }}
              className={`w-full h-10 px-3 rounded-lg border text-sm font-mono text-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all ${
                isCapturingHotkey
                  ? "border-accent bg-accent/10 text-accent animate-pulse"
                  : "border-border bg-surface-elevated text-text-primary"
              }`}
            />
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
                  <button
                    onClick={() => handleTestKey(provider.id)}
                    disabled={!keys[provider.id] || testingKey === provider.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-medium text-text-secondary hover:text-text-primary bg-surface-elevated hover:bg-overlay-6 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {testingKey === provider.id ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      <ZapIcon className="size-3.5" />
                    )}
                    {t("testConnection")}
                  </button>
                  {testResult[provider.id] && (
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                      testResult[provider.id].ok
                        ? "text-success"
                        : "text-error"
                    }`}>
                      {testResult[provider.id].ok ? (
                        <><CheckIcon className="size-3" /> {t("connectionSuccess")}</>
                      ) : (
                        <><XCircleIcon className="size-3" /> {testResult[provider.id].error}</>
                      )}
                    </span>
                  )}
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

      {/* Launcher Update */}
      {isElectron && (
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DownloadIcon className="size-5 text-accent" />
              {t("launcherUpdate")}
            </CardTitle>
            <CardDescription>
              {t("currentVersion")} <span className="font-mono text-text-primary">v{appVersion}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {updateStatus === "idle" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  setUpdateStatus("checking")
                  setUpdateError("")
                  try {
                    const result = await window.electronAPI!.checkForUpdates() as { updateInfo?: { version?: string } } | null
                    if (!result?.updateInfo?.version || result.updateInfo.version === appVersion) {
                      setUpdateStatus("latest")
                    }
                    // If update is available, the onUpdateAvailable listener will fire
                  } catch (e: unknown) {
                    setUpdateStatus("error")
                    setUpdateError(e instanceof Error ? e.message : t("updateCheckFailed"))
                  }
                }}
              >
                <RefreshCwIcon className="size-4" />
                {t("checkForUpdates")}
              </Button>
            )}

            {updateStatus === "checking" && (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2Icon className="size-4 animate-spin text-accent" />
                {t("checkingForUpdates")}
              </div>
            )}

            {updateStatus === "latest" && (
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-sm text-success">
                  <CheckIcon className="size-4" />
                  {t("upToDate")}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setUpdateStatus("idle")}>
                  {t("checkAgain")}
                </Button>
              </div>
            )}

            {updateStatus === "downloading" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2Icon className="size-4 animate-spin text-accent" />
                  {t("downloadingPercent").replace("{percentage}", updateProgress > 0 ? String(updateProgress) : "0")}
                </div>
                {updateProgress > 0 && (
                  <div className="h-1.5 bg-overlay-4 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-300"
                      style={{ width: `${updateProgress}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {updateStatus === "downloaded" && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-success">{t("updateDownloaded")}</span>
                <Button
                  size="sm"
                  onClick={() => window.electronAPI?.installUpdate()}
                >
                  {t("installNowRestart")}
                </Button>
              </div>
            )}

            {updateStatus === "error" && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-error">{updateError || t("updateCheckFailed")}</span>
                <Button variant="ghost" size="sm" onClick={() => setUpdateStatus("idle")}>
                  {t("retry")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Crash Log */}
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileWarningIcon className="size-5 text-accent" />
            {t("crashLog")}
          </CardTitle>
          <CardDescription>
            {t("crashLogDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {crashLog === null ? (
            <Button
              variant="secondary"
              size="sm"
              loading={crashLogLoading}
              onClick={async () => {
                setCrashLogLoading(true)
                try {
                  const log = await api.settings.crashLog()
                  setCrashLog(log || "")
                } finally {
                  setCrashLogLoading(false)
                }
              }}
            >
              {t("crashLog")}
            </Button>
          ) : crashLog === "" ? (
            <p className="text-sm text-text-tertiary">{t("crashLogEmpty")}</p>
          ) : (
            <>
              <pre
                className="max-h-96 overflow-auto rounded-lg bg-surface-elevated border border-border p-3 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all"
                ref={(el) => { if (el) el.scrollTop = el.scrollHeight }}
              >
                {crashLog}
              </pre>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(crashLog)
                    setCrashLogCopied(true)
                    setTimeout(() => setCrashLogCopied(false), 2000)
                  }}
                >
                  {crashLogCopied ? (
                    <><CheckIcon className="size-3.5" /> {t("crashLogCopied")}</>
                  ) : (
                    <><CopyIcon className="size-3.5" /> {t("crashLogCopy")}</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    if (!confirm(t("crashLogConfirmClear"))) return
                    await api.settings.clearCrashLog()
                    setCrashLog("")
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                  {t("crashLogClear")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* spacer for sticky bar */}
      <div className="h-16" />

      {/* Sticky Save Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-6 md:px-8 py-3 flex items-center justify-between gap-3">
          {saveError && (
            <p className="text-xs text-red-400 truncate">{saveError}</p>
          )}
          {!saveError && <div />}
          <Button
            variant="default"
            size="md"
            onClick={handleSave}
            loading={saving}
            className="shrink-0 min-w-[120px]"
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
        </div>
      </div>
    </div>
  )
}
