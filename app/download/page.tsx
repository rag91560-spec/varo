"use client"

import { useState, useCallback } from "react"
import {
  DownloadIcon,
  ShieldCheckIcon,
  KeyIcon,
  ExternalLinkIcon,
  CheckCircleIcon,
  XCircleIcon,
  Loader2Icon,
  CopyIcon,
  ClipboardCheckIcon,
  SparklesIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://api.closedclaws.com"
const FANBOX_URL = process.env.NEXT_PUBLIC_FANBOX_URL || "https://minhyung.fanbox.cc"

interface VerifyResult {
  valid: boolean
  unlimited: boolean
  expires_at: string | null
  message?: string
}

interface DownloadResult {
  token: string
  download_url: string
  expires_in: number
}

export default function DownloadPage() {
  const { t } = useLocale()
  const [licenseKey, setLicenseKey] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState<VerifyResult | null>(null)
  const [verifyError, setVerifyError] = useState("")
  const [downloading, setDownloading] = useState(false)
  const [downloadLink, setDownloadLink] = useState("")
  const [copied, setCopied] = useState(false)

  const handleVerify = useCallback(async () => {
    if (!licenseKey.trim()) return
    setVerifying(true)
    setVerifyError("")
    setVerified(null)
    try {
      const res = await fetch(`${API_BASE}/api/license/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: licenseKey.trim(), fingerprint: "web-launcher" }),
      })
      const data = await res.json()
      if (data.valid) {
        setVerified(data as VerifyResult)
      } else {
        setVerifyError(data.message || t("invalidLicense"))
      }
    } catch {
      setVerifyError(t("serverConnectionFailed"))
    } finally {
      setVerifying(false)
    }
  }, [licenseKey])

  const handleDownload = useCallback(async () => {
    if (!verified?.valid) return
    setDownloading(true)
    try {
      const res = await fetch(`${API_BASE}/api/license/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: licenseKey.trim() }),
      })
      const data: DownloadResult = await res.json()
      if (data.download_url) {
        setDownloadLink(data.download_url)
        // Auto-start download
        window.open(data.download_url, "_blank")
      }
    } catch {
      setVerifyError(t("downloadLinkFailed"))
    } finally {
      setDownloading(false)
    }
  }, [verified, licenseKey])

  const handleCopyLink = useCallback(() => {
    if (!downloadLink) return
    navigator.clipboard.writeText(downloadLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [downloadLink])

  const formatExpiry = (expiresAt: string | null, unlimited: boolean) => {
    if (unlimited) return t("permanentLicense")
    if (!expiresAt) return t("noExpiry")
    const d = new Date(expiresAt)
    const diff = d.getTime() - Date.now()
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    if (days <= 0) return t("licenseExpired")
    return t("daysRemaining").replace("{days}", String(days)) + ` (${d.toLocaleDateString()})`
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
          {t("download")}
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {t("downloadDesc")}
        </p>
      </div>

      {/* Feature Highlight */}
      <Card className="bg-surface overflow-hidden">
        <div className="bg-accent p-6">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-5 text-white" />
            <h2 className="text-xl font-bold text-white">{t("appName")} v{process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0"}</h2>
          </div>
          <p className="text-sm text-white/80 mt-1">
            {t("downloadAppDesc")}
          </p>
        </div>
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-lg bg-overlay-2 border border-overlay-6">
              <p className="text-lg font-bold text-accent">18</p>
              <p className="text-xs text-text-tertiary">{t("supportedEngines")}</p>
            </div>
            <div className="p-3 rounded-lg bg-overlay-2 border border-overlay-6">
              <p className="text-lg font-bold text-accent">6</p>
              <p className="text-xs text-text-tertiary">{t("aiProviders")}</p>
            </div>
            <div className="p-3 rounded-lg bg-overlay-2 border border-overlay-6">
              <p className="text-lg font-bold text-accent">2</p>
              <p className="text-xs text-text-tertiary">{t("offlineModels")}</p>
            </div>
          </div>

          {/* Supported engines list */}
          <div className="flex flex-wrap gap-1.5">
            {["UE4/5", "RPG Maker", "Wolf RPG", "Unity", "Mumu", "DXLib", "Ren'Py", "KiriKiri", "NScripter", "YU-RIS"].map((e) => (
              <span key={e} className="px-2 py-0.5 rounded text-[10px] font-medium bg-overlay-4 text-text-secondary">
                {e}
              </span>
            ))}
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-accent-muted text-accent">
              {t("andMore")}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* License Verification */}
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyIcon className="size-5 text-accent" />
            {t("licenseAuth")}
          </CardTitle>
          <CardDescription>
            {t("licenseAuthDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <input
              type="text"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={licenseKey}
              onChange={(e) => {
                setLicenseKey(e.target.value)
                setVerified(null)
                setVerifyError("")
                setDownloadLink("")
              }}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              className="w-full h-11 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all tracking-wider text-center"
            />
          </div>

          {/* Verify Result */}
          {verified && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/20">
              <CheckCircleIcon className="size-4 text-success shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-success">{t("verified")}</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  {formatExpiry(verified.expires_at, verified.unlimited)}
                </p>
              </div>
            </div>
          )}

          {verifyError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-error/10 border border-error/20">
              <XCircleIcon className="size-4 text-error shrink-0" />
              <p className="text-sm text-error">{verifyError}</p>
            </div>
          )}

          {/* Action Buttons */}
          {!verified ? (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={handleVerify}
              loading={verifying}
              disabled={!licenseKey.trim()}
            >
              <ShieldCheckIcon className="size-4" />
              {t("verify")}
            </Button>
          ) : (
            <div className="space-y-2">
              <Button
                variant="default"
                size="md"
                className="w-full"
                onClick={handleDownload}
                loading={downloading}
              >
                <DownloadIcon className="size-5" />
                {t("windowsDownload")}
              </Button>

              {downloadLink && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={downloadLink}
                    readOnly
                    className="flex-1 h-9 px-3 rounded-lg border border-border bg-surface-elevated text-text-tertiary text-xs font-mono truncate"
                  />
                  <Button variant="ghost" size="sm" onClick={handleCopyLink}>
                    {copied ? (
                      <ClipboardCheckIcon className="size-4 text-success" />
                    ) : (
                      <CopyIcon className="size-4" />
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fanbox */}
      <Card className="bg-surface">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">{t("fanboxSubscriber")}</p>
            <p className="text-xs text-text-tertiary mt-0.5">
              {t("fanboxAutoAuth")}
            </p>
          </div>
          <a
            href={FANBOX_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="ghost" size="sm">
              <ExternalLinkIcon className="size-4" />
              Fanbox
            </Button>
          </a>
        </CardContent>
      </Card>

      {/* Purchase Info */}
      <div className="rounded-lg p-4 bg-overlay-2 border border-overlay-4">
        <p className="text-xs text-text-tertiary leading-relaxed">
          {t("fanboxPurchaseInfo")}
        </p>
      </div>
    </div>
  )
}
