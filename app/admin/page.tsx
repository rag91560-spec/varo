"use client"

import { useState, useEffect, useCallback } from "react"
import { useLocale } from "@/hooks/use-locale"
import {
  ShieldCheckIcon,
  UsersIcon,
  GamepadIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  Loader2Icon,
  RefreshCwIcon,
  XCircleIcon,
  HashIcon,
  LanguagesIcon,
  DatabaseIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { api } from "@/lib/api"
import type { AdminUser, AdminGame } from "@/lib/types"

function maskKey(key: string): string {
  if (key.length <= 8) return key
  return key.slice(0, 4) + "****" + key.slice(-4)
}

function pct(translated: number, total: number): number {
  return total > 0 ? Math.round((translated / total) * 100) : 0
}

export default function AdminPage() {
  const { t } = useLocale()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedUser, setExpandedUser] = useState<number | null>(null)
  const [userGames, setUserGames] = useState<Record<number, AdminGame[]>>({})
  const [loadingGames, setLoadingGames] = useState<number | null>(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.sync.adminUsers()
      setUsers(res.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const toggleUser = useCallback(
    async (userId: number) => {
      if (expandedUser === userId) {
        setExpandedUser(null)
        return
      }
      setExpandedUser(userId)
      if (!userGames[userId]) {
        setLoadingGames(userId)
        try {
          const res = await api.sync.adminUserGames(userId)
          setUserGames((prev) => ({ ...prev, [userId]: res.games }))
        } catch {
          /* ignore */
        } finally {
          setLoadingGames(null)
        }
      }
    },
    [expandedUser, userGames]
  )

  const totalUsers = users.length
  const totalGames = users.reduce((s, u) => s + u.game_count, 0)
  const totalStrings = users.reduce((s, u) => s + u.total_strings, 0)
  const totalTM = users.reduce((s, u) => s + u.tm_count, 0)

  // Permission denied
  if (error?.includes("403") || error?.includes("권한")) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-3">
        <XCircleIcon className="size-12 text-text-tertiary" />
        <p className="text-text-secondary">{t("adminNoPermission")}</p>
        <p className="text-xs text-text-tertiary">
          {t("adminNoPermissionHint")}
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight flex items-center gap-2">
            <ShieldCheckIcon className="size-6 text-accent" />
            {t("adminTitle")}
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {t("adminDesc")}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={loadUsers} loading={loading}>
          <RefreshCwIcon className="size-4" />
          {t("refresh")}
        </Button>
      </div>

      {/* Loading state */}
      {loading && users.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2Icon className="size-8 text-accent animate-spin" />
        </div>
      ) : error ? (
        <Card className="bg-surface">
          <CardContent className="p-6 text-center">
            <p className="text-text-secondary">{error}</p>
            <Button variant="secondary" size="sm" onClick={loadUsers} className="mt-3">
              {t("tryAgain")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                icon: UsersIcon,
                label: t("totalUsers"),
                value: totalUsers.toLocaleString(),
                highlight: true,
              },
              {
                icon: GamepadIcon,
                label: t("totalGamesCount"),
                value: totalGames.toLocaleString(),
                highlight: false,
              },
              {
                icon: HashIcon,
                label: t("totalTranslatedStrings"),
                value: totalStrings.toLocaleString(),
                highlight: false,
              },
              {
                icon: DatabaseIcon,
                label: t("totalTmEntries"),
                value: totalTM.toLocaleString(),
                highlight: false,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6"
              >
                <stat.icon className="size-4 text-text-tertiary mx-auto mb-2" />
                <p className="text-2xl font-bold text-text-primary">
                  {stat.highlight ? (
                    <span className="text-accent">{stat.value}</span>
                  ) : (
                    stat.value
                  )}
                </p>
                <p className="text-xs text-text-tertiary mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* User list */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <UsersIcon className="size-5 text-accent" />
              <h2 className="text-base font-semibold text-text-primary">
                {t("users")} ({users.length})
              </h2>
            </div>

            {users.map((user) => {
              const isExpanded = expandedUser === user.id
              const games = userGames[user.id]
              const rate = pct(user.total_translated, user.total_strings)

              return (
                <div key={user.id}>
                  <button
                    onClick={() => toggleUser(user.id)}
                    className={`w-full rounded-lg p-4 text-left transition-all duration-150 border ${
                      isExpanded
                        ? "bg-accent/5 border-accent/15"
                        : "bg-overlay-2 border-overlay-6 hover:bg-overlay-6"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDownIcon className="size-4 text-accent shrink-0" />
                      ) : (
                        <ChevronRightIcon className="size-4 text-text-tertiary shrink-0" />
                      )}
                      <div className="flex-1 min-w-0 grid grid-cols-5 gap-4 items-center">
                        <div>
                          <p className="text-sm font-mono text-text-primary truncate">
                            {maskKey(user.license_key)}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-text-tertiary">{t("version")}</p>
                          <p className="text-sm text-text-primary font-mono">
                            {user.app_version || "-"}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-text-tertiary">{t("games")}</p>
                          <p className="text-sm text-text-primary font-bold">
                            {user.game_count}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-text-tertiary">{t("translationRate")}</p>
                          <p
                            className={`text-sm font-bold ${
                              rate >= 80
                                ? "text-accent"
                                : rate > 0
                                  ? "text-yellow-400"
                                  : "text-text-tertiary"
                            }`}
                          >
                            {rate}%
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] text-text-tertiary">
                            {user.last_sync_at
                              ? new Date(user.last_sync_at).toLocaleDateString()
                              : "-"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded: user's games */}
                  {isExpanded && (
                    <div className="ml-7 mt-1 rounded-lg overflow-hidden border border-overlay-6">
                      {loadingGames === user.id ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2Icon className="size-5 text-accent animate-spin" />
                        </div>
                      ) : games && games.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-overlay-2 border-b border-overlay-6">
                              <th className="text-left px-4 py-2 text-xs text-text-tertiary font-medium">
                                {t("games")}
                              </th>
                              <th className="text-center px-3 py-2 text-xs text-text-tertiary font-medium">
                                {t("engineLabel")}
                              </th>
                              <th className="text-center px-3 py-2 text-xs text-text-tertiary font-medium">
                                {t("progressLabel")}
                              </th>
                              <th className="text-center px-3 py-2 text-xs text-text-tertiary font-medium">
                                {t("status")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {games.map((g) => {
                              const gPct = pct(g.translated_count, g.string_count)
                              return (
                                <tr
                                  key={g.id}
                                  className="border-b border-overlay-6 last:border-b-0"
                                >
                                  <td className="px-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <GamepadIcon className="size-3.5 text-text-tertiary shrink-0" />
                                      <span className="text-text-primary truncate max-w-[200px]">
                                        {g.title}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-center text-text-secondary text-xs font-mono">
                                    {g.engine || "-"}
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    <div className="flex items-center gap-2 justify-center">
                                      <div className="w-16 h-1.5 bg-overlay-6 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-accent rounded-full"
                                          style={{ width: `${gPct}%` }}
                                        />
                                      </div>
                                      <span className="text-xs text-text-secondary font-mono w-8 text-right">
                                        {gPct}%
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span
                                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                        g.status === "applied"
                                          ? "bg-green-500/15 text-green-400"
                                          : g.status === "translated"
                                            ? "bg-accent/15 text-accent"
                                            : "bg-overlay-6 text-text-tertiary"
                                      }`}
                                    >
                                      {g.status || "idle"}
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      ) : (
                        <div className="py-6 text-center text-xs text-text-tertiary">
                          {t("noGamesRegistered")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {users.length === 0 && (
              <div className="py-12 text-center">
                <UsersIcon className="size-10 text-text-tertiary/30 mx-auto" />
                <p className="text-sm text-text-tertiary mt-3">
                  {t("noSyncedUsers")}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
