"use client"
import type React from "react"
import { useState } from "react"

type Section = {
  title: string
  items: string[]
  description?: string
  videoNote?: string
  videoUrl?: string
  previewUrl?: string
  color: string
  accent: string
}

const SECTIONS: Section[] = [
  {
    title: "Qode All Weather (QAW)™",
    color: "#008455",
    accent: "#001E13",
    description:
      "Qode All Weather (QAW) is a multi-asset portfolio crafted to deliver consistent long-term performance without timing the markets. This robust framework ensures strong probability of outperforming large cap indices over longer horizons.",
    items: ["Large cap Alpha", "Highest Sharpe*", "Smart Asset Mix", "Downside Cushion"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
  {
    title: "Qode Tactical Fund (QTF)™",
    color: "#550e0e",
    accent: "#360404",
    description:
      "Qode Tactical Fund harnesses the power of momentum, systematically allocating to the strongest market trends while avoiding laggards. This allows the strategy to capture upside faster and deliver higher long-term returns.",
    items: ["Momentum Driven", "Tactical Rebalance", "Regime Switch", "Hedge Overlay*"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
  {
    title: "Qode Growth Fund (QGF)™",
    color: "#0b3452",
    accent: "#051E31",
    description:
      "Qode Growth Fund (QGF) is a factor-based small-cap strategy designed to outperform over long periods. The strategy identifies fundamentally strong, high-growth businesses using a disciplined quantitative model.",
    items: ["Quantitative Strategy", "Small cap focused", "Multifactor Model", "Growth Investing"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
  {
    title: "Qode Future Horizons (QFH)™",
    color: "#A78C11",
    accent: "#554602",
    description:
      "Qode Future Horizons (QFH) targets high-growth, under-researched small and micro-cap companies with limited institutional coverage. The strategy seeks asymmetric payoffs, accepting higher volatility and drawdowns.",
    items: ["Quantamental", "Multi-bagger", "Concentrated", "Uncharted*"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
]

const GLOSSARY = {
  "Highest Sharpe*": "A measure of risk-adjusted returns - higher values indicate better performance per unit of risk taken.",
  "Hedge Overlay*": "Risk management technique using derivatives to protect against adverse market movements while maintaining upside potential.",
  "Uncharted*": "Investing in lesser-known companies with limited analyst coverage, potentially offering undiscovered opportunities."
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div 
      className="flex justify-center items-center group relative overflow-hidden rounded-xl border-2 bg-white/80 px-4 py-3 text-center font-medium text-gray-800 shadow-sm transition-all duration-300 hover:scale-105 hover:shadow-lg backdrop-blur-sm min-h-[3rem]"
      style={{ 
        borderColor: color,
        background: `linear-gradient(135deg, white 0%, ${color}08 100%)`
      }}
    >
      <span className="text-sm leading-tight relative z-8">{children}</span>
    </div>
  )
}

function VideoModal({
  open,
  onClose,
  videoUrl,
}: {
  open: boolean
  onClose: () => void
  videoUrl: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl mx-4 rounded-2xl bg-white shadow-2xl overflow-hidden">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-sm transition-colors hover:bg-black/40"
          aria-label="Close video"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="aspect-video w-full">
          <iframe
            width="100%"
            height="100%"
            src={videoUrl}
            title="Fund manager video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      </div>
    </div>
  )
}

function StrategySection({
  title,
  items,
  description,
  videoNote,
  videoUrl,
  previewUrl,
  color,
  accent,
  onVideoClick,
  index,
}: Section & { onVideoClick: (url: string) => void; index: number }) {
  const isEven = index % 2 === 0

  return (
    <section className="h-full">
      <div 
        className="relative h-full overflow-hidden rounded-3xl shadow-2xl flex flex-col min-h-[400px]"
        style={{
          background: `linear-gradient(to right, ${color} 0%, ${accent} 100%)`
        }}
      >
        {/* Background Pattern */}
        <div className="absolute h-full inset-0 opacity-10">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id={`pattern-${index}`} x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="2" fill="white" opacity="0.3" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#pattern-${index})`} />
          </svg>
        </div>

        <div className="relative flex-1 z-8 p-8 flex flex-col">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-4 mb-4">
              <div 
                className="h-2 w-16 rounded-full"
                style={{ backgroundColor: 'white' }}
              />
              <h2 className="text-2xl font-bold text-white tracking-tight">{title}</h2>
            </div>
            {description && (
              <p className="text-white/90 text-md leading-relaxed">
                {description}
              </p>
            )}
          </div>

          {/* Content Grid - Takes remaining space */}
          <div className="flex-1 flex items-center">
            <div className="w-full">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {items.map((label, i) => (
                  <Pill key={`${title}-${i}`} color={color}>
                    {label}
                  </Pill>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Tooltip({ term, definition }: { term: string; definition: string }) {
  return (
    <div className="group relative inline-block">
      <span className="cursor-help border-b border-dotted border-muted-foreground/60">
        {term}
      </span>
      <div className="invisible group-hover:visible absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg whitespace-normal w-64 z-10">
        {definition}
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
      </div>
    </div>
  )
}

export default function StrategySnapshotPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [activeVideo, setActiveVideo] = useState<string | null>(null)

  const openVideo = (url: string) => {
    setActiveVideo(url)
    setModalOpen(true)
  }

  return (
    <main className="space-y-8">
      <header className="mb-6">
        <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">
          Strategy Snapshot
        </h1>
        <p className="text-sm text-muted-foreground">
          Discover Qode's investment strategies and their core pillars designed for different risk profiles and investment horizons.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {SECTIONS.map((section, index) => (
          <StrategySection 
            key={section.title} 
            {...section} 
            index={index}
            onVideoClick={openVideo} 
          />
        ))}
      </div>

      {/* Glossary Section */}
      <div className="mt-12 p-6 bg-gray-50 rounded-xl border">
        <h3 className="text-lg font-semibold text-foreground mb-4">Glossary</h3>
        <div className="space-y-3">
          {Object.entries(GLOSSARY).map(([term, definition]) => (
            <div key={term} className="flex flex-col sm:flex-row sm:gap-4">
              <dt className="font-medium text-foreground min-w-[140px]">{term}</dt>
              <dd className="text-sm text-muted-foreground leading-relaxed">{definition}</dd>
            </div>
          ))}
        </div>
      </div>

      <VideoModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        videoUrl={activeVideo ?? ""}
      />
    </main>
  )
}