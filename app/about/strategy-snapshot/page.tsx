"use client"
import type React from "react"
import { useState } from "react"

// export const metadata = {
//   title: "Strategy Snapshot • Qode",
// }

type Section = {
  title: string
  items: string[]
  description?: string
  videoNote?: string
  videoUrl?: string
  previewUrl?: string
}

const SECTIONS: Section[] = [
  {
    title: "Qode All Weather (QAW)",
    description:
      "Qode All Weather (QAW) is a multi-asset portfolio crafted to deliver consistent long-term performance without timing the markets. This robust framework ensures strong probability of outperforming large cap indices over longer horizons. It’s designed for investors seeking equity-like growth, but with greater stability and peace of mind, making it an ideal choice for long-term capital compounding without active monitoring or market timing.",
    items: ["Large cap Alpha", "Highest Sharpe", "Smarter Asset Mix", "Downside Cushion"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
  {
    title: "Qode Tactical Fund (QTF)",
    description:
      "Qode Tactical Fund harnesses the power of momentum, systematically allocating to the strongest market trends while avoiding laggards. This allows the strategy to capture upside faster and deliver higher long-term returns compared to traditional approaches. And the objective is not just to capture upside, but to enter at points where downside is already cushioned.",
    items: ["Momentum Driven", "Tactical Rebalance", "Regime Switch", "Hedge Overlay"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
  {
    title: "Qode Growth Fund (QGF)",
    description:
      "Qode Growth Fund (QGF) is a factor-based small-cap strategy designed to outperform over long periods. The strategy identifies fundamentally strong, high-growth businesses using a disciplined quantitative model.",
    items: ["Quantitative Strategy", "Small cap focused", "Multifactor Model", "Growth Investing"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
  {
    title: "Qode Future Horizons (QFH)",
    description:
      "Qode Future Horizons (QFH) targets high-growth, under-researched small and micro-cap companies with limited institutional coverage. The strategy seeks asymmetric payoffs, accepting higher volatility and drawdowns in pursuit of outsized long-term gains. Best suited for investors with high risk tolerance and a long investment horizon.",
    items: ["Quantamental", "Multi-bagger", "Concentrated", "Uncharted"],
    videoNote: "Watch video from Fund Manager",
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    previewUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  },
]

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-secondary px-4 py-6 text-center font-semibold text-primary">
      {children}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="relative w-full max-w-2xl rounded-lg bg-background shadow-lg">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-2 top-2 rounded-full bg-primary px-2 py-1 text-white"
          aria-label="Close video"
        >
          ✕
        </button>
        {/* Video iframe */}
        <div className="aspect-video w-full">
          <iframe
            width="100%"
            height="100%"
            src={videoUrl}
            title="Fund manager video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="rounded-lg"
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
  onVideoClick,
}: Section & { onVideoClick: (url: string) => void }) {
  return (
    <section className="mb-8">
      {/* dark green title bar */}
      <div className="mb-2 rounded-sm bg-primary px-4 py-2">
        <h2 className="text-sm font-bold tracking-wide text-white">{title}</h2>
      </div>

      {/* description */}
      {description && (
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}

      {/* content: left grid of tiles + right video preview */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {items.map((label, i) => (
              <Pill key={`${title}-${i}`}>{label}</Pill>
            ))}
          </div>
        </div>

        <button
          onClick={() => onVideoClick(videoUrl || "")}
          className="group relative max-h-40 overflow-hidden rounded-md border border-border bg-card text-left"
          aria-label={`Play ${title} video`}
        >
          {previewUrl ? (
            <>
              <img
                src={previewUrl}
                alt={`${title} preview`}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
              {/* Overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-12 w-12 fill-current"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span className="mt-2 text-sm">{videoNote}</span>
              </div>
            </>
          ) : (
            <div className="p-4 text-sm text-card-foreground">{videoNote}</div>
          )}
        </button>
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
    <main className="space-y-6">
      <header className="mb-2">
        <h1 className="text-pretty text-xl font-bold text-foreground">Strategy Snapshot</h1>
        <p className="text-sm text-muted-foreground">
          A quick glance at Qode’s investment strategies and their core pillars.
        </p>
      </header>

      {SECTIONS.map((s) => (
        <StrategySection key={s.title} {...s} onVideoClick={openVideo} />
      ))}

      <VideoModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        videoUrl={activeVideo ?? ""}
      />
    </main>
  )
}
