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
  folder_id: number | null
}

export interface GameFolder {
  id: number
  name: string
  sort_order: number
  created_at: string
  parent_id: number | null
}

export interface TranslateRequest {
  provider: string
  model?: string
  source_lang?: string
  target_lang?: string
  preset_id?: number
  start_index?: number
  end_index?: number
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
  current_index?: number
  current_original?: string
  current_translated?: string
  dedup_stats?: DedupStats
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
  safety?: "safe" | "risky" | "unsafe"
  review_status?: string
  reviewer_note?: string
  edited_at?: string
}

export interface TranslationStringsResponse {
  entries: TranslationEntry[]
  total: number
  page: number
  per_page: number
  safety_counts?: { safe: number; risky: number; unsafe: number }
}

export interface DedupStats {
  total_strings: number
  unique_strings: number
  exact_dedup: number
  fuzzy_dedup: number
  tm_hits: number
  api_calls: number
  saved_pct: number
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

// --- Media ---

export interface MediaFolder {
  id: number
  game_id: number
  folder_path: string
  media_type: "audio" | "video" | "script"
  label: string | null
  created_at: string
}

export interface MediaFile {
  name: string
  path: string
  type: "audio" | "video" | "script"
  size: number
  folder_id: number
}

export interface ScriptTranslation {
  original: string[]
  translated: string[]
  source_path: string
  total: number
  cached: number
}

export interface MediaScanResult {
  added: Array<{ folder_path: string; media_type: string; file_count: number }>
  skipped: string[]
  total_files: number
}

// --- Videos ---

export interface VideoItem {
  id: number
  title: string
  type: "local" | "url"
  source: string
  thumbnail: string
  duration: number
  size: number
  category_id: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface AudioItem {
  id: number
  title: string
  type: "local" | "url"
  source: string
  thumbnail: string
  duration: number
  size: number
  category_id: number | null
  sort_order: number
  script_text?: string
  translated_script?: string
  created_at: string
  updated_at: string
}

export interface MediaCategory {
  id: number
  name: string
  media_type: "video" | "audio" | "manga"
  sort_order: number
  parent_id: number | null
  item_count?: number
  glossary_json?: string
  created_at: string
  updated_at: string
}

export interface AudioBulkJobStatus {
  status: "idle" | "running" | "completed" | "error" | "cancelled"
  progress: number
  done: number
  total: number
  current_title: string
  error?: string
  results?: Array<{ audio_id: number; ok: boolean; mode?: string; error?: string }>
  item_updates?: AudioItem[]
}

// --- Manga ---

export interface MangaItem {
  id: number
  title: string
  source_url: string
  source_type: "manual"
  artist: string
  tags: string
  page_count: number
  thumbnail_path: string
  category_id: number | null
  translated_pages?: number
  created_at: string
  updated_at: string
  images?: string[]
}

export interface MangaTranslationEntry {
  original: string
  translated: string
  x: number
  y: number
  width: number
  height: number
  direction: "horizontal" | "vertical"
  polygon?: number[][]
  text_color?: string
  bg_type?: string
}

export interface MangaTranslationResult {
  cached: boolean
  translation: {
    original_text: string
    translated_text: string
    positions: MangaTranslationEntry[]
  }
}

// --- Subtitles ---

export interface SubtitleSet {
  id: number
  media_id: number
  media_type: "video" | "audio"
  label: string
  source_lang: string
  target_lang: string
  stt_provider: string
  stt_model: string
  status: "pending" | "transcribing" | "transcribed" | "translating" | "translated" | "error"
  duration: number
  segment_count: number
  created_at: string
  updated_at: string
}

export interface SubtitleSegment {
  id: number
  subtitle_id: number
  seq: number
  start_time: number
  end_time: number
  original_text: string
  translated_text: string
  confidence: number
  edited: number
  pos_x?: number | null
  pos_y?: number | null
}

export interface SubtitleJobStatus {
  job_id: string
  status: string
  progress: number
  error_message?: string
}

export interface SubtitleExportOptions {
  format: "srt" | "vtt" | "ass"
  use_translated: boolean
  font_name?: string
  font_size?: number
  primary_color?: string
  outline_color?: string
  alignment?: number
  margin_v?: number
}

export interface SubtitleGlossaryEntry {
  id: number
  subtitle_id: number
  source: string
  target: string
  category: "character" | "place" | "term" | "general"
  auto_generated: number
  created_at: string
}

export interface SubtitleStyleOptions {
  font_name: string
  font_size: number
  primary_color: string       // ASS &HAABBGGRR format
  outline_color: string
  outline_width: number       // 0-8, 0 = no outline
  alignment: number           // numpad: 2=bottom, 8=top, 5=center
  margin_v: number
}

// --- Video Download ---

export interface VideoDownloadJob {
  job_id: string
  status: "running" | "completed" | "error" | "cancelled"
  progress: number
  message?: string
  video_id?: number
  title?: string
  duration?: number
  filesize?: number
  error_message?: string
}

// --- Subtitle Sync ---

export interface SyncResult {
  offset_ms: number
  stretch_factor: number
  confidence: number
  segments_updated: number
}

// --- Manga Rendering ---

export type InpaintMode = "solid" | "telea" | "ns" | "lama"

export type DetectorType = "gemini" | "local"

export interface RenderConfig {
  inpaint_mode: InpaintMode
  font_id: string
  auto_color: boolean
  outline_enabled: boolean
  outline_width: number
  direction: "auto" | "horizontal" | "vertical"
}

export interface FontInfo {
  id: string
  name: string
  type: "sans" | "serif" | "comic"
  installed: boolean
  file?: string
}

export interface MangaRenderStatus {
  manga_id: number
  total_pages: number
  rendered_pages: number
  pages: Record<number, { rendered: boolean; inpaint_mode?: string; font_id?: string }>
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

// --- Live Translation ---

export interface OCRTextBlock {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence?: number
}

export interface OCRResponse {
  blocks: OCRTextBlock[]
  full_text: string
  language: string
  engine: string
  error?: string
}

export interface TranslatedBlock {
  original: string
  translated: string
  x: number
  y: number
  width: number
  height: number
}

export interface LiveTranslationResult {
  id: string
  original: string
  translated: string
  blocks: OCRTextBlock[]
  translatedBlocks: TranslatedBlock[]
  /** Capture image dimensions for coordinate scaling */
  imageWidth: number
  imageHeight: number
  timestamp: number
  mode: "ocr" | "vision"
  cached?: boolean
}

export interface LiveSettings {
  sourceId: string
  sourceName: string
  language: string
  ocrEngine: "auto" | "winocr" | "tesseract"
  provider: string
  model: string
  sourceLang: string
  targetLang: string
  autoMode: boolean
  autoIntervalMs: number
  overlayEnabled: boolean
  overlayOpacity: number
  region: CaptureRegion | null
  useVision: boolean
}

export interface CaptureSource {
  id: string
  name: string
  thumbnail: string
  icon: string | null
  isScreen: boolean
}

export interface CaptureRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface VisionEntry {
  original: string
  translated: string
  x: number
  y: number
  width: number
  height: number
}

export interface LiveTranslationAPI {
  listSources: () => Promise<CaptureSource[]>
  captureScreen: (opts: { sourceId: string; region?: CaptureRegion | null }) => Promise<{ image?: string; error?: string }>
  showOverlay: (opts?: { bounds?: { x: number; y: number; width: number; height: number } }) => Promise<void>
  hideOverlay: () => Promise<void>
  updateOverlay: (data: unknown) => Promise<void>
  setOverlayBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
  selectRegion: () => Promise<CaptureRegion | null>
  confirmRegion: (region: CaptureRegion) => Promise<void>
  trackWindow: (sourceId: string) => Promise<void>
  getWindowBounds: (sourceId: string) => Promise<{ found: boolean; name?: string }>
  startAutoCapture: (opts: { sourceId: string; intervalMs: number; region?: CaptureRegion | null }) => Promise<void>
  stopAutoCapture: () => Promise<void>
  registerHotkeys: () => Promise<void>
  unregisterHotkeys: () => Promise<void>
  onOverlayData: (cb: (data: unknown) => void) => () => void
  onAutoCaptureFrame: (cb: (data: { image: string }) => void) => () => void
  onHotkeyCapture: (cb: () => void) => () => void
  onHotkeyOverlay: (cb: () => void) => () => void
  onHotkeyRegion: (cb: () => void) => () => void
}

export interface ElectronAPI {
  isElectron: boolean
  platform: string
  getPathForFile: (file: File) => string
  getAppVersion: () => Promise<string>
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdateAvailable: (cb: (data: { version: string; releaseDate: string }) => void) => () => void
  onUpdateProgress: (cb: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void
  onUpdateDownloaded: (cb: () => void) => () => void
  selectGameFolder: () => Promise<string>
  selectApkFile: () => Promise<string[]>
  selectApkFolder: () => Promise<string>
  selectSubtitleFiles: () => Promise<string[]>
  openHtmlGame: (opts: { gameId: number; title: string; serveUrl: string }) => Promise<void>
  closeHtmlGame: (opts: { gameId: number }) => Promise<void>
  showConfirm: (message: string) => Promise<boolean>
  selectVideoFiles: () => Promise<string[]>
  selectVideoFolder: () => Promise<string>
  selectAudioFolder: () => Promise<string>
  registerKillHotkey: (key: string) => Promise<boolean>
  unregisterKillHotkey: () => Promise<void>
  liveTranslation: LiveTranslationAPI
}

// --- Agent ---

export interface AgentMessage {
  event: "thinking" | "text" | "tool_call" | "tool_result" | "tokens" | "complete" | "error" | "cancelled" | "started" | "init" | "heartbeat" | "waiting" | "user_message"
  data: Record<string, unknown>
}

export interface AgentSession {
  id: string
  game_id: number
  status: "running" | "waiting" | "completed" | "error" | "cancelled" | "idle"
  model: string
  turns: number
  max_turns: number
  input_tokens: number
  output_tokens: number
  result_summary: string
  error_message: string
  messages: AgentMessage[]
  created_at?: string
  completed_at?: string
}

export interface AgentPollResponse {
  job_id?: string
  status: string
  model?: string
  turns?: number
  max_turns?: number
  input_tokens?: number
  output_tokens?: number
  result_summary?: string
  error_message?: string
  messages?: AgentMessage[]
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
