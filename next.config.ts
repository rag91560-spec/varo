import type { NextConfig } from "next"
import { readFileSync } from "fs"
import path from "path"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  outputFileTracingRoot: path.resolve(__dirname),
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ]
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // 백엔드가 쓰는 폴더는 watcher에서 제외 — data/logs 변경마다 재컴파일되는 문제 방지
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.next/**",
          "**/data/**",
          "**/logs/**",
          "**/dist/**",
          "**/dist-electron/**",
          "**/dist-electron2/**",
          "**/build-staging/**",
        ],
      }
    }
    return config
  },
}

export default nextConfig
