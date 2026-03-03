"use client"

import { useState, useEffect, useCallback } from "react"
import {
  ShieldCheckIcon,
  UsersIcon,
  GamepadIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  Loader2Icon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"
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
      setError(err instanceof Error ? err.message : "데이터를 불러올 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const toggleUser = useCallback(async (userId: number) => {
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
        // ignore
      } finally {
        setLoadingGames(null)
      }
    }
  }, [expandedUser, userGames])

  // Permission denied
  if (error?.includes("403") || error?.includes("권한")) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-3">
        <XCircleIcon className="size-12 text-text-tertiary" />
        <p className="text-text-secondary">관리자 권한이 없습니다</p>
        <p className="text-xs text-text-tertiary">설정에서 관리자 라이선스 키를 입력하세요</p>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight flex items-center gap-2">
            <ShieldCheckIcon className="size-6 text-accent" />
            {t("admin")}
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            사용자 동기화 데이터 및 번역 현황
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={loadUsers} loading={loading}>
          <RefreshCwIcon className="size-4" />
          새로고침
        </Button>
      </div>

      {loading && users.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2Icon className="size-8 text-accent animate-spin" />
        </div>
      ) : error ? (
        <Card className="bg-surface">
          <CardContent className="p-6 text-center">
            <p className="text-text-secondary">{error}</p>
            <Button variant="secondary" size="sm" onClick={loadUsers} className="mt-3">
              다시 시도
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "총 사용자", value: users.length },
              {
                label: "총 게임",
                value: users.reduce((s, u) => s + u.game_count, 0),
              },
              {
                label: "총 문자열",
                value: users
                  .reduce((s, u) => s + u.total_strings, 0)
                  .toLocaleString(),
              },
              {
                label: "총 번역",
                value: users
                  .reduce((s, u) => s + u.total_translated, 0)
                  .toLocaleString(),
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg p-4 text-center"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <p className="text-xs text-text-tertiary">{stat.label}</p>
                <p className="text-lg font-bold text-text-primary mt-1">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* User list */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <UsersIcon className="size-5 text-accent" />
              <h2 className="text-base font-semibold text-text-primary">
                사용자 ({users.length})
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
                    className="w-full rounded-lg p-4 text-left transition-all duration-150"
                    style={{
                      background: isExpanded
                        ? "rgba(91,94,240,0.06)"
                        : "rgba(255,255,255,0.02)",
                      border: `1px solid ${isExpanded ? "rgba(91,94,240,0.15)" : "rgba(255,255,255,0.06)"}`,
                    }}
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
                          <p className="text-xs text-text-tertiary">버전</p>
                          <p className="text-sm text-text-primary font-mono">
                            {user.app_version || "-"}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-text-tertiary">게임</p>
                          <p className="text-sm text-text-primary font-bold">
                            {user.game_count}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-text-tertiary">번역률</p>
                          <p
                            className={`text-sm font-bold ${rate >= 80 ? "text-accent" : rate > 0 ? "text-yellow-400" : "text-text-tertiary"}`}
                          >
                            {rate}%
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] text-text-tertiary">
                            {user.last_sync_at
                              ? new Date(user.last_sync_at).toLocaleDateString("ko")
                              : "-"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Expanded: user's games */}
                  {isExpanded && (
                    <div
                      className="ml-7 mt-1 rounded-lg overflow-hidden"
                      style={{
                        border: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      {loadingGames === user.id ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2Icon className="size-5 text-accent animate-spin" />
                        </div>
                      ) : games && games.length > 0 ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr
                              style={{
                                background: "rgba(255,255,255,0.03)",
                                borderBottom:
                                  "1px solid rgba(255,255,255,0.06)",
                              }}
                            >
                              <th className="text-left px-4 py-2 text-xs text-text-tertiary font-medium">
                                게임
                              </th>
                              <th className="text-center px-3 py-2 text-xs text-text-tertiary font-medium">
                                엔진
                              </th>
                              <th className="text-center px-3 py-2 text-xs text-text-tertiary font-medium">
                                진행도
                              </th>
                              <th className="text-center px-3 py-2 text-xs text-text-tertiary font-medium">
                                상태
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {games.map((g) => {
                              const gPct = pct(
                                g.translated_count,
                                g.string_count
                              )
                              return (
                                <tr
                                  key={g.id}
                                  style={{
                                    borderBottom:
                                      "1px solid rgba(255,255,255,0.03)",
                                  }}
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
                                      <div className="w-16 h-1.5 bg-surface-elevated rounded-full overflow-hidden">
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
                                      className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                                      style={{
                                        background:
                                          g.status === "applied"
                                            ? "rgba(52,199,89,0.15)"
                                            : g.status === "translated"
                                              ? "rgba(91,94,240,0.15)"
                                              : "rgba(255,255,255,0.04)",
                                        color:
                                          g.status === "applied"
                                            ? "#34C759"
                                            : g.status === "translated"
                                              ? "#5b5ef0"
                                              : "#9898a3",
                                      }}
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
                          등록된 게임이 없습니다
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
                  아직 동기화된 사용자가 없습니다
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
