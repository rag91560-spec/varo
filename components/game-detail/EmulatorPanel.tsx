"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  SmartphoneIcon,
  Loader2Icon,
  WifiIcon,
  WifiOffIcon,
  DownloadIcon,
  PowerIcon,
  PowerOffIcon,
  XCircleIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale, type TranslationKey } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import type { EmulatorStatus, SdkStatus, SdkSetupProgress, Game } from "@/lib/types"

interface EmulatorPanelProps {
  gameId: number
  game: Game
}

export function EmulatorPanel({ gameId, game }: EmulatorPanelProps) {
  const { t } = useLocale()

  const [emuStatus, setEmuStatus] = useState<EmulatorStatus | null>(null)
  const [sdkStatus, setSdkStatus] = useState<SdkStatus | null>(null)
  const [sdkSetupProgress, setSdkSetupProgress] = useState<SdkSetupProgress | null>(null)
  const [startingEmulator, setStartingEmulator] = useState(false)
  const [reinstalling, setReinstalling] = useState(false)
  const emuPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const emuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const androidCheckedRef = useRef<number | null>(null)

  // Fetch emulator status for Android games (only once per game)
  useEffect(() => {
    if (game.id && androidCheckedRef.current !== game.id) {
      androidCheckedRef.current = game.id
      api.android.emulatorStatus().then(setEmuStatus).catch((e) => console.error("Emulator status failed:", e))
      api.android.sdkStatus().then(setSdkStatus).catch((e) => console.error("SDK status failed:", e))
    }
  }, [game.id])

  // Cleanup timers and EventSource on unmount
  useEffect(() => {
    return () => {
      if (emuPollRef.current) clearInterval(emuPollRef.current)
      if (emuTimeoutRef.current) clearTimeout(emuTimeoutRef.current)
      if (eventSourceRef.current) eventSourceRef.current.close()
    }
  }, [])

  const handleConnectEmulator = useCallback(async () => {
    if (!emuStatus?.emulators.length) return
    const port = emuStatus.emulators[0].adb_port
    try {
      await api.android.connectEmulator(port)
      const status = await api.android.emulatorStatus()
      setEmuStatus(status)
    } catch (e) { console.error("Connect emulator failed:", e) }
  }, [emuStatus])

  const handleSetupEmulator = useCallback(async () => {
    try {
      await api.android.setupEmulator()
    } catch { return }

    // Listen to SSE for progress
    const url = api.android.setupStatusUrl()
    const es = new EventSource(url)
    eventSourceRef.current = es
    es.addEventListener("status", (e) => {
      try {
        const data: SdkSetupProgress = JSON.parse(e.data)
        setSdkSetupProgress(data)
        if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
          es.close()
          eventSourceRef.current = null
          setSdkSetupProgress(null)
          api.android.sdkStatus().then(setSdkStatus).catch(() => {})
          api.android.emulatorStatus().then(setEmuStatus).catch(() => {})
        }
      } catch { /* ignore malformed SSE data */ }
    })
    es.onerror = () => { es.close(); eventSourceRef.current = null; setSdkSetupProgress(null) }
  }, [])

  const handleCancelSetup = useCallback(async () => {
    try { await api.android.setupEmulatorCancel() } catch (e) { console.error("Cancel setup failed:", e) }
  }, [])

  const handleStartEmulator = useCallback(async () => {
    setStartingEmulator(true)
    try {
      await api.android.startEmulator()
      // Poll for ready state
      const poll = setInterval(async () => {
        const status = await api.android.emulatorStatus()
        setEmuStatus(status)
        const sdk = await api.android.sdkStatus()
        setSdkStatus(sdk)
        if (status.devices.some(d => d.status === "device")) {
          clearInterval(poll)
          emuPollRef.current = null
          if (emuTimeoutRef.current) { clearTimeout(emuTimeoutRef.current); emuTimeoutRef.current = null }
          setStartingEmulator(false)
        }
      }, 3000)
      emuPollRef.current = poll
      // Safety timeout
      const timeout = setTimeout(() => { clearInterval(poll); emuPollRef.current = null; emuTimeoutRef.current = null; setStartingEmulator(false) }, 120000)
      emuTimeoutRef.current = timeout
    } catch {
      setStartingEmulator(false)
    }
  }, [])

  const handleStopEmulator = useCallback(async () => {
    try {
      await api.android.stopEmulator()
      const status = await api.android.emulatorStatus()
      setEmuStatus(status)
      const sdk = await api.android.sdkStatus()
      setSdkStatus(sdk)
    } catch (e) { console.error("Stop emulator failed:", e) }
  }, [])

  return (
    <div className="rounded-lg p-5 bg-overlay-2 border border-overlay-6">
      <div className="flex items-center gap-2 mb-4">
        <SmartphoneIcon className="size-5 text-emerald-500" />
        <h2 className="text-base font-semibold text-text-primary">{t("emulatorStatus")}</h2>
      </div>

      {sdkStatus === null ? (
        <Loader2Icon className="size-5 text-text-tertiary animate-spin" />
      ) : !sdkStatus.installed ? (
        /* SDK not installed -- show setup UI */
        <div className="space-y-4">
          {sdkSetupProgress ? (
            /* Setup in progress */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">
                  {sdkSetupProgress.status === "downloading" ? t("downloadingCmdlineTools")
                    : sdkSetupProgress.status === "installing_sdk" ? t("installingSdkComponents")
                    : sdkSetupProgress.status === "creating_avd" ? t("creatingAvd")
                    : sdkSetupProgress.step_detail}
                </span>
                <span className="text-sm font-mono text-accent font-bold">
                  {Math.round(sdkSetupProgress.progress)}%
                </span>
              </div>
              <div className="h-2.5 bg-surface-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: `${sdkSetupProgress.progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-tertiary">{sdkSetupProgress.step_detail}</span>
                <div className="flex items-center gap-3">
                  {sdkSetupProgress.speed_bps > 0 && (
                    <span className="text-xs text-text-secondary font-mono">
                      {(sdkSetupProgress.speed_bps / 1024 / 1024).toFixed(1)} MB/s
                    </span>
                  )}
                  {sdkSetupProgress.eta_seconds > 0 && (
                    <span className="text-xs text-text-tertiary">
                      {sdkSetupProgress.eta_seconds > 60
                        ? `${Math.ceil(sdkSetupProgress.eta_seconds / 60)}${t("minutesUnit")} ${t("remaining")}`
                        : `${Math.round(sdkSetupProgress.eta_seconds)}${t("secondsUnit")} ${t("remaining")}`}
                    </span>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleCancelSetup}>
                <XCircleIcon className="size-4" /> {t("cancelSetup")}
              </Button>
            </div>
          ) : (
            /* Not started -- show install button */
            <div className="text-center py-4 space-y-3">
              <DownloadIcon className="size-10 text-text-tertiary mx-auto" />
              <p className="text-sm font-medium text-text-primary">{t("emulatorSetupRequired")}</p>
              <p className="text-xs text-text-tertiary">{t("emulatorSetupDesc")}</p>
              <Button variant="accent" size="sm" onClick={handleSetupEmulator}>
                <DownloadIcon className="size-4" /> {t("setupEmulator")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* SDK installed */
        <div className="space-y-3">
          {/* ADB Status */}
          {emuStatus && (
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${emuStatus.adb_available ? "bg-success" : "bg-error"}`} />
              <span className="text-sm text-text-secondary">
                ADB: {emuStatus.adb_available ? emuStatus.adb_path : t("adbNotFound")}
              </span>
            </div>
          )}

          {/* Emulator state */}
          {sdkStatus.emulator_running ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-overlay-4">
                <div className="flex items-center gap-2">
                  <WifiIcon className="size-4 text-success" />
                  <span className="text-sm text-text-primary font-medium">{t("emulatorReady")}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={handleStopEmulator}>
                  <PowerOffIcon className="size-4" /> {t("stopEmulator")}
                </Button>
              </div>

              {/* Connected devices */}
              {emuStatus && emuStatus.devices.length > 0 && (
                <div className="text-xs text-text-secondary">
                  {emuStatus.devices.filter(d => d.status === "device").length} device(s) connected
                </div>
              )}

              {/* Connect if emulator running but no device connected */}
              {emuStatus && emuStatus.emulators.some(e => e.status === "running") && emuStatus.devices.filter(d => d.status === "device").length === 0 && (
                <Button variant="secondary" size="sm" onClick={handleConnectEmulator}>
                  <WifiIcon className="size-4" /> {t("connectEmulator")}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-overlay-4">
                <div className="flex items-center gap-2">
                  <WifiOffIcon className="size-4 text-text-tertiary" />
                  <span className="text-sm text-text-primary font-medium">{t("emulatorNotRunning")}</span>
                </div>
              </div>
              <Button variant="accent" size="sm" onClick={handleStartEmulator} loading={startingEmulator}>
                {startingEmulator ? (
                  <><Loader2Icon className="size-4 animate-spin" /> {t("emulatorStarting")}</>
                ) : (
                  <><PowerIcon className="size-4" /> {t("startEmulator")}</>
                )}
              </Button>
            </div>
          )}

          {/* External emulators (non-embedded) */}
          {emuStatus && emuStatus.emulators.filter(e => e.type !== "embedded").length > 0 && (
            <div className="space-y-2 mt-2 pt-2 border-t border-overlay-4">
              {emuStatus.emulators.filter(e => e.type !== "embedded").map((emu, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-overlay-4">
                  <div className="flex items-center gap-2">
                    {emu.status === "running" ? (
                      <WifiIcon className="size-4 text-success" />
                    ) : (
                      <WifiOffIcon className="size-4 text-text-tertiary" />
                    )}
                    <span className="text-sm text-text-primary font-medium">{emu.name}</span>
                    <span className="text-xs text-text-tertiary">:{emu.adb_port}</span>
                  </div>
                  <span className={`text-xs font-medium ${emu.status === "running" ? "text-success" : "text-text-tertiary"}`}>
                    {emu.status === "running" ? t("emulatorConnected") : t("emulatorNotRunning")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Translation not available notice */}
      <p className="mt-4 text-xs text-text-tertiary border-t border-overlay-4 pt-3">
        {t("translationNotAvailable")}
      </p>
    </div>
  )
}
