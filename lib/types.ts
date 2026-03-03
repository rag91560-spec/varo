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
}

export interface TranslateRequest {
  provider: string
  api_key?: string
  model?: string
  source_lang?: string
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
}

export interface Settings {
  [key: string]: unknown
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
