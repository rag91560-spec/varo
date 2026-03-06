/** AI provider definitions — mirrors ue_translator.py AI_PROVIDERS */

export interface ProviderInfo {
  id: string
  name: string
  needsKey: boolean
  keyHint?: string
  models: string[]
  defaultModel: string
  /** URL to get an API key */
  keyUrl?: string
  /** Short guide steps for getting an API key */
  keyGuide?: string[]
  /** Pricing note */
  pricing?: string
  /** Free tier info */
  freeTier?: string
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "claude_oauth",
    name: "Claude (OAuth/CLI)",
    needsKey: false,
    models: ["sonnet", "opus", "haiku"],
    defaultModel: "sonnet",
  },
  {
    id: "claude_api",
    name: "Claude (API Key)",
    needsKey: true,
    keyHint: "sk-ant-api...",
    models: ["claude-sonnet-4-6-20250514", "claude-haiku-4-5-20251001", "claude-opus-4-6-20250515"],
    defaultModel: "claude-sonnet-4-6-20250514",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyGuide: [
      "console.anthropic.com 접속 → 회원가입 (구글 로그인 가능)",
      "Settings → API Keys → Create Key 클릭",
      "키를 복사해서 아래에 붙여넣기",
    ],
    pricing: "Sonnet: $3/$15 per 1M tokens · Haiku: $0.25/$1.25",
    freeTier: "가입 시 $5 크레딧 제공",
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    needsKey: true,
    keyHint: "sk-...",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
    defaultModel: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    keyGuide: [
      "platform.openai.com 접속 → 회원가입",
      "API Keys 메뉴 → Create new secret key",
      "키를 복사해서 아래에 붙여넣기",
    ],
    pricing: "4o-mini: $0.15/$0.60 · 4o: $2.50/$10 per 1M tokens",
    freeTier: "가입 시 $5 크레딧 (3개월 유효)",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    needsKey: true,
    keyHint: "AIza...",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    defaultModel: "gemini-2.5-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    keyGuide: [
      "aistudio.google.com 접속 → 구글 계정 로그인",
      "Get API Key → Create API Key 클릭",
      "키를 복사해서 아래에 붙여넣기",
    ],
    pricing: "Flash: 무료 (분당 15회) · Pro: 무료 (분당 2회)",
    freeTier: "완전 무료 (속도 제한만 있음)",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    needsKey: true,
    keyHint: "sk-...",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyGuide: [
      "platform.deepseek.com 접속 → 회원가입",
      "API Keys → Create API Key 클릭",
      "키를 복사해서 아래에 붙여넣기",
    ],
    pricing: "Chat: $0.14/$0.28 per 1M tokens (최저가)",
    freeTier: "가입 시 500만 토큰 무료",
  },
  {
    id: "offline",
    name: "오프라인 (NLLB)",
    needsKey: false,
    models: ["nllb-600m-game-v1"],
    defaultModel: "nllb-600m-game-v1",
  },
  {
    id: "offline_hq",
    name: "오프라인 HQ (LLM)",
    needsKey: false,
    models: ["game-translator-7b-q4"],
    defaultModel: "game-translator-7b-q4",
  },
]

/** Get provider by id */
export function getProvider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** Providers that need API keys (for settings page) */
export const KEY_PROVIDERS = PROVIDERS.filter((p) => p.needsKey)

/** Provider IDs used in presets (simplified — backend resolves claude variants) */
export const PRESET_PROVIDER_IDS = ["", "claude", "openai", "gemini", "deepseek", "offline", "offline_hq"] as const

/** Static display names for preset providers */
export const PRESET_PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude",
  openai: "GPT-4o",
  gemini: "Gemini",
  deepseek: "DeepSeek",
}
