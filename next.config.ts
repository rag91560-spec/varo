import type { NextConfig } from "next"
import { readFileSync } from "fs"

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"))

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
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
}

export default nextConfig
