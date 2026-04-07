"use client"

import { useState, useCallback, type ReactNode } from "react"
import { LockIcon, ExternalLinkIcon, ChevronDownIcon, Loader2Icon, CheckCircleIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"

const FANBOX_URL = process.env.NEXT_PUBLIC_FANBOX_URL || "https://minhyung.fanbox.cc"

interface PaywallProps {
  show: boolean
  children: ReactNode
  onLicenseVerified?: () => void
  onDismiss?: () => void
  /** Allow user to dismiss the paywall with X button (default: true) */
  dismissable?: boolean
}

export function Paywall({ show, children, onLicenseVerified, onDismiss, dismissable = true }: PaywallProps) {
  const { t } = useLocale()
  const [dismissed, setDismissed] = useState(false)
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [key, setKey] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState("")

  const handleVerify = useCallback(async () => {
    const trimmed = key.trim()
    if (!trimmed) return
    setVerifying(true)
    setError("")
    try {
      // Save key to settings first, then verify
      const current = await api.settings.get()
      await api.settings.put({ ...current, license_key: trimmed })
      const result = await api.license.verify()
      if (result.valid) {
        onLicenseVerified?.()
      } else {
        setError(t("licenseInvalid"))
      }
    } catch {
      setError(t("serverConnectionFailed"))
    } finally {
      setVerifying(false)
    }
  }, [key, onLicenseVerified, t])

  if (!show || (dismissable && dismissed)) return <>{children}</>

  return (
    <div className="relative">
      {/* Blurred content */}
      <div className="blur-[8px] opacity-30 pointer-events-none select-none" aria-hidden>
        {children}
      </div>

      {/* Overlay card */}
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <Card className="bg-surface/95 backdrop-blur-sm border-overlay-6 w-full max-w-sm mx-4 shadow-xl relative">
          {dismissable && (
            <button
              onClick={() => { setDismissed(true); onDismiss?.() }}
              className="absolute top-3 right-3 p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors"
            >
              <XIcon className="size-4" />
            </button>
          )}
          <CardContent className="p-6 space-y-4 text-center">
            <div className="mx-auto size-12 rounded-full bg-accent/10 flex items-center justify-center">
              <LockIcon className="size-6 text-accent" />
            </div>

            <div>
              <h3 className="text-base font-semibold text-text-primary">{t("paywallTitle")}</h3>
              <p className="text-sm text-text-secondary mt-1">{t("paywallDesc")}</p>
            </div>

            {/* Subscribe button */}
            <a
              href={FANBOX_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <Button variant="default" size="md" className="w-full">
                <ExternalLinkIcon className="size-4" />
                {t("subscribeFanbox")}
              </Button>
            </a>

            {/* Already subscriber toggle */}
            <div>
              <button
                onClick={() => setShowKeyInput((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
              >
                {t("alreadySubscriber")}
                <ChevronDownIcon className={`size-3 transition-transform duration-200 ${showKeyInput ? "rotate-180" : ""}`} />
              </button>

              {showKeyInput && (
                <div className="mt-3 space-y-2">
                  <input
                    type="text"
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    value={key}
                    onChange={(e) => { setKey(e.target.value); setError("") }}
                    onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all text-center tracking-wider"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={handleVerify}
                    disabled={!key.trim() || verifying}
                  >
                    {verifying ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <CheckCircleIcon className="size-4" />
                    )}
                    {t("licenseVerify")}
                  </Button>
                  {error && (
                    <p className="text-xs text-error">{error}</p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
