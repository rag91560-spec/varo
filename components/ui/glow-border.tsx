"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export type GlowIntensity = "micro" | "subtle" | "soft" | "medium" | "strong"

const INTENSITY_MAP: Record<GlowIntensity, number> = {
  micro: 0.5,
  subtle: 1.5,
  soft: 2.0,
  medium: 3.5,
  strong: 8.0,
}

interface GlowBorderProps {
  children: React.ReactNode
  intensity?: GlowIntensity
  borderRadius?: string
  borderWidth?: number
  glowRadius?: number
  className?: string
  showOnlyOnHover?: boolean
}

export function GlowBorder({
  children,
  intensity = "medium",
  borderRadius = "16px",
  borderWidth = 1.5,
  glowRadius = 120,
  className,
  showOnlyOnHover = true,
}: GlowBorderProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [isHovered, setIsHovered] = React.useState(false)
  const mousePos = React.useRef({ x: 0, y: 0 })
  const animRef = React.useRef<number>(0)

  const draw = React.useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const mul = INTENSITY_MAP[intensity]
    const x = mousePos.current.x
    const y = mousePos.current.y

    // Radial gradient at mouse position
    const grad = ctx.createRadialGradient(x, y, 0, x, y, glowRadius * mul)
    grad.addColorStop(0, `rgba(10, 186, 181, ${0.8 * mul / 3.5})`)   // Tiffany
    grad.addColorStop(0.3, `rgba(110, 231, 183, ${0.4 * mul / 3.5})`) // Mint
    grad.addColorStop(0.6, `rgba(139, 92, 246, ${0.3 * mul / 3.5})`)  // Violet
    grad.addColorStop(1, "transparent")

    // Draw border path
    const r = parseFloat(borderRadius)
    const bw = borderWidth

    ctx.beginPath()
    ctx.roundRect(0, 0, rect.width, rect.height, r)
    ctx.roundRect(bw, bw, rect.width - bw * 2, rect.height - bw * 2, Math.max(0, r - bw))
    ctx.fillStyle = grad
    ctx.fill("evenodd")
  }, [intensity, borderRadius, borderWidth, glowRadius])

  React.useEffect(() => {
    if (!isHovered && showOnlyOnHover) return

    const animate = () => {
      draw()
      animRef.current = requestAnimationFrame(animate)
    }
    animRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animRef.current)
  }, [isHovered, showOnlyOnHover, draw])

  const handleMouseMove = React.useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    mousePos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false)
        const canvas = canvasRef.current
        if (canvas) {
          const ctx = canvas.getContext("2d")
          ctx?.clearRect(0, 0, canvas.width, canvas.height)
        }
      }}
      onMouseMove={handleMouseMove}
      style={{ borderRadius }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-10"
        style={{ borderRadius }}
      />
      {children}
    </div>
  )
}
