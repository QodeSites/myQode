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
    title: "Qode All Weather (QAW)",
    color: "#008455",
    accent: "#001E13",
    description:
      "Qode All Weather (QAW) is a multi-asset portfolio crafted to deliver consistent long-term performance without timing the markets. This robust framework ensures strong probability of outperforming large cap indices over longer horizons.",
    items: ["Large cap Alpha", "Highest Sharpe", "Smarter Asset Mix", "Downside Cushion"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
  {
    title: "Qode Tactical Fund (QTF)",
    color: "#550e0e",
    accent: "#360404",
    description:
      "Qode Tactical Fund harnesses the power of momentum, systematically allocating to the strongest market trends while avoiding laggards. This allows the strategy to capture upside faster and deliver higher long-term returns.",
    items: ["Momentum Driven", "Tactical Rebalance", "Regime Switch", "Hedge Overlay"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
  {
    title: "Qode Growth Fund (QGF)",
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
    title: "Qode Future Horizons (QFH)",
    color: "#A78C11",
    accent: "#554602",
    description:
      "Qode Future Horizons (QFH) targets high-growth, under-researched small and micro-cap companies with limited institutional coverage. The strategy seeks asymmetric payoffs, accepting higher volatility and drawdowns.",
    items: ["Quantamental", "Multi-bagger", "Concentrated", "Uncharted"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
]

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div 
      className="flex justify-center align-center group relative overflow-hidden rounded-xl border-2 bg-white/80 px-6 py-4 text-center font-medium text-gray-800 shadow-sm transition-all duration-300 hover:scale-105 hover:shadow-lg backdrop-blur-sm"
      style={{ 
        borderColor: color,
        background: `linear-gradient(135deg, white 0%, ${color}08 100%)`
      }}
    >
      <span className="flex text-sm justify-center items-center relative z-8">{children}</span>
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
    <div className="fixed inset-0 z-5 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl mx-4 rounded-2xl bg-white shadow-2xl overflow-hidden">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-8 flex h-10 w-10 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-sm transition-colors hover:bg-black/40"
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
        className="relative h-full overflow-hidden rounded-3xl shadow-2xl"
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

        <div className="relative h-full z-8 p-8">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-4 mb-4">
              <div 
                className="h-2 w-16 rounded-full"
                style={{ backgroundColor: 'white' }}
              />
              <h2 className="text-2xl font-bold text-white tracking-tight">{title}</h2>
            </div>
            {description && (
              <p className="text-white/90 text-md leading-relaxed max-w-4xl">
                {description}
              </p>
            )}
          </div>

          {/* Content Grid */}
          <div className={`grid gap-8 ${isEven ? 'lg:grid-cols-5' : 'lg:grid-cols-5'}`}>
            <div className={`${isEven ? 'lg:col-span-5 lg:order-1' : 'lg:col-span-5 lg:order-2'}`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {items.map((label, i) => (
                  <Pill key={`${title}-${i}`} color={color}>
                    {label}
                  </Pill>
                ))}
              </div>
            </div>

            <div className={`hidden ${isEven ? 'lg:col-span-2 lg:order-2' : 'lg:col-span-2 lg:order-1'}`}>
              <button
                onClick={() => onVideoClick(videoUrl || "")}
                className="group relative h-48 w-full overflow-hidden rounded-2xl border-4 border-white/20 bg-white/10 backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:border-white/40 hover:shadow-xl"
                aria-label={`Play ${title} video`}
              >
                {previewUrl ? (
                  <>
                    <img
                      src={previewUrl}
                      alt={`${title} preview`}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <div className="rounded-full bg-white/20 p-4 backdrop-blur-sm">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-8 w-8 fill-current"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                      <span className="mt-3 text-sm font-medium">{videoNote}</span>
                    </div>
                    {/* Always visible play icon */}
                    <div className="absolute bottom-4 right-4 rounded-full bg-white/20 p-2 backdrop-blur-sm">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 fill-current text-white"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <div className="mb-4 rounded-full bg-white/20 p-4 backdrop-blur-sm">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-8 w-8 fill-current text-white"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                      <span className="text-sm font-medium text-white">{videoNote}</span>
                    </div>
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
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

      <div className="space-y-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {SECTIONS.map((section, index) => (
          <StrategySection 
            key={section.title} 
            {...section} 
            index={index}
            onVideoClick={openVideo} 
          />
        ))}
      </div>

      <VideoModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        videoUrl={activeVideo ?? ""}
      />
    </main>
  )
}