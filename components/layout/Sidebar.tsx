"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LanguagesIcon,
  LibraryIcon,
  SettingsIcon,
  BrainCircuitIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  GlobeIcon,
  SlidersHorizontalIcon,
  DatabaseIcon,
  ShieldCheckIcon,
  DownloadIcon,
  ScanEyeIcon,
  PlayCircleIcon,
  BookOpenIcon,
  ChevronDownIcon,
  Gamepad2Icon,
  MusicIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/use-theme"
import type { Theme } from "@/hooks/use-theme"
import { useLocale } from "@/hooks/use-locale"
import type { TranslationKey } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import type { SdkSetupProgress } from "@/lib/types"

interface NavItem {
  readonly labelKey: TranslationKey
  readonly href: string
  readonly icon: React.ComponentType<{ className?: string }>
  readonly group?: string
  readonly badge?: string
}

const LIBRARY_SUB_ITEMS: readonly NavItem[] = [
  { labelKey: "games", href: "/library", icon: Gamepad2Icon },
  { labelKey: "videos", href: "/videos", icon: PlayCircleIcon },
  { labelKey: "audio", href: "/audio", icon: MusicIcon },
  { labelKey: "manga", href: "/manga", icon: BookOpenIcon },
]

const LIBRARY_PATHS = LIBRARY_SUB_ITEMS.map(i => i.href)

const NAV_ITEMS: readonly NavItem[] = [
  { labelKey: "translate", href: "/translate", icon: LanguagesIcon },
  { labelKey: "liveTranslation", href: "/live", icon: ScanEyeIcon },
  { labelKey: "presets", href: "/presets", icon: SlidersHorizontalIcon, group: "tools" },
  { labelKey: "translationMemory", href: "/memory", icon: DatabaseIcon, group: "tools" },
  { labelKey: "models", href: "/models", icon: BrainCircuitIcon, group: "tools", badge: "예정" },
  { labelKey: "settings", href: "/settings", icon: SettingsIcon, group: "system" },
  { labelKey: "download", href: "/download", icon: DownloadIcon, group: "system" },
  { labelKey: "admin", href: "/admin", icon: ShieldCheckIcon, group: "system" },
]

function TranslatorLogo({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5", className)}
      aria-hidden="true"
    >
      <path d="M5 8l6 6" />
      <path d="M4 14l6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  )
}

function useSdkAutoSetup() {
  const [progress, setProgress] = React.useState<SdkSetupProgress | null>(null)

  React.useEffect(() => {
    let cancelled = false
    let eventSource: EventSource | null = null

    async function check() {
      try {
        // Only subscribe to progress if setup is already actively running.
        // Do NOT auto-trigger setup — users must start it explicitly from Settings.
        // (Auto-triggering caused confusing "license acceptance failed" errors for all users.)
        const active = await api.android.activeSetup()
        if (cancelled || !active) return

        eventSource = new EventSource(api.android.setupStatusUrl())
        eventSource.addEventListener("status", (e) => {
          if (cancelled) return
          try {
            const data: SdkSetupProgress = JSON.parse(e.data)
            setProgress(data)
            if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
              eventSource?.close()
              eventSource = null
              if (data.status === "completed") {
                setTimeout(() => { if (!cancelled) setProgress(null) }, 3000)
              }
            }
          } catch { /* ignore parse errors */ }
        })
        eventSource.onerror = () => {
          eventSource?.close()
          eventSource = null
        }
      } catch {
        // Backend not reachable yet — ignore
      }
    }

    check()
    return () => {
      cancelled = true
      eventSource?.close()
    }
  }, [])

  return progress
}

