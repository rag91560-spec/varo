"use client";

import { useState, useCallback, useEffect } from "react";
import {
  PlayIcon,
  PauseIcon,
  FolderOpenIcon,
  ChevronDownIcon,
  SettingsIcon,
  ZapIcon,
  Loader2Icon,
  CheckCircleIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useLocale } from "@/hooks/use-locale";
import { useGames, useSettings, useTranslationProgress } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { PROVIDERS, getProvider } from "@/lib/providers";
import type { TranslationPreset } from "@/lib/types";

export default function TranslatePage() {
  const { t } = useLocale();
  const { games } = useGames();
  const { settings } = useSettings();
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [selectedProvider, setSelectedProvider] = useState("claude_oauth");
  const [selectedModel, setSelectedModel] = useState("");
  const [sourceLang, setSourceLang] = useState("ja");
  const [targetLang, setTargetLang] = useState("ko");
  const [scanning, setScanning] = useState(false);
  const [presets, setPresets] = useState<TranslationPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);

  // Load presets
  useEffect(() => {
    api.presets
      .list()
      .then(setPresets)
      .catch(() => {});
  }, []);

  // When preset selected, apply its settings
  useEffect(() => {
    if (selectedPresetId) {
      const preset = presets.find((p) => p.id === selectedPresetId);
      if (preset) {
        if (preset.provider) setSelectedProvider(preset.provider);
        if (preset.model) setSelectedModel(preset.model);
      }
    }
  }, [selectedPresetId, presets]);

  // Update model when provider changes
  useEffect(() => {
    const prov = getProvider(selectedProvider);
    if (prov) setSelectedModel(prov.defaultModel);
  }, [selectedProvider]);

  const { progress, status, message, connect, disconnect, reset } =
    useTranslationProgress(selectedGameId);

  const selectedGame = games.find((g) => g.id === selectedGameId);
  const currentProvider = getProvider(selectedProvider);
  const isTranslating = status === "running" || status === "connecting";
  const isCompleted = status === "completed";

  const handleStart = useCallback(async () => {
    if (!selectedGameId) return;

    // Scan first if no strings detected
    if (selectedGame && selectedGame.string_count === 0) {
      setScanning(true);
      try {
        await api.games.scan(selectedGameId);
      } catch {
        setScanning(false);
        return;
      }
      setScanning(false);
    }

    reset();
    try {
      const apiKeys = (settings.api_keys ?? {}) as Record<string, string>;
      await api.translate.start(selectedGameId, {
        provider: selectedProvider,
        api_key: apiKeys[selectedProvider] || "",
        model: selectedModel || undefined,
        source_lang: sourceLang,
        preset_id: selectedPresetId || undefined,
      });
      connect();
    } catch {
      // ignore
    }
  }, [
    selectedGameId,
    selectedGame,
    selectedProvider,
    selectedModel,
    sourceLang,
    settings,
    connect,
    reset,
    selectedPresetId,
  ]);

  const handleStop = useCallback(async () => {
    if (!selectedGameId) return;
    try {
      await api.translate.cancel(selectedGameId);
      disconnect();
    } catch {
      // ignore
    }
  }, [selectedGameId, disconnect]);

  const handleApply = useCallback(async () => {
    if (!selectedGameId) return;
    try {
      await api.translate.apply(selectedGameId);
    } catch {
      // ignore
    }
  }, [selectedGameId]);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
          {t("translate")}
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          게임을 선택하고 번역을 시작하세요
        </p>
      </div>

      {/* Game Selection */}
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpenIcon className="size-5 text-accent" />
            게임 선택
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <select
              value={selectedGameId ?? ""}
              onChange={(e) =>
                setSelectedGameId(
                  e.target.value ? parseInt(e.target.value) : null,
                )
              }
              className="w-full h-12 px-3 pr-10 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
            >
              <option value="">라이브러리에서 게임 선택...</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title} ({g.engine || "미감지"}) —{" "}
                  {g.string_count.toLocaleString()} 문자열
                </option>
              ))}
            </select>
            <ChevronDownIcon className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-text-tertiary pointer-events-none" />
          </div>

          {selectedGame && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-elevated">
              <div className="size-10 rounded-md bg-accent/10 flex items-center justify-center">
                <FolderOpenIcon className="size-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {selectedGame.title}
                </p>
                <p className="text-xs text-text-tertiary font-mono truncate">
                  {selectedGame.path}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-text-secondary">
                  {selectedGame.engine || "엔진 미감지"}
                </p>
                <p className="text-xs font-mono text-accent">
                  {selectedGame.string_count.toLocaleString()} 문자열
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Provider & Model */}
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ZapIcon className="size-4 text-accent" />
            AI 제공자 & 모델
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Provider Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProvider(p.id)}
                className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-[140ms] text-left ${
                  selectedProvider === p.id
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "bg-surface-elevated text-text-secondary hover:text-text-primary border border-transparent hover:border-border"
                }`}
              >
                <span className="block truncate">{p.name}</span>
                {!p.needsKey && (
                  <span className="text-[9px] text-text-tertiary block mt-0.5">
                    키 불필요
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Model Selector */}
          {currentProvider && currentProvider.models.length > 1 && (
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                모델
              </label>
              <div className="flex flex-wrap gap-1.5">
                {currentProvider.models.map((m) => (
                  <button
                    key={m}
                    onClick={() => setSelectedModel(m)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-mono transition-all duration-[140ms] ${
                      selectedModel === m
                        ? "bg-accent/15 text-accent border border-accent/30"
                        : "bg-surface-elevated text-text-secondary hover:text-text-primary border border-transparent hover:border-border"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Language Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-surface h-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SettingsIcon className="size-4 text-accent" />
              언어 설정
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                {t("sourceLanguage")}
              </label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="ja">{t("japanese")}</option>
                <option value="en">{t("english")}</option>
                <option value="zh">{t("chinese")}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                {t("targetLanguage")}
              </label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-border bg-surface-elevated text-text-primary text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="ko">{t("korean")}</option>
                <option value="en">{t("english")}</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Preset Selector */}
        <Card className="bg-surface h-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SlidersHorizontalIcon className="size-4 text-accent" />
              프리셋
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedPresetId(null)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-[140ms] ${
                  !selectedPresetId
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "bg-surface-elevated text-text-secondary hover:text-text-primary border border-transparent hover:border-border"
                }`}
              >
                사용 안함
              </button>
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPresetId(p.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-[140ms] ${
                    selectedPresetId === p.id
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : "bg-surface-elevated text-text-secondary hover:text-text-primary border border-transparent hover:border-border"
                  }`}
                >
                  {p.name}
                </button>
              ))}
              {presets.length === 0 && (
                <p className="text-xs text-text-tertiary py-2">
                  프리셋 페이지에서 생성하세요
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress & Action */}
      <Card className="bg-surface">
        <CardContent className="py-5">
          {/* Progress Bar */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text-primary">
                {t("progress")}
              </span>
              <span className="text-sm font-mono text-accent">
                {Math.round(progress.progress)}%
              </span>
            </div>
            <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            {(isTranslating || message) && (
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-text-tertiary">
                  {message || t("translating")}
                </p>
                {progress.total > 0 && (
                  <p className="text-xs text-text-secondary font-mono">
                    {progress.translated}/{progress.total}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            {isCompleted ? (
              <Button
                variant="default"
                size="lg"
                className="flex-1"
                onClick={handleApply}
              >
                <CheckCircleIcon className="size-5" />
                번역 적용
              </Button>
            ) : (
              <Button
                variant={isTranslating ? "secondary" : "default"}
                size="lg"
                className="flex-1"
                onClick={isTranslating ? handleStop : handleStart}
                disabled={!selectedGameId}
                loading={scanning}
              >
                {scanning ? (
                  <>
                    <Loader2Icon className="size-5" />
                    스캔 중...
                  </>
                ) : isTranslating ? (
                  <>
                    <PauseIcon className="size-5" />
                    {t("stopTranslation")}
                  </>
                ) : (
                  <>
                    <PlayIcon className="size-5" />
                    {t("startTranslation")}
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
