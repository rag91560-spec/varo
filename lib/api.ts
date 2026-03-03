import type {
  Game,
  TranslateRequest,
  TranslationJob,
  ScanResult,
  ScannedGame,
  Settings,
  CoverCandidate,
  TranslationPreset,
  TMEntry,
  TMStats,
  AdminUser,
  AdminGame,
} from "./types"

const BASE = "/api"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || err.message || `HTTP ${res.status}`)
  }
  return res.json()
}

// --- Games ---

export const api = {
  games: {
    list: (search?: string) =>
      request<Game[]>(`/games${search ? `?search=${encodeURIComponent(search)}` : ""}`),

    get: (id: number) => request<Game>(`/games/${id}`),

    create: (data: { path: string; title?: string; engine?: string; source_lang?: string }) =>
      request<Game>("/games", { method: "POST", body: JSON.stringify(data) }),

    update: (id: number, data: Partial<Game>) =>
      request<Game>(`/games/${id}`, { method: "PUT", body: JSON.stringify(data) }),

    delete: (id: number) =>
      request<{ ok: boolean }>(`/games/${id}`, { method: "DELETE" }),

    scan: (id: number) =>
      request<ScanResult>(`/games/${id}/scan`, { method: "POST" }),

    launch: (id: number) =>
      request<{ ok: boolean; exe_path: string }>(`/games/${id}/launch`, { method: "POST" }),

    scanDirectory: (path: string) =>
      request<ScannedGame[]>("/games/scan-directory", {
        method: "POST",
        body: JSON.stringify({ path }),
      }),
  },

  translate: {
    start: (gameId: number, data: TranslateRequest) =>
      request<TranslationJob>(`/games/${gameId}/translate`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    cancel: (gameId: number) =>
      request<{ ok: boolean }>(`/games/${gameId}/translate/cancel`, { method: "POST" }),

    apply: (gameId: number) =>
      request<{ ok: boolean; patch_path?: string }>(`/games/${gameId}/translate/apply`, {
        method: "POST",
      }),

    rollback: (gameId: number) =>
      request<{ ok: boolean; restored_count: number }>(`/games/${gameId}/translate/rollback`, {
        method: "POST",
      }),

    statusUrl: (gameId: number) => `${BASE}/games/${gameId}/translate/status`,
  },

  settings: {
    get: () => request<Settings>("/settings"),
    put: (data: Settings) =>
      request<Settings>("/settings", { method: "PUT", body: JSON.stringify(data) }),
  },

  covers: {
    fetch: (gameId: number, searchTerm?: string) =>
      request<{ cover_url: string; source: string; developer?: string }>(`/games/${gameId}/cover/fetch`, {
        method: "POST",
        body: JSON.stringify({ search_term: searchTerm }),
      }),

    search: (gameId: number, query: string, sources?: string[]) =>
      request<{ results: CoverCandidate[] }>(`/games/${gameId}/cover/search`, {
        method: "POST",
        body: JSON.stringify({ query, sources: sources ?? ["vndb", "dlsite", "web"] }),
      }),

    select: (gameId: number, data: { url: string; source: string; external_id?: string }) =>
      request<{ cover_url: string }>(`/games/${gameId}/cover/select`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    upload: async (gameId: number, file: File) => {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch(`http://localhost:8000/api/games/${gameId}/cover/upload`, {
        method: "POST",
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      return res.json() as Promise<{ cover_url: string; source: string }>
    },

    remove: (gameId: number) =>
      request<{ ok: boolean }>(`/games/${gameId}/cover`, { method: "DELETE" }),

    fetchAll: () =>
      request<{ total: number; fetched: number; results: Array<{ game_id: number; title: string; source?: string; developer?: string; success: boolean }> }>(
        "/covers/fetch-all", { method: "POST" }
      ),
  },

  presets: {
    list: (gameId?: number) =>
      request<TranslationPreset[]>(`/presets${gameId ? `?game_id=${gameId}` : ""}`),

    get: (id: number) => request<TranslationPreset>(`/presets/${id}`),

    create: (data: Partial<TranslationPreset> & { name: string }) =>
      request<TranslationPreset>("/presets", { method: "POST", body: JSON.stringify(data) }),

    update: (id: number, data: Partial<TranslationPreset>) =>
      request<TranslationPreset>(`/presets/${id}`, { method: "PUT", body: JSON.stringify(data) }),

    delete: (id: number) =>
      request<{ ok: boolean }>(`/presets/${id}`, { method: "DELETE" }),
  },

  translationMemory: {
    search: (params?: { search?: string; source_lang?: string; limit?: number }) => {
      const sp = new URLSearchParams()
      if (params?.search) sp.set("search", params.search)
      if (params?.source_lang) sp.set("source_lang", params.source_lang)
      if (params?.limit) sp.set("limit", String(params.limit))
      return request<TMEntry[]>(`/translation-memory?${sp}`)
    },

    stats: () => request<TMStats>("/translation-memory/stats"),

    importFromGame: (gameId: number) =>
      request<{ imported: number }>(`/translation-memory/import/${gameId}`, { method: "POST" }),

    delete: (id: number) =>
      request<{ ok: boolean }>(`/translation-memory/${id}`, { method: "DELETE" }),

    clear: () =>
      request<{ deleted: number }>("/translation-memory/clear", { method: "POST" }),
  },

  models: {
    list: () =>
      request<{
        models_dir: string
        models: Array<{
          id: string
          name: string
          desc: string
          size: string
          speed: string
          quality: string
          installed: boolean
        }>
      }>("/models"),
  },

  sync: {
    push: () => request<{ ok: boolean }>("/sync", { method: "POST" }),
    adminUsers: () => request<{ users: AdminUser[] }>("/sync/admin/users"),
    adminUserGames: (userId: number) =>
      request<{ games: AdminGame[] }>(`/sync/admin/users/${userId}/games`),
  },

  health: () => request<{ status: string }>("/health"),
}