export function Sidebar() {
  const pathname = usePathname()
  const { t, locale, toggleLocale } = useLocale()
  const { theme, setTheme } = useTheme()
  const [isElectron, setIsElectron] = React.useState(false)
  const sdkProgress = useSdkAutoSetup()
  const isLibraryPath = LIBRARY_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))
  const [libraryOpen, setLibraryOpen] = React.useState(true)

  // Auto-expand when navigating to a library path
  React.useEffect(() => {
    if (isLibraryPath) setLibraryOpen(true)
  }, [isLibraryPath])

  React.useEffect(() => {
    if (window.electronAPI?.isElectron) {
      setIsElectron(true)
    }
  }, [])

  const cycleTheme = React.useCallback(() => {
    const order: Theme[] = ["dark", "light", "system"]
    const idx = order.indexOf(theme)
    setTheme(order[(idx + 1) % order.length])
  }, [theme, setTheme])

  const themeIcon =
    theme === "dark" ? <MoonIcon className="size-4" />
    : theme === "light" ? <SunIcon className="size-4" />
    : <MonitorIcon className="size-4" />

  const themeLabel =
    theme === "dark" ? t("darkMode")
    : theme === "light" ? t("lightMode")
    : t("systemMode")

  // Group nav items
  const mainItems = NAV_ITEMS.filter(i => !i.group)
  const toolItems = NAV_ITEMS.filter(i => i.group === "tools")
  const systemItems = NAV_ITEMS.filter(i => i.group === "system")

  const renderNavItem = (item: NavItem) => {
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
    const Icon = item.icon
    return (
      <Link
        key={item.labelKey}
        href={item.href}
        title={t(item.labelKey)}
        className={cn(
          "flex items-center gap-2.5 rounded-lg text-[13px] transition-all duration-150",
          "justify-center md:justify-start px-0 md:px-3 py-2.5 md:py-[7px]",
          isActive
            ? "text-foreground font-medium bg-accent-muted shadow-[inset_0_0_0_1px_var(--accent-muted)]"
            : "text-text-secondary hover:text-text-primary hover:bg-overlay-4"
        )}
      >
        <Icon className={cn("size-[18px] shrink-0", isActive ? "text-accent" : "text-inherit")} />
        <span className="hidden md:inline">{t(item.labelKey)}</span>
        {item.badge && (
          <span className="hidden md:inline ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25">
            {item.badge}
          </span>
        )}
      </Link>
    )
  }

  const showSdkProgress = sdkProgress && sdkProgress.status !== "completed" && sdkProgress.status !== "idle"

  return (
    <aside className={cn(
      "flex flex-col shrink-0 sticky top-0 h-screen bg-sidebar-bg border-r border-border-subtle",
      "w-14 md:w-[200px]"
    )}>
      {/* Logo — drag region in Electron */}
      <div className={cn(
        "flex items-center gap-2.5 px-3 md:px-4 h-14 shrink-0 sidebar-drag-region border-b border-border-subtle",
        isElectron && "electron-titlebar-pad"
      )}>
        <Link href="/" className="flex items-center gap-2.5">
          <TranslatorLogo className="text-accent shrink-0" />
          <span className="hidden md:inline text-sm font-bold text-text-primary tracking-tight">
            번<span className="text-accent">@</span>역<span className="text-accent">+</span>기<span className="text-accent">!</span>
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto pt-3 pb-2" aria-label="Main navigation">
        {/* Library collapsible group */}
        <div className="px-1.5 md:px-2.5 space-y-0.5">
          {/* Mobile: icon-only link to /library */}
          <Link
            href="/library"
            title={t("library")}
            className={cn(
              "flex items-center justify-center rounded-lg text-[13px] transition-all duration-150 md:hidden",
              "px-0 py-2.5",
              isLibraryPath
                ? "text-foreground font-medium bg-accent-muted shadow-[inset_0_0_0_1px_var(--accent-muted)]"
                : "text-text-secondary hover:text-text-primary hover:bg-overlay-4"
            )}
          >
            <LibraryIcon className={cn("size-[18px] shrink-0", isLibraryPath ? "text-accent" : "text-inherit")} />
          </Link>
          {/* Desktop: collapsible header */}
          <button
            type="button"
            onClick={() => setLibraryOpen(prev => !prev)}
            className={cn(
              "hidden md:flex w-full items-center gap-2.5 rounded-lg text-[13px] transition-all duration-150",
              "px-3 py-[7px]",
              isLibraryPath
                ? "text-foreground font-medium"
                : "text-text-secondary hover:text-text-primary hover:bg-overlay-4"
            )}
          >
            <LibraryIcon className={cn("size-[18px] shrink-0", isLibraryPath ? "text-accent" : "text-inherit")} />
            <span>{t("library")}</span>
            <ChevronDownIcon className={cn(
              "size-3.5 ml-auto transition-transform duration-200",
              !libraryOpen && "-rotate-90"
            )} />
          </button>
          {/* Desktop: sub-items */}
          {libraryOpen && (
            <div className="hidden md:block space-y-0.5">
              {LIBRARY_SUB_ITEMS.map(item => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                const Icon = item.icon
                return (
                  <Link
                    key={item.labelKey}
                    href={item.href}
                    title={t(item.labelKey)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg text-[13px] transition-all duration-150",
                      "pl-7 pr-3 py-[7px]",
                      isActive
                        ? "text-foreground font-medium bg-accent-muted shadow-[inset_0_0_0_1px_var(--accent-muted)]"
                        : "text-text-secondary hover:text-text-primary hover:bg-overlay-4"
                    )}
                  >
                    <Icon className={cn("size-[18px] shrink-0", isActive ? "text-accent" : "text-inherit")} />
                    <span>{t(item.labelKey)}</span>
                  </Link>
                )
              })}
            </div>
          )}
          {/* Main nav items (translate, live) */}
          {mainItems.map(renderNavItem)}
        </div>

        {/* Tools separator */}
        <div className="mx-3 md:mx-4 my-3 h-px bg-border-subtle" />
        <div className="hidden md:block px-4 mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">{t("tools")}</span>
        </div>
        <div className="px-1.5 md:px-2.5 space-y-0.5">
          {toolItems.map(renderNavItem)}
        </div>

        {/* System separator */}
        <div className="mx-3 md:mx-4 my-3 h-px bg-border-subtle" />
        <div className="px-1.5 md:px-2.5 space-y-0.5">
          {systemItems.map(renderNavItem)}
        </div>
      </nav>

      {/* SDK setup progress */}
      {showSdkProgress && (
        <div className="shrink-0 px-2 pb-2 hidden md:block">
          <div className="text-[10px] text-text-tertiary truncate">
            {sdkProgress.status === "failed"
              ? `Setup failed: ${sdkProgress.error ?? "unknown"}`
              : sdkProgress.step_detail}
          </div>
          <div className="h-1 bg-overlay-4 rounded mt-1">
            <div
              className={cn(
                "h-full rounded transition-all duration-300",
                sdkProgress.status === "failed" ? "bg-red-500" : "bg-accent"
              )}
              style={{ width: `${Math.max(sdkProgress.progress, 1)}%` }}
            />
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div className="shrink-0 border-t border-border-subtle">
        <div className="flex flex-col items-center gap-1 py-2 md:hidden">
          <button
            onClick={cycleTheme}
            className="size-9 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-colors"
            title={themeLabel}
          >
            {themeIcon}
          </button>
          <button
            onClick={toggleLocale}
            className="size-9 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-colors"
            title={locale === "ko" ? "Switch to English" : "한국어로 전환"}
          >
            <GlobeIcon className="size-4" />
          </button>
        </div>
        <div className="hidden md:flex items-center gap-1 px-3 py-2.5">
          <button
            onClick={cycleTheme}
            className="flex-1 flex items-center gap-1.5 text-text-tertiary hover:text-text-primary text-xs py-1 px-1.5 rounded transition-colors"
          >
            {themeIcon}
            <span>{themeLabel}</span>
          </button>
          <button
            onClick={toggleLocale}
            className="flex items-center gap-1 text-text-tertiary hover:text-text-primary text-xs py-1 px-1.5 rounded transition-colors"
          >
            <GlobeIcon className="size-3.5" />
            <span>{locale === "ko" ? "KR" : "EN"}</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
