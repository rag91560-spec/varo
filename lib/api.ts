import type {
  Game,
  TranslateRequest,
  TranslationJob,
  ScanResult,
  ScannedGame,
  Settings,
  LicenseStatus,
  CoverCandidate,
  TranslationPreset,
  TMEntry,
  TMStats,
  AdminUser,
  AdminGame,
  EmulatorInfo,
  EmulatorStatus,
  ApkInfo,
  SdkStatus,
  LaunchResult,
  QAResult,
  QASummary,
  QARunResult,
  TranslationStringsResponse,
  TranslationEntry,
  GlossaryTerm,
  GlossarySuggestion,
  ImportResult,
} from "./types"

const BASE = "/api"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: extraHeaders, ...rest } = options ?? {}
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(extraHeaders instanceof Headers
        ? Object.fromEntries(extraHeaders.entries())
        : Array.isArray(extraHeaders)
          ? Object.fromEntries(extraHeaders)
          : extraHeaders),
    },
  })
  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}`
    try {
      const err = await res.json()
      errorMessage = err.detail || err.message || errorMessage
    } catch {
      // Response wasn't JSON (e.g., nginx 502 HTML page)
      const text = await res.text().catch(() => "")
      if (text && text.length < 200) {
        errorMessage = `${errorMessage}: ${text}`
      }
    }
    throw new Error(errorMessage)
  }
  return res.json()
}

// --- Games ---

export const api = {
  games: {
    list: (search?: string) =>
      request<Game[]>(`/games${search ? `?search=${encodeURIComponent(search)}` : ""}`),

    get: (id: number) => request<Game>(`/games/${id}`),

    create: (data: { path: string; title?: string; engine?: string; source_lang?: string; variant_lang?: string }) =>
      request<Game>("/games", { method: "POST", body: JSON.stringify(data) }),

    update: (id: number, data: Partial<Game>) =>
      request<Game>(`/games/${id}`, { method: "PUT", body: JSON.stringify(data) }),

    delete: (id: number) =>
      request<{ ok: boolean }>(`/games/${id}`, { method: "DELETE" }),

    scan: (id: number) =>
      request<ScanResult>(`/games/${id}/scan`, { method: "POST" }),

    launch: (id: number) =>
      request<LaunchResult>(`/games/${id}/launch`, { method: "POST" }),

    scanAll: () =>
      request<{ total: number; results: Array<{ game_id: number; ok: boolean; engine?: string; string_count?: number; error?: string; skipped?: boolean }> }>(
        "/games/scan-all", { method: "POST" }
      ),

    scanDirectory: (path: string) =>
      request<ScannedGame[]>("/games/scan-directory", {
        method: "POST",
        body: JSON.stringify({ path }),
      }),

    structure: (id: number) =>
      request<{ nodes: Array<{ id: string; label: string; total: number; translated: number; errors: number; type: string }>; edges: Array<{ source: string; target: string; label?: string }> }>(`/games/${id}/structure`),

    importSubtitles: (files: string[], title?: string, sourceLang?: string) =>
      request<Game>("/games/import-files", {
        method: "POST",
        body: JSON.stringify({ files, title, source_lang: sourceLang }),
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

  license: {
    status: () => request<LicenseStatus>("/settings/license/status"),
    verify: () => request<LicenseStatus>("/settings/license/verify", { method: "POST" }),
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
      const res = await fetch(`${BASE}/games/${gameId}/cover/upload`, {
        method: "POST",
        body: formData,
      })
      if (!res.ok) {
        let errorMessage = `HTTP ${res.status}`
        try {
          const err = await res.json()
          errorMessage = err.detail || err.message || errorMessage
        } catch {
          // Response wasn't JSON (e.g., nginx 502 HTML page)
          const text = await res.text().catch(() => "")
          if (text && text.length < 200) {
            errorMessage = `${errorMessage}: ${text}`
          }
        }
        throw new Error(errorMessage)
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

    download: (modelId: string) =>
      request<{ ok: boolean; model_id: string; status: string }>(`/models/${modelId}/download`, {
        method: "POST",
      }),

    downloadCancel: (modelId: string) =>
      request<{ ok: boolean; model_id: string }>(`/models/${modelId}/download/cancel`, {
        method: "POST",
      }),

    downloadStatusUrl: (modelId: string) => `${BASE}/models/${modelId}/download/status`,

    delete: (modelId: string) =>
      request<{ ok: boolean; model_id: string }>(`/models/${modelId}`, {
        method: "DELETE",
      }),
  },

  sync: {
    push: () => request<{ ok: boolean }>("/sync", { method: "POST" }),
    adminUsers: () => request<{ users: AdminUser[] }>("/sync/admin/users"),
    adminUserGames: (userId: number) =>
      request<{ games: AdminGame[] }>(`/sync/admin/users/${userId}/games`),
  },

  android: {
    scanApks: (path: string) =>
      request<{ apks: ApkInfo[] }>("/android/scan-apks", {
        method: "POST",
        body: JSON.stringify({ path }),
      }),

    importApk: (path: string, title?: string) =>
      request<{ game: Game; import_result: { title: string; package_name: string; path: string; icon_path: string; original_path: string; size: number } }>(
        "/android/import",
        { method: "POST", body: JSON.stringify({ path, title }) }
      ),

    emulators: () =>
      request<{ emulators: EmulatorInfo[] }>("/android/emulators"),

    connectEmulator: (port: number = 5555) =>
      request<{ ok: boolean; device_id: string; message: string }>(
        "/android/emulator/connect",
        { method: "POST", body: JSON.stringify({ port }) }
      ),

    emulatorStatus: () =>
      request<EmulatorStatus>("/android/emulator/status"),

    install: (gameId: number) =>
      request<{ ok: boolean; device_id: string; message: string }>(
        `/android/install/${gameId}`,
        { method: "POST" }
      ),

    launch: (gameId: number) =>
      request<{ ok: boolean; message: string; device_id: string }>(
        `/android/launch/${gameId}`,
        { method: "POST" }
      ),

    reinstall: (gameId: number) =>
      request<{ ok: boolean; device_id: string; message: string }>(
        `/android/reinstall/${gameId}`,
        { method: "POST" }
      ),

    sdkStatus: () =>
      request<SdkStatus>("/android/emulator/sdk-status"),

    setupEmulator: () =>
      request<{ ok: boolean; status: string }>("/android/emulator/setup", { method: "POST" }),

    autoSetup: () =>
      request<{ ok: boolean; status: string }>("/android/emulator/auto-setup", { method: "POST" }),

    setupEmulatorCancel: () =>
      request<{ ok: boolean }>("/android/emulator/setup/cancel", { method: "POST" }),

    setupStatusUrl: () => `${BASE}/android/emulator/setup/status`,

    startEmulator: () =>
      request<{ ok: boolean; message: string; pid: number }>("/android/emulator/start", { method: "POST" }),

    stopEmulator: () =>
      request<{ ok: boolean; message: string }>("/android/emulator/stop", { method: "POST" }),
  },

  qa: {
    run: (gameId: number) =>
      request<QARunResult>(`/games/${gameId}/qa`, { method: "POST" }),

    get: (gameId: number) =>
      request<{ issues: QAResult[] }>(`/games/${gameId}/qa`),

    summary: (gameId: number) =>
      request<QASummary>(`/games/${gameId}/qa/summary`),

    resolve: (gameId: number, qaId: number) =>
      request<{ ok: boolean }>(`/games/${gameId}/qa/${qaId}/resolve`, { method: "PUT" }),
  },

  strings: {
    get: (gameId: number, params?: { page?: number; per_page?: number; status?: string; search?: string; tag?: string; qa_only?: boolean }) => {
      const sp = new URLSearchParams()
      if (params?.page) sp.set("page", String(params.page))
      if (params?.per_page) sp.set("per_page", String(params.per_page))
      if (params?.status) sp.set("status", params.status)
      if (params?.search) sp.set("search", params.search)
      if (params?.tag) sp.set("tag", params.tag)
      if (params?.qa_only) sp.set("qa_only", "true")
      return request<TranslationStringsResponse>(`/games/${gameId}/translate/strings?${sp}`)
    },

    update: (gameId: number, idx: number, data: { translated?: string; status?: string; review_status?: string; reviewer_note?: string }) =>
      request<{ ok: boolean }>(`/games/${gameId}/translate/strings/${idx}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    bulkUpdate: (gameId: number, data: { indices: number[]; status?: string; review_status?: string }) =>
      request<{ ok: boolean; updated: number }>(`/games/${gameId}/translate/strings/bulk`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },

  glossary: {
    analyze: (gameId: number) =>
      request<{ terms: GlossaryTerm[] }>(`/glossary/analyze/${gameId}`),

    suggest: (gameId: number) =>
      request<{ suggestions: GlossarySuggestion[] }>(`/glossary/suggest/${gameId}`),
  },

  project: {
    exportBlob: async (gameId: number, format: "json" | "csv"): Promise<{ blob: Blob; filename: string }> => {
      const suffix = format === "csv" ? "/csv" : ""
      const res = await fetch(`${BASE}/games/${gameId}/project/export${suffix}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") || ""
      const match = disposition.match(/filename\*?=(?:UTF-8'')?([^\s;]+)/) || disposition.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] ? decodeURIComponent(match[1]) : `project_${gameId}_export.${format}`
      return { blob, filename }
    },

    exportJson: (gameId: number) =>
      request<Blob>(`/games/${gameId}/project/export`),

    exportCsv: (gameId: number) =>
      request<Blob>(`/games/${gameId}/project/export/csv`),

    importJson: (gameId: number, data: FormData) =>
      fetch(`${BASE}/games/${gameId}/project/import`, { method: "POST", body: data })
        .then(r => r.json()) as Promise<ImportResult>,

    importCsv: (gameId: number, data: FormData) =>
      fetch(`${BASE}/games/${gameId}/project/import/csv`, { method: "POST", body: data })
        .then(r => r.json()) as Promise<ImportResult>,
  },

  health: () => request<{ status: string }>("/health"),
}
