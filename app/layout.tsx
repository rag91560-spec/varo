import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { AppShell } from "@/components/layout/AppShell"
import { Providers } from "./providers"

const pretendard = localFont({
  src: [
    { path: "../public/fonts/PretendardVariable.woff2", weight: "100 900" },
  ],
  variable: "--font-pretendard",
  display: "swap",
  fallback: ["SF Pro Display", "Roboto", "Noto Sans KR", "sans-serif"],
})

export const metadata: Metadata = {
  title: {
    default: "Varo (게임번역기) - AI Game Translator",
    template: "%s | Varo",
  },
  description: "AI 기반 게임 번역기. 일본어 게임을 한국어로 자동 번역합니다.",
}

// Inline script to apply saved theme before first paint (prevents FOUC)
const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem('gt-theme') || 'dark';
    var r = t === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : t;
    document.documentElement.classList.add(r);
    if (r === 'light') document.documentElement.classList.remove('dark');
  } catch(e){}
})();
`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko" className="dark" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#5b5ef0" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${pretendard.variable} antialiased min-h-screen flex`}>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
