/**
 * Prepare Next.js standalone build for Electron packaging.
 * Copies .next/standalone + .next/static + public → build-staging/frontend/
 */
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..")
const STANDALONE = path.join(ROOT, ".next", "standalone")
const STATIC = path.join(ROOT, ".next", "static")
const PUBLIC = path.join(ROOT, "public")
const OUT = path.join(ROOT, "build-staging", "frontend")

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

console.log("[prepare] Cleaning build-staging...")
if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true, force: true })
}

console.log("[prepare] Copying standalone output...")
copyRecursive(STANDALONE, OUT)

console.log("[prepare] Copying static files...")
copyRecursive(STATIC, path.join(OUT, ".next", "static"))

console.log("[prepare] Copying public files...")
copyRecursive(PUBLIC, path.join(OUT, "public"))

console.log("[prepare] Done! Frontend ready at build-staging/frontend/")
