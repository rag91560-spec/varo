export interface ScriptCue {
  index: number
  startTime: number
  endTime: number
  text: string
}

export type ScriptData =
  | { type: "timed"; cues: ScriptCue[] }
  | { type: "plain"; lines: string[] }

function parseTimeSRT(ts: string): number {
  // 00:01:23,456
  const m = ts.match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  if (!m) return 0
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 1000
}

function parseTimeVTT(ts: string): number {
  // 00:01:23.456 or 01:23.456
  const parts = ts.split(/[:.]/);
  if (parts.length === 4) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]) + parseInt(parts[3]) / 1000
  }
  if (parts.length === 3) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]) + parseInt(parts[2]) / 1000
  }
  return 0
}

export function parseSRT(raw: string): ScriptCue[] {
  const cues: ScriptCue[] = []
  const blocks = raw.trim().replace(/\r\n/g, "\n").split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.split("\n")
    if (lines.length < 3) continue
    const timeMatch = lines[1].match(/(.+?)\s*-->\s*(.+)/)
    if (!timeMatch) continue
    const startTime = parseTimeSRT(timeMatch[1].trim())
    const endTime = parseTimeSRT(timeMatch[2].trim())
    const text = lines.slice(2).join("\n").trim()
    if (text) {
      cues.push({ index: cues.length, startTime, endTime, text })
    }
  }
  return cues
}

const LRC_META_RE = /^\[(ar|ti|al|by|offset|length|re|ve|au|la):/i
const LRC_LINE_RE = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g

export function parseLRC(raw: string): ScriptCue[] {
  const content = raw.trim().replace(/\r\n/g, "\n")
  const entries: { start: number; text: string }[] = []
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (LRC_META_RE.test(trimmed)) continue
    // Collect all timestamps at the start of the line
    const stamps: number[] = []
    let match: RegExpExecArray | null
    LRC_LINE_RE.lastIndex = 0
    let lastEnd = 0
    while ((match = LRC_LINE_RE.exec(trimmed)) !== null) {
      if (match.index !== lastEnd) break // stamps must be at the start / contiguous
      const mm = parseInt(match[1], 10)
      const ss = parseInt(match[2], 10)
      const frac = match[3] ? parseInt(match[3], 10) : 0
      // .xx (centiseconds) or .xxx (milliseconds)
      const fracMs = match[3] && match[3].length >= 3 ? frac : frac * 10
      stamps.push(mm * 60 + ss + fracMs / 1000)
      lastEnd = match.index + match[0].length
    }
    if (stamps.length === 0) continue
    const text = trimmed.slice(lastEnd).trim()
    for (const start of stamps) {
      entries.push({ start, text })
    }
  }
  entries.sort((a, b) => a.start - b.start)
  const cues: ScriptCue[] = []
  for (let i = 0; i < entries.length; i++) {
    const start = entries[i].start
    const end = i + 1 < entries.length ? entries[i + 1].start : start + 5
    cues.push({ index: i, startTime: start, endTime: end, text: entries[i].text })
  }
  return cues
}

export function parseVTT(raw: string): ScriptCue[] {
  const cues: ScriptCue[] = []
  const content = raw.trim().replace(/\r\n/g, "\n")
  const blocks = content.split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.split("\n")
    let timeLineIdx = lines.findIndex((l) => l.includes("-->"))
    if (timeLineIdx < 0) continue
    const timeMatch = lines[timeLineIdx].match(/(.+?)\s*-->\s*(.+)/)
    if (!timeMatch) continue
    const startTime = parseTimeVTT(timeMatch[1].trim())
    const endTime = parseTimeVTT(timeMatch[2].trim())
    const text = lines.slice(timeLineIdx + 1).join("\n").trim()
    if (text) {
      cues.push({ index: cues.length, startTime, endTime, text })
    }
  }
  return cues
}

export function parseScript(raw: string): ScriptData {
  const trimmed = raw.trim()
  if (!trimmed) return { type: "plain", lines: [] }

  // VTT detection
  if (trimmed.startsWith("WEBVTT")) {
    const cues = parseVTT(trimmed)
    if (cues.length > 0) return { type: "timed", cues }
  }

  // SRT detection: first block starts with a number, second line has -->
  const firstBlock = trimmed.split(/\n\n/)[0]
  if (firstBlock && /-->/m.test(firstBlock)) {
    const cues = parseSRT(trimmed)
    if (cues.length > 0) return { type: "timed", cues }
  }

  // LRC detection: [mm:ss.xx]text
  if (/^\s*\[\d+:\d+/m.test(trimmed)) {
    const cues = parseLRC(trimmed)
    if (cues.length > 0) return { type: "timed", cues }
  }

  // Plain text fallback
  return { type: "plain", lines: trimmed.split(/\r?\n/) }
}
