"use client"

import {
  DownloadIcon,
  ShieldCheckIcon,
  KeyIcon,
  ExternalLinkIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"

export default function DownloadPage() {
  const { t } = useLocale()

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
          {t("download")}
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          게임번역기 데스크톱 앱을 다운로드하세요
        </p>
      </div>

      {/* Download Card */}
      <Card className="bg-surface overflow-hidden">
        <div className="bg-accent p-6">
          <h2 className="text-xl font-bold text-white">게임번역기 v1.1.0</h2>
          <p className="text-sm text-white/80 mt-1">
            18개 엔진 지원 + 오프라인 AI 번역
          </p>
        </div>
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-lg bg-surface-elevated">
              <p className="text-lg font-bold text-accent">18</p>
              <p className="text-xs text-text-tertiary">지원 엔진</p>
            </div>
            <div className="p-3 rounded-lg bg-surface-elevated">
              <p className="text-lg font-bold text-accent">6</p>
              <p className="text-xs text-text-tertiary">AI 제공자</p>
            </div>
            <div className="p-3 rounded-lg bg-surface-elevated">
              <p className="text-lg font-bold text-accent">2</p>
              <p className="text-xs text-text-tertiary">오프라인 모델</p>
            </div>
          </div>

          <Button variant="default" size="lg" className="w-full">
            <DownloadIcon className="size-5" />
            Windows 다운로드 (.exe)
          </Button>
        </CardContent>
      </Card>

      {/* License */}
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyIcon className="size-5 text-accent" />
            라이선스 인증
          </CardTitle>
          <CardDescription>
            구매한 라이선스 키를 입력하여 인증하세요
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="text"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="w-full h-11 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all tracking-wider text-center"
          />
          <Button variant="secondary" size="sm" className="w-full">
            <ShieldCheckIcon className="size-4" />
            인증하기
          </Button>
        </CardContent>
      </Card>

      {/* Fanbox */}
      <Card className="bg-surface border-border-subtle">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Fanbox 구독자</p>
            <p className="text-xs text-text-tertiary">자동 인증됩니다</p>
          </div>
          <Button variant="ghost" size="sm">
            <ExternalLinkIcon className="size-4" />
            Fanbox
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
