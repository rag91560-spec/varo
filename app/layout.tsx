import type { Metadata } from "next"
import "./globals.css"
import { Sidebar } from "@/components/layout/Sidebar"
import { UpdateBanner } from "@/components/UpdateBanner"
import { SyncWorker } from "@/components/SyncWorker"
import { Providers } from "./providers"

export const metadata: Metadata = {
  title: {
    default: "게임번역기 - AI Game Translator",
    template: "%s | 게임번역기",
  },
  description: "AI 기반 게임 번역기. 일본어 게임을 한국어로 자동 번역합니다.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko" className="dark" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#5b5ef0" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"
        />
      </head>
      <body className="antialiased min-h-screen flex">
        <Providers>
          <div className="flex min-h-screen w-full">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <UpdateBanner />
              <SyncWorker />
              <main className="flex-1">{children}</main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  )
}
