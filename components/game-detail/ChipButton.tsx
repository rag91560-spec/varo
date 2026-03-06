"use client"

export function ChipButton({ selected, onClick, children, className = "" }: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1.5 rounded-md text-xs font-medium transition-all duration-[140ms] border
        ${selected
          ? "bg-accent-muted text-accent border-accent/30"
          : "bg-overlay-2 text-text-secondary border-transparent"
        } ${className}`}
    >
      {children}
    </button>
  )
}
