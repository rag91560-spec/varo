import type {
  Game,
  GameFolder,
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
  MediaFolder,
  MediaFile,
  MediaScanResult,
  ScriptTranslation,
  VideoItem,
  AudioItem,
  MediaCategory,
  MangaItem,
  MangaTranslationResult,
  MangaTranslationEntry,
  VideoDownloadJob,
  SyncResult,
  RenderConfig,
  FontInfo,
  MangaRenderStatus,
  InpaintMode,
  DetectorType,
  SubtitleSet,
  SubtitleSegment,
  SubtitleJobStatus,
  SubtitleExportOptions,
  SubtitleStyleOptions,
  SubtitleGlossaryEntry,
} from "./types"

const BASE = "/api"
// Direct backend URL for large file uploads (Next.js rewrite proxy has ~8MB body limit)
const BACKEND = "http://localhost:8000/api"

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

    create: (data: { path: string; title?: string; engine?: string; exe_path?: string; source_lang?: string; variant_lang?: string }) =>
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
    pollUrl: (gameId: number) => `/api/games/${gameId}/translate/poll`,
  },

  settings: {
    get: () => request<Settings>("/settings"),
    put: (data: Settings) =>
      request<Settings>("/settings", { method: "PUT", body: JSON.stringify(data) }),
    testKey: (provider: string, key: string) =>
      request<{ ok: boolean; error?: string }>("/settings/test-key", {
        method: "POST",
        body: JSON.stringify({ provider, key }),
      }),
    crashLog: async (): Promise<string> => {
      const res = await fetch("/api/settings/crash-log")
      return res.text()
    },
    clearCrashLog: () =>
      request<{ ok: boolean }>("/settings/crash-log", { method: "DELETE" }),
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
      const res = await fetch(`${BACKEND}/games/${gameId}/cover/upload`, {
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

    activeSetup: () =>
      request<{ active: boolean }>("/android/emulator/setup/active"),

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
    get: (gameId: number, params?: { page?: number; per_page?: number; status?: string; search?: string; tag?: string; qa_only?: boolean; safety?: string }) => {
      const sp = new URLSearchParams()
      if (params?.page) sp.set("page", String(params.page))
      if (params?.per_page) sp.set("per_page", String(params.per_page))
      if (params?.status) sp.set("status", params.status)
      if (params?.search) sp.set("search", params.search)
      if (params?.tag) sp.set("tag", params.tag)
      if (params?.qa_only) sp.set("qa_only", "true")
      if (params?.safety) sp.set("safety", params.safety)
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

    importJson: (gameId: number, data: FormData) =>
      fetch(`${BACKEND}/games/${gameId}/project/import`, { method: "POST", body: data })
        .then(r => r.json()) as Promise<ImportResult>,

    importCsv: (gameId: number, data: FormData) =>
      fetch(`${BACKEND}/games/${gameId}/project/import/csv`, { method: "POST", body: data })
        .then(r => r.json()) as Promise<ImportResult>,
  },

  media: {
    folders: (gameId: number) =>
      request<{ folders: MediaFolder[] }>(`/media/${gameId}/folders`),

    addFolder: (gameId: number, data: { folder_path: string; media_type: string; label?: string }) =>
      request<MediaFolder>(`/media/${gameId}/folders`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    removeFolder: (gameId: number, folderId: number) =>
      request<{ ok: boolean }>(`/media/${gameId}/folders/${folderId}`, {
        method: "DELETE",
      }),

    scan: (gameId: number) =>
      request<MediaScanResult>(`/media/${gameId}/scan`, { method: "POST" }),

    files: (gameId: number, type?: string) =>
      request<{ files: MediaFile[] }>(`/media/${gameId}/files${type ? `?type=${type}` : ""}`),

    serveUrl: (gameId: number, filePath: string) =>
      `${BASE}/media/${gameId}/serve?path=${encodeURIComponent(filePath)}`,

    gameIds: (type?: string) =>
      request<{ game_ids: number[] }>(`/games/media-game-ids${type ? `?type=${type}` : ""}`),

    translateScript: (gameId: number, scriptPath: string, sourceLang?: string, targetLang?: string) =>
      request<ScriptTranslation>(`/media/${gameId}/script/translate`, {
        method: "POST",
        body: JSON.stringify({
          script_path: scriptPath,
          source_lang: sourceLang || "ja",
          target_lang: targetLang || "ko",
        }),
      }),
  },

  live: {
    ocr: (image: string, language?: string, engine?: string) =>
      request<{
        blocks: Array<{ text: string; x: number; y: number; width: number; height: number; confidence: number }>
        full_text: string
        language: string
        engine: string
        error?: string
      }>("/live/ocr", {
        method: "POST",
        body: JSON.stringify({ image, language: language ?? "ja", engine: engine ?? "auto" }),
      }),

    translate: (text: string, sourceLang?: string, targetLang?: string, provider?: string, model?: string) =>
      request<{ translated: string; source_lang: string; target_lang: string; error?: string }>("/live/translate", {
        method: "POST",
        body: JSON.stringify({
          text,
          source_lang: sourceLang ?? "ja",
          target_lang: targetLang ?? "ko",
          provider: provider ?? "claude",
          model: model ?? "",
        }),
      }),

    translateBlocks: (
      blocks: Array<{ text: string; x: number; y: number; width: number; height: number }>,
      sourceLang?: string, targetLang?: string, provider?: string, model?: string,
      detectedLang?: string,
    ) =>
      request<{
        blocks: Array<{ original: string; translated: string; x: number; y: number; width: number; height: number }>
        source_lang?: string
        error?: string
      }>("/live/translate-blocks", {
        method: "POST",
        body: JSON.stringify({
          blocks,
          source_lang: sourceLang ?? "ja",
          target_lang: targetLang ?? "ko",
          provider: provider ?? "claude",
          model: model ?? "",
          detected_lang: detectedLang ?? "",
        }),
      }),

    vision: (image: string, sourceLang?: string, targetLang?: string, provider?: string, model?: string) =>
      request<{
        entries: Array<{ original: string; translated: string; x: number; y: number; width: number; height: number }>
        error?: string
      }>("/live/vision", {
        method: "POST",
        body: JSON.stringify({
          image,
          source_lang: sourceLang ?? "ja",
          target_lang: targetLang ?? "ko",
          provider: provider ?? "claude",
          model: model ?? "",
        }),
      }),

    cacheStats: () => request<{ size: number; max_size: number }>("/live/cache/stats"),
    cacheClear: () => request<{ ok: boolean }>("/live/cache/clear", { method: "POST" }),
  },

  videos: {
    list: () => request<VideoItem[]>("/videos"),

    add: (data: { title: string; type: string; source: string; thumbnail?: string; duration?: number; size?: number; category_id?: number | null }) =>
      request<VideoItem>("/videos", { method: "POST", body: JSON.stringify(data) }),

    update: (id: number, data: Partial<VideoItem>) =>
      request<VideoItem>(`/videos/${id}`, { method: "PUT", body: JSON.stringify(data) }),

    delete: (id: number) =>
      request<{ ok: boolean }>(`/videos/${id}`, { method: "DELETE" }),

    bulkDelete: (ids: number[]) =>
      request<{ ok: boolean; deleted: number }>("/videos/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),

    serveUrl: (id: number) => `${BASE}/videos/${id}/serve`,

    addFile: async (file: File): Promise<VideoItem> => {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`${BACKEND}/videos/upload`, { method: "POST", body: form })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const err = await res.json(); msg = err.detail || msg } catch {}
        throw new Error(msg)
      }
      return res.json()
    },

    uploadThumbnail: async (id: number, file: File): Promise<VideoItem> => {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`${BACKEND}/videos/${id}/thumbnail`, { method: "POST", body: form })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const err = await res.json(); msg = err.detail || msg } catch {}
        throw new Error(msg)
      }
      return res.json()
    },

    bulkMove: (ids: number[], categoryId: number | null) =>
      request<{ ok: boolean; moved: number }>("/videos/bulk-move", {
        method: "POST",
        body: JSON.stringify({ ids, category_id: categoryId }),
      }),

    downloadUrl: (url: string, categoryId?: number | null) =>
      request<{ job_id: string; status: string }>("/videos/download-url", {
        method: "POST",
        body: JSON.stringify({ url, category_id: categoryId ?? null }),
      }),

    downloadStatusUrl: (jobId: string) => `${BASE}/videos/download/${jobId}/status`,

    cancelDownload: (jobId: string) =>
      request<{ ok: boolean }>(`/videos/download/${jobId}/cancel`, { method: "POST" }),

    scanFolder: (
      path: string,
      opts?: { categoryId?: number | null; parentCategoryId?: number | null; preserveStructure?: boolean },
    ) =>
      request<{ created_items: VideoItem[]; created_categories: MediaCategory[]; total: number }>(
        "/videos/scan-folder",
        {
          method: "POST",
          body: JSON.stringify({
            path,
            category_id: opts?.categoryId ?? null,
            parent_category_id: opts?.parentCategoryId ?? null,
            preserve_structure: opts?.preserveStructure ?? true,
          }),
        },
      ),
  },

  audio: {
    list: () => request<AudioItem[]>("/audio"),

    add: (data: { title: string; type: string; source: string; thumbnail?: string; duration?: number; size?: number; category_id?: number | null }) =>
      request<AudioItem>("/audio", { method: "POST", body: JSON.stringify(data) }),

    update: (id: number, data: Partial<AudioItem>) =>
      request<AudioItem>(`/audio/${id}`, { method: "PUT", body: JSON.stringify(data) }),

    delete: (id: number) =>
      request<{ ok: boolean }>(`/audio/${id}`, { method: "DELETE" }),

    bulkDelete: (ids: number[]) =>
      request<{ ok: boolean; deleted: number }>("/audio/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),

    serveUrl: (id: number) => `${BASE}/audio/${id}/serve`,

    addFile: async (file: File): Promise<AudioItem> => {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`${BACKEND}/audio/upload`, { method: "POST", body: form })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const err = await res.json(); msg = err.detail || msg } catch {}
        throw new Error(msg)
      }
      return res.json()
    },

    uploadThumbnail: async (id: number, file: File): Promise<AudioItem> => {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`${BACKEND}/audio/${id}/thumbnail`, { method: "POST", body: form })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const err = await res.json(); msg = err.detail || msg } catch {}
        throw new Error(msg)
      }
      return res.json()
    },

    bulkMove: (ids: number[], categoryId: number | null) =>
      request<{ ok: boolean; moved: number }>("/audio/bulk-move", {
        method: "POST",
        body: JSON.stringify({ ids, category_id: categoryId }),
      }),

    scanFolder: (
      path: string,
      opts?: { categoryId?: number | null; parentCategoryId?: number | null; preserveStructure?: boolean },
    ) =>
      request<{ created_items: AudioItem[]; created_categories: MediaCategory[]; total: number }>(
        "/audio/scan-folder",
        {
          method: "POST",
          body: JSON.stringify({
            path,
            category_id: opts?.categoryId ?? null,
            parent_category_id: opts?.parentCategoryId ?? null,
            preserve_structure: opts?.preserveStructure ?? true,
          }),
        },
      ),

    uploadScript: async (id: number, file: File): Promise<AudioItem> => {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`${BACKEND}/audio/${id}/script`, { method: "POST", body: form })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const err = await res.json(); msg = err.detail || msg } catch {}
        throw new Error(msg)
      }
      return res.json()
    },

    updateScript: (id: number, text: string) =>
      request<AudioItem>(`/audio/${id}`, { method: "PUT", body: JSON.stringify({ script_text: text }) }),

    translateScript: (id: number, sourceLang = "ja", targetLang = "ko") =>
      request<{ original: string[]; translated: string[]; total: number; cached: number; item: AudioItem }>(
        `/audio/${id}/translate-script`,
        { method: "POST", body: JSON.stringify({ source_lang: sourceLang, target_lang: targetLang }) },
      ),

    autoCaption: (id: number, body: { provider?: string; api_key?: string; model?: string; source_lang?: string; target_lang?: string; stt_provider?: string; stt_api_key?: string }) =>
      request<{ job_id: string; status: string }>(
        `/audio/${id}/auto-caption`,
        { method: "POST", body: JSON.stringify(body) },
      ),

    autoCaptionStatusUrl: (jobId: string) => `${BASE}/audio/auto-caption/${jobId}/status`,

    bulkTranslate: (body: {
      audio_ids: number[]
      mode?: "auto" | "script" | "auto_caption"
      source_lang?: string
      target_lang?: string
      provider?: string
      api_key?: string
      model?: string
      stt_provider?: string
      stt_api_key?: string
      use_category_glossary?: boolean
    }) =>
      request<{ job_id: string; status: string; total: number; category_id: number | null }>(
        "/audio/bulk-translate",
        { method: "POST", body: JSON.stringify(body) },
      ),

    bulkTranslateStatusUrl: (jobId: string) => `${BASE}/audio/bulk-translate/${jobId}/status`,

    bulkTranslateCancel: (jobId: string) =>
      request<{ ok: boolean }>(`/audio/bulk-translate/${jobId}/cancel`, { method: "POST" }),
  },

  categories: {
    list: (mediaType?: string) =>
      request<MediaCategory[]>(`/categories${mediaType ? `?media_type=${mediaType}` : ""}`),

    create: (data: { name: string; media_type: string; sort_order?: number; parent_id?: number | null }) =>
      request<MediaCategory>("/categories", { method: "POST", body: JSON.stringify(data) }),

    update: (id: number, data: { name?: string; sort_order?: number; parent_id?: number | null }) =>
      request<MediaCategory>(`/categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),

    delete: (id: number) =>
      request<{ ok: boolean }>(`/categories/${id}`, { method: "DELETE" }),

    ancestors: (id: number) =>
      request<MediaCategory[]>(`/categories/${id}/ancestors`),

    getGlossary: (id: number) =>
      request<Record<string, string>>(`/categories/${id}/glossary`),

    putGlossary: (id: number, glossary: Record<string, string>) =>
      request<Record<string, string>>(`/categories/${id}/glossary`, {
        method: "PUT",
        body: JSON.stringify(glossary),
      }),

    patchGlossary: (id: number, terms: Record<string, string>) =>
      request<Record<string, string>>(`/categories/${id}/glossary`, {
        method: "PATCH",
        body: JSON.stringify(terms),
      }),
  },

  manga: {
    list: (search?: string, sourceType?: string) => {
      const sp = new URLSearchParams()
      if (search) sp.set("search", search)
      if (sourceType) sp.set("source_type", sourceType)
      return request<MangaItem[]>(`/manga?${sp}`)
    },

    get: (id: number) => request<MangaItem>(`/manga/${id}`),

    delete: (id: number) =>
      request<{ ok: boolean }>(`/manga/${id}`, { method: "DELETE" }),

    bulkDelete: (ids: number[]) =>
      request<{ ok: boolean; deleted: number }>("/manga/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),

    update: (id: number, data: Partial<Pick<MangaItem, "title" | "artist" | "tags" | "category_id">>) =>
      request<MangaItem>(`/manga/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...data,
          category_id: data.category_id === undefined ? -1 : data.category_id,
        }),
      }),

    bulkMove: (ids: number[], categoryId: number | null) =>
      request<{ ok: boolean; moved: number }>("/manga/bulk-move", {
        method: "POST",
        body: JSON.stringify({ ids, category_id: categoryId }),
      }),

    imageUrl: (id: number, page: number) => `${BASE}/manga/${id}/images/${page}`,

    thumbnailUrl: (id: number) => `${BASE}/manga/${id}/thumbnail`,

    uploadThumbnail: async (id: number, file: File): Promise<MangaItem> => {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`${BACKEND}/manga/${id}/thumbnail`, { method: "POST", body: form })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const err = await res.json(); msg = err.detail || msg } catch {}
        throw new Error(msg)
      }
      return res.json()
    },

    translate: (id: number, page: number, model?: string, detector?: DetectorType) =>
      request<MangaTranslationResult>(`/manga/${id}/translate`, {
        method: "POST",
        body: JSON.stringify({ page, model: model ?? "gemini-2.0-flash", detector: detector ?? "gemini" }),
      }),

    getTranslation: (id: number, page: number) =>
      request<{ exists: boolean; translation?: MangaTranslationResult["translation"] }>(
        `/manga/${id}/translation/${page}`
      ),

    upload: async (title: string, files: File[]): Promise<MangaItem> => {
      const form = new FormData()
      form.append("title", title)
      files.forEach((f) => form.append("files", f))
      const res = await fetch(`${BACKEND}/manga/upload`, { method: "POST", body: form })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const err = await res.json(); msg = err.detail || msg } catch {}
        throw new Error(msg)
      }
      return res.json()
    },

    addImages: async (id: number, files: File[]): Promise<MangaItem> => {
      const form = new FormData()
      files.forEach((f) => form.append("files", f))
      const res = await fetch(`${BACKEND}/manga/${id}/images`, { method: "POST", body: form })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const err = await res.json(); msg = err.detail || msg } catch {}
        throw new Error(msg)
      }
      return res.json()
    },

    reorder: (id: number, order: number[]) =>
      request<MangaItem>(`/manga/${id}/reorder`, {
        method: "POST",
        body: JSON.stringify({ order }),
      }),

    deleteImage: (id: number, page: number) =>
      request<{ ok: boolean; page_count: number }>(`/manga/${id}/images/${page}`, {
        method: "DELETE",
      }),

    renderPage: (id: number, page: number, config?: Partial<RenderConfig>) =>
      request<{ rendered_path: string; inpaint_mode: string; font_id: string }>(
        `/manga/${id}/render/${page}`,
        { method: "POST", body: JSON.stringify(config || {}) },
      ),

    renderAll: (id: number, config?: Partial<RenderConfig>) =>
      request<{ job_id: string; status: string }>(
        `/manga/${id}/render-all`,
        { method: "POST", body: JSON.stringify(config || {}) },
      ),

    renderAllStatusUrl: (id: number) => `${BASE}/manga/${id}/render-all/status`,

    renderedImageUrl: (id: number, page: number) => `${BASE}/manga/${id}/rendered/${page}`,

    renderStatus: (id: number) =>
      request<MangaRenderStatus>(`/manga/${id}/render-status`),

    fonts: () =>
      request<{ fonts: FontInfo[] }>("/manga/fonts"),

    downloadFont: (fontId: string) =>
      request<{ ok: boolean }>(`/manga/fonts/${fontId}/download`, { method: "POST" }),

    updatePositions: (id: number, page: number, positions: MangaTranslationEntry[]) =>
      request<{ ok: boolean; count: number }>(`/manga/${id}/translation/${page}`, {
        method: "PATCH",
        body: JSON.stringify({ positions }),
      }),

    translateRegion: (id: number, page: number, region: { x: number; y: number; width: number; height: number }) =>
      request<MangaTranslationEntry>(`/manga/${id}/translate-region`, {
        method: "POST",
        body: JSON.stringify({ page, ...region }),
      }),
  },

  folders: {
    list: () => request<GameFolder[]>("/folders"),
    create: (data: { name: string; parent_id?: number | null }) =>
      request<GameFolder>("/folders", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: { name?: string; sort_order?: number; parent_id?: number | null }) =>
      request<GameFolder>(`/folders/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<{ ok: boolean }>(`/folders/${id}`, { method: "DELETE" }),
  },

  agent: {
    start: (gameId: number, data: { api_key: string; provider?: string; model?: string; max_turns?: number; instructions?: string }) =>
      request<{ job_id: string; status: string; model: string; max_turns: number }>(`/games/${gameId}/agent`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    message: (gameId: number, text: string) =>
      request<{ ok: boolean }>(`/games/${gameId}/agent/message`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),

    cancel: (gameId: number) =>
      request<{ ok: boolean }>(`/games/${gameId}/agent/cancel`, { method: "POST" }),

    statusUrl: (gameId: number) => `${BASE}/games/${gameId}/agent/status`,
    pollUrl: (gameId: number) => `/api/games/${gameId}/agent/poll`,
  },

  filesystem: {
    browse: (path: string = "", filter?: string, foldersOnly?: boolean) => {
      const params = new URLSearchParams()
      if (path) params.set("path", path)
      if (filter) params.set("filter", filter)
      if (foldersOnly) params.set("folders_only", "true")
      return request<{
        path: string
        parent: string | null
        entries: Array<{
          name: string
          path: string
          type: "drive" | "folder" | "file"
          size: number | null
          modified: string | null
        }>
        error?: string
      }>(`/filesystem/browse?${params}`)
    },
  },

  subtitle: {
    create: (data: { media_id: number; media_type: string; label?: string; source_lang?: string; target_lang?: string }) =>
      request<SubtitleSet>("/subtitle/create", { method: "POST", body: JSON.stringify(data) }),

    list: (mediaType: string, mediaId: number) =>
      request<{ subtitles: SubtitleSet[] }>(`/subtitle/list/${mediaType}/${mediaId}`),

    delete: (subtitleId: number) =>
      request<{ ok: boolean }>(`/subtitle/${subtitleId}`, { method: "DELETE" }),

    extractAudio: (mediaId: number, mediaType: string) =>
      request<{ path: string; size: number }>("/subtitle/extract-audio", {
        method: "POST",
        body: JSON.stringify({ media_id: mediaId, media_type: mediaType }),
      }),

    startSTT: (data: { subtitle_id: number; provider?: string; model?: string; language?: string }) =>
      request<SubtitleJobStatus>("/subtitle/stt", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    sttStatusUrl: (jobId: string) => `${BASE}/subtitle/stt/${jobId}/status`,

    analyzeVideo: (subtitleId: number, data: { provider?: string; model?: string }) =>
      request<{ context: string }>(`/subtitle/${subtitleId}/analyze`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    startTranslate: (subtitleId: number, data: { source_lang?: string; target_lang?: string; provider?: string; model?: string; context_window?: number; context_overlap?: number; context?: string }) =>
      request<SubtitleJobStatus>(`/subtitle/${subtitleId}/translate`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    translateStatusUrl: (jobId: string) => `${BASE}/subtitle/translate/${jobId}/status`,

    getSegments: (subtitleId: number) =>
      request<{ segments: SubtitleSegment[]; subtitle: SubtitleSet }>(`/subtitle/${subtitleId}/segments`),

    updateSegment: (segmentId: number, data: Partial<Pick<SubtitleSegment, "original_text" | "translated_text" | "start_time" | "end_time" | "pos_x" | "pos_y">>) =>
      request<SubtitleSegment>(`/subtitle/segments/${segmentId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    bulkUpdatePosition: (subtitleId: number, posX: number | null, posY: number | null) =>
      request<{ segments: SubtitleSegment[] }>(`/subtitle/${subtitleId}/segments/position`, {
        method: "PUT",
        body: JSON.stringify({ pos_x: posX, pos_y: posY }),
      }),

    createSegment: (subtitleId: number, data: { start_time: number; end_time: number; original_text?: string; translated_text?: string }) =>
      request<SubtitleSegment>(`/subtitle/${subtitleId}/segments`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    deleteSegment: (segmentId: number) =>
      request<{ ok: boolean }>(`/subtitle/segments/${segmentId}`, { method: "DELETE" }),

    splitSegment: (segmentId: number, splitTime: number) =>
      request<SubtitleSegment>(`/subtitle/segments/${segmentId}/split`, {
        method: "POST",
        body: JSON.stringify({ split_time: splitTime }),
      }),

    exportBlob: async (subtitleId: number, options: SubtitleExportOptions): Promise<{ blob: Blob; filename: string }> => {
      const res = await fetch(`${BASE}/subtitle/${subtitleId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") || ""
      const match = disposition.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || `subtitle_${subtitleId}.${options.format}`
      return { blob, filename }
    },

    importFile: async (file: File, mediaId: number, mediaType: string, label?: string, sourceLang?: string): Promise<{ subtitle: SubtitleSet; segments_imported: number; format: string }> => {
      const form = new FormData()
      form.append("file", file)
      // URL params for the body fields since we use multipart
      const params = new URLSearchParams()
      params.set("media_id", String(mediaId))
      params.set("media_type", mediaType)
      if (label) params.set("label", label)
      if (sourceLang) params.set("source_lang", sourceLang)

      const res = await fetch(`${BACKEND}/subtitle/import?${params}`, {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const err = await res.json(); msg = err.detail || msg } catch {}
        throw new Error(msg)
      }
      return res.json()
    },

    // Glossary
    getGlossary: (subtitleId: number) =>
      request<{ entries: SubtitleGlossaryEntry[] }>(`/subtitle/${subtitleId}/glossary`),

    upsertGlossary: (subtitleId: number, entry: { source: string; target: string; category?: string }) =>
      request<SubtitleGlossaryEntry>(`/subtitle/${subtitleId}/glossary`, {
        method: "POST",
        body: JSON.stringify(entry),
      }),

    bulkUpsertGlossary: (subtitleId: number, entries: Array<{ source: string; target: string; category?: string }>) =>
      request<{ count: number }>(`/subtitle/${subtitleId}/glossary/bulk`, {
        method: "POST",
        body: JSON.stringify({ entries }),
      }),

    deleteGlossary: (glossaryId: number) =>
      request<{ ok: boolean }>(`/subtitle/glossary/${glossaryId}`, { method: "DELETE" }),

    // Waveform
    getWaveform: (mediaType: string, mediaId: number, samples?: number) =>
      request<{ peaks: number[]; duration: number }>(`/subtitle/waveform/${mediaType}/${mediaId}${samples ? `?samples=${samples}` : ""}`),

    cancelJob: (jobId: string) =>
      request<{ ok: boolean }>(`/subtitle/job/${jobId}/cancel`, { method: "POST" }),

    startSync: (subtitleId: number) =>
      request<{ job_id: string; status: string }>(`/subtitle/${subtitleId}/sync`, { method: "POST" }),

    syncStatusUrl: (jobId: string) => `${BASE}/subtitle/sync/${jobId}/status`,

    startHardsub: (subtitleId: number, style?: Partial<SubtitleStyleOptions>) =>
      request<SubtitleJobStatus>(`/subtitle/${subtitleId}/hardsub`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(style || {}),
      }),

    hardsubStatusUrl: (jobId: string) => `${BASE}/subtitle/hardsub/${jobId}/status`,

    downloadHardsub: async (jobId: string): Promise<{ blob: Blob; filename: string }> => {
      const res = await fetch(`${BASE}/subtitle/hardsub/${jobId}/download`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") || ""
      const match = disposition.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || `hardsub_${jobId}.mp4`
      return { blob, filename }
    },
  },

  health: () => request<{ status: string }>("/health"),
}
