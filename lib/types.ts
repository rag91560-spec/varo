export interface Game {
  id: number
  title: string
  path: string
  exe_path: string
  engine: string
  cover_path: string
  vndb_id: string
  dlsite_id: string
  cover_source: string
  developer: string
  preset_id: number | null
  string_count: number
  translated_count: number
  source_lang: string
  status: string
  last_played_at: string | null
  play_time_minutes: number
  created_at: string
  updated_at: string
  platform: "windows" | "android"
  package_name: string
  original_path: string
  variant_lang: string
}

export interface TranslateRequest {
  provider: string
  model?: string
  source_lang?: string
  target_lang?: string
  preset_id?: number
}

export interface CoverCandidate {
  url: string
  thumbnail_url: string
  title: string
  source: "vndb" | "dlsite" | "web"
  external_id: string
  developer?: string
  sexual?: number
  violence?: number
}

export interface ReferencePair {
  source: string
  target: string
}

export interface TranslationPreset {
  id: number
  name: string
  game_id: number | null
  engine: string
  provider: string
  model: string
  tone: string
  glossary_json: string
  instructions: string
  use_memory: boolean
  reference_pairs_json: string
  created_at: string
  updated_at: string
}

export interface TMEntry {
  id: number
  source_text: string
  translated_text: string
  source_lang: string
  target_lang: string
  provider: string
  context_tag: string
  usage_count: number
  created_at: string
}

export interface TMStats {
  total: number
  by_lang: Record<string, number>
  by_provider: Record<string, number>
}

export interface TranslationJob {
  job_id: string
  status: string
  total_strings: number
  error_message: string
}

export interface TranslationProgress {
  progress: number
  translated: number
  total: number
  message?: string
  status?: string
}

export interface LaunchResult {
  ok: boolean
  exe_path?: string
  device_id?: string
  html_game?: boolean
  serve_url?: string
}

export interface ScanResult {
  game: Game
  resources: Array<{ path: string; type: string; string_count: number }>
  string_count: number
}

export interface ScannedGame {
  title: string
  path: string
  exe_path: string
  engine: string
  platform?: "windows" | "android"
  variant_lang?: string
}

export interface Settings {
  api_keys?: Record<string, string> | string
  scan_directories?: string[] | string
  default_provider?: string
  default_source_lang?: string
  license_key?: string
  [key: string]: unknown
}

export interface LicenseStatus {
  valid: boolean
  plan: string
  is_admin: boolean
  verified_at: string
}

export interface AdminUser {
  id: number
  license_key: string
  app_version: string
  last_sync_at: string
  game_count: number
  total_strings: number
  total_translated: number
  tm_count: number
}

export interface AdminGame {
  id: number
  user_id: number
  title: string
  engine: string
  string_count: number
  translated_count: number
  status: string
  developer: string
  vndb_id: string
  dlsite_id: string
  synced_at: string
}

export interface EmulatorInfo {
  name: string
  type?: "embedded" | string
  path: string
  adb_port: number
  status: "running" | "stopped"
}

export interface EmulatorStatus {
  adb_available: boolean
  adb_path: string
  emulators: EmulatorInfo[]
  devices: Array<{ device_id: string; status: string }>
}

export interface ApkInfo {
  title: string
  package_name: string
  path: string
  size: number
}

export interface SdkStatus {
  installed: boolean
  cmdline_tools: boolean
  emulator: boolean
  platform_tools: boolean
  system_image: boolean
  avd_exists: boolean
  emulator_running: boolean
}

export interface SdkSetupProgress {
  status: "idle" | "pending" | "downloading" | "installing_sdk" | "creating_avd" | "completed" | "failed" | "cancelled"
  progress: number
  step: string
  step_detail: string
  downloaded_bytes: number
  total_bytes: number
  speed_bps: number
  eta_seconds: number
  error: string | null
}

export interface ElectronAPI {
  isElectron: boolean
  platform: string
  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdateAvailable: (cb: (data: { version: string; releaseDate: string }) => void) => () => void
  onUpdateProgress: (cb: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void
  onUpdateDownloaded: (cb: () => void) => () => void
  selectApkFile: () => Promise<string[]>
  selectApkFolder: () => Promise<string>
  selectSubtitleFiles: () => Promise<string[]>
  openHtmlGame: (opts: { gameId: number; title: string; serveUrl: string }) => Promise<void>
  closeHtmlGame: (opts: { gameId: number }) => Promise<void>
  showConfirm: (message: string) => Promise<boolean>
}

// --- QA ---

export interface QAResult {
  id: number
  game_id: number
  entry_index: number
  check_type: "untranslated" | "length_overflow" | "placeholder_mismatch" | "consistency"
  severity: "error" | "warning" | "info"
  message: string
  detail_json: Record<string, unknown>
  resolved: boolean
  created_at: string
}

export interface QASummary {
  total: number
  unresolved: number
  by_type: Record<string, number>
  by_severity: Record<string, number>
}

export interface QARunResult {
  total: number
  errors: number
  warnings: number
  issues: QAResult[]
}

// --- Translation Strings ---

export interface TranslationEntry {
  original: string
  translated: string
  status: string
  namespace?: string
  tag?: string
  context?: string
  review_status?: string
  reviewer_note?: string
  edited_at?: string
}

export interface TranslationStringsResponse {
  entries: TranslationEntry[]
  total: number
  page: number
  per_page: number
}

// --- Glossary ---

export interface GlossaryTerm {
  source: string
  target: string
  frequency: number
  source_type?: string
}

export interface GlossarySuggestion {
  source: string
  target: string
  confidence: number
  count: number
}

// --- Export/Import ---

export interface ExportProject {
  game: Partial<Game>
  entries: TranslationEntry[]
  preset?: Partial<TranslationPreset>
  exported_at: string
}

export interface ImportResult {
  total: number
  matched: number
  updated: number
  new_entries: number
  mode: "merge" | "replace"
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
