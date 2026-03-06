"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  FolderOpenIcon,
  ChevronDownIcon,
  PlayIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useLocale } from "@/hooks/use-locale";
import { useGames } from "@/hooks/use-api";

/**
 * Translate page — game selector that navigates to game detail page
 * for the full translation workflow. Avoids duplicating TranslationPanel logic.
 */
export default function TranslatePage() {
  const { t } = useLocale();
  const router = useRouter();
  const { games } = useGames();
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);

  const selectedGame = games.find((g) => g.id === selectedGameId);

  function handleGoToGame() {
    if (selectedGameId) {
      router.push(`/library/${selectedGameId}`);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
          {t("translate")}
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {t("translateDescription")}
        </p>
      </div>

      {/* Game Selection */}
      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpenIcon className="size-5 text-accent" />
            {t("gameSelection")}
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
              <option value="">{t("selectFromLibrary")}</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title} ({g.engine || t("engineNotDetected")}) —{" "}
                  {g.string_count.toLocaleString()} {t("strings")}
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
                  {selectedGame.engine || t("engineNotDetected")}
                </p>
                <p className="text-xs font-mono text-accent">
                  {selectedGame.string_count.toLocaleString()} {t("strings")}
                </p>
              </div>
            </div>
          )}

          <Button
            size="lg"
            className="w-full"
            onClick={handleGoToGame}
            disabled={!selectedGameId}
          >
            <PlayIcon className="size-5" />
            {t("startTranslation")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
