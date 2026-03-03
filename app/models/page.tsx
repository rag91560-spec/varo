"use client"

import { useState, useEffect, useCallback } from "react"
import {
  BrainCircuitIcon,
  CheckCircleIcon,
  HardDriveIcon,
  CpuIcon,
  Loader2Icon,
  FolderOpenIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"

interface ModelInfo {
  id: string
  name: string
  desc: string
  size: string
  speed: string
  quality: string
  installed: boolean
}

export default function ModelsPage() {
  const { t } = useLocale()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsDir, setModelsDir] = useState("")
  const [loading, setLoading] = useState(true)

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.models.list()
      setModels(data.models)
      setModelsDir(data.models_dir)
    } catch {
      setModels([
        {
          id: "nllb-600m",
          name: "NLLB-600M (Quick)",
          desc: "빠른 오프라인 번역. 기본 품질.",
          size: "~500MB",
          speed: "빠름",
          quality: "기본",
          installed: false,
        },
        {
          id: "game-translator-7b",
          name: "Game Translator 7B (Quality)",
          desc: "GPT-4o급 고품질 번역. 성인 콘텐츠 지원.",
          size: "~4.5GB",
          speed: "보통",
          quality: "최상",
          installed: false,
        },
      ])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadModels() }, [loadModels])

  const installedCount = models.filter(m => m.installed).length

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
            {t("models")}
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            오프라인 번역 AI 모델을 관리하세요
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={loadModels}>
          <RefreshCwIcon className="size-4" />
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6">
          <p className="text-2xl font-bold text-accent">{models.length}</p>
          <p className="text-xs text-text-tertiary mt-1">사용 가능</p>
        </div>
        <div className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6">
          <p className="text-2xl font-bold text-success">{installedCount}</p>
          <p className="text-xs text-text-tertiary mt-1">설치됨</p>
        </div>
        <div className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6">
          <p className="text-2xl font-bold text-text-primary">{models.length - installedCount}</p>
          <p className="text-xs text-text-tertiary mt-1">미설치</p>
        </div>
      </div>

      {/* Models Dir */}
      {modelsDir && (
        <div className="rounded-lg p-3 flex items-center gap-2 bg-overlay-2 border border-overlay-4">
          <FolderOpenIcon className="size-4 text-text-tertiary shrink-0" />
          <span className="text-xs text-text-tertiary font-mono truncate">{modelsDir}</span>
        </div>
      )}

      {/* Models List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2Icon className="size-8 text-accent animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {models.map((model) => (
            <Card key={model.id} className="bg-surface">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${
                      model.installed ? "bg-success/15" : "bg-accent/10"
                    }`}>
                      <BrainCircuitIcon className={`size-5 ${
                        model.installed ? "text-success" : "text-accent"
                      }`} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">{model.name}</h3>
                      <p className="text-xs text-text-secondary mt-0.5">{model.desc}</p>
                      <div className="flex items-center gap-4 mt-2">
                        <span className="flex items-center gap-1 text-xs text-text-tertiary">
                          <HardDriveIcon className="size-3" />
                          {model.size}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-text-tertiary">
                          <CpuIcon className="size-3" />
                          {model.speed}
                        </span>
                        <span className={`text-xs font-medium ${
                          model.quality === "최상" ? "text-accent" : "text-text-secondary"
                        }`}>
                          품질: {model.quality}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    {model.installed ? (
                      <div className="flex items-center gap-1.5 text-success text-xs font-medium">
                        <CheckCircleIcon className="size-4" />
                        설치됨
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-text-tertiary text-xs">
                        <XCircleIcon className="size-4" />
                        미설치
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg p-4 bg-overlay-2 border border-overlay-4">
        <p className="text-xs text-text-tertiary">
          오프라인 모델은 데스크톱 앱에서 자동 다운로드됩니다.
          모델 파일을 직접 설치하려면 위 경로에 배치하세요.
        </p>
      </div>
    </div>
  )
}
