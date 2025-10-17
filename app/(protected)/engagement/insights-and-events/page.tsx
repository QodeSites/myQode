"use client";
import { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const newsletters = [
  { title: "September 2025", url: "https://mailchi.mp/5d3e07c80c7f/qode-august-2025-performance-insights-18237140", type: "newsletter" },
  { title: "August 2025", url: "https://mailchi.mp/e4ca89368133/monthly-newsletter-january-edition-18236461", type: "newsletter" },
  { title: "July 2025", url: "https://mailchi.mp/f53d3709622f/monthly-newsletter-january-edition-18235640", type: "newsletter" },
  { title: "June 2025", url: "https://mailchi.mp/6e40021c045f/monthly-newsletter-january-edition-18235072", type: "newsletter" },
  { title: "May 2025", url: "https://mailchi.mp/eeb4214f0fd7/monthly-newsletter-january-edition-18234411", type: "newsletter" },
  { title: "April 2025", url: "https://mailchi.mp/5555619376ac/monthly-newsletter-january-edition-18233757", type: "newsletter" },
  { title: "March 2025", url: "https://mailchi.mp/9071ba8e1e12/monthly-newsletter-january-edition-18233068", type: "newsletter" },
  { title: "February 2025", url: "https://mailchi.mp/37c659c09be6/monthly-newsletter-january-edition-18232366", type: "newsletter" },
];

const pitchDecks = [
  { title: "July 2025", url: "/QodePitchDescks/Qode_Presentation_July_2025.pdf", type: "pdf" },
  { title: "June 2025", url: "/QodePitchDescks/Qode Presentation_June_2025.pdf", type: "pdf" },
  { title: "May 2025", url: "/QodePitchDescks/Qode Presentation_May 2025.pdf", type: "pdf" },
  { title: "April 2025", url: "/QodePitchDescks/Qode Presentation_April_2025.pdf", type: "pdf" },
  { title: "March 2025", url: "/QodePitchDescks/Qode_Presentation_March_2025.pdf", type: "pdf" },
  { title: "February 2025", url: "/QodePitchDescks/Qode_Presentation_Feb_2025.pdf", type: "pdf" },
  { title: "January 2025", url: "/QodePitchDescks/Qode_Presentation_Jan_2025.pdf", type: "pdf" },
  { title: "December 2024", url: "/QodePitchDescks/Qode_Presentation_Dec_2024.pdf", type: "pdf" },
  { title: "November 2024", url: "/QodePitchDescks/Qode Presentation_Nov 2024.pdf", type: "pdf" },
];

const recordings = [
  { title: "Recording 1", url: "#", type: "video" },
  { title: "Recording 2", url: "#", type: "video" },
  { title: "Recording 3", url: "#", type: "video" },
  { title: "Recording 4", url: "#", type: "video" },
  { title: "Recording 5", url: "#", type: "video" },
];

function SectionBar({ title }: { title: string }) {
  return (
    <div className="mt-6 mb-3 rounded-sm bg-primary px-3 py-2 text-center">
      <h2 className="text-sm font-semibold tracking-wide text-white">{title}</h2>
    </div>
  )
}

function ThumbCard({
  title,
  onClick,
  url,
  type = "default"
}: {
  title: string
  onClick?: () => void
  url?: string
  type?: string
}) {
  return (
    <button
      onClick={onClick}
      className="group flex-shrink-0 w-72 flex flex-col items-center rounded-sm border border-border bg-secondary p-3 hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
    >
      {/* Preview content */}
      {url && type === "newsletter" ? (
  <div className="mb-2 h-60 w-full rounded-sm border border-border bg-background overflow-hidden relative">
    <iframe
      src={url}
      className="absolute top-0 left-0 w-full h-full border-0 pointer-events-none newsletter-iframe"
      style={{
        width: '300%',
        height: '300%',
        transform: 'scale(0.33)',
        transformOrigin: 'top left'
      }}
      title={`Preview of ${title}`}
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
    />
    {/* Overlay to hide top banner - adjust height as needed */}
    <div className="absolute top-0 left-0 right-0 h-10 bg-white pointer-events-none" />
  </div>
      ) : url && type === "pdf" ? (
        <div className="mb-2 h-60 w-full rounded-sm border border-border bg-background overflow-hidden relative">
          <iframe
            src={url}
            className="absolute top-0 left-0 w-full h-full border-0 pointer-events-none"
            style={{
              width: '150%',
              height: '150%',
              transform: 'scale(0.67)',
              transformOrigin: 'top left'
            }}
            title={`Preview of ${title}`}
            loading="lazy"
          />
        </div>
      ) : (
        <div className="mb-2 h-60 w-full rounded-sm border border-border bg-background flex items-center justify-center">
          <span className="text-muted-foreground text-sm">No preview</span>
        </div>
      )}
      <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">{title}</span>
      {type === "pdf" && (
        <span className="text-xs text-blue-600 mt-1">PDF</span>
      )}
    </button>
  )
}

function Slider({
  items,
  onItemClick,
  sectionId
}: {
  items: Array<{ title: string; url?: string; type: string }>
  onItemClick: (index: number) => void
  sectionId: string
}) {
  const sliderRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (sliderRef.current) {
      const scrollAmount = 300;
      sliderRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="relative">
      {/* Left scroll button */}
      <button
        onClick={() => scroll('left')}
        className="absolute left-0 top-1/2 transform -translate-y-1/2 z-10 bg-white/90 hover:bg-white border border-gray-300 rounded-full p-2 shadow-md transition-colors"
        aria-label="Scroll left"
      >
        <ChevronLeft className="w-5 h-5 text-gray-600" />
      </button>

      {/* Slider container */}
      <div
        ref={sliderRef}
        className="flex overflow-x-auto scrollbar-hide gap-4 px-12 py-2"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item, index) => (
          <ThumbCard
            key={`${sectionId}-${index}`}
            title={item.title}
            url={item.url}
            type={item.type}
            onClick={() => onItemClick(index)}
          />
        ))}
      </div>

      {/* Right scroll button */}
      <button
        onClick={() => scroll('right')}
        className="absolute right-0 top-1/2 transform -translate-y-1/2 z-10 bg-white/90 hover:bg-white border border-gray-300 rounded-full p-2 shadow-md transition-colors"
        aria-label="Scroll right"
      >
        <ChevronRight className="w-5 h-5 text-gray-600" />
      </button>
    </div>
  );
}
function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

export function ContentModal({
  isOpen,
  onClose,
  items,
  currentIndex,
  setCurrentIndex,
  modalTitle,
}: {
  isOpen: boolean;
  onClose: () => void;
  items: Array<{ title: string; url?: string; type: string }>;
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  modalTitle: string;
}) {
  const nextItem = () => setCurrentIndex((currentIndex + 1) % items.length);
  const prevItem = () => setCurrentIndex(currentIndex === 0 ? items.length - 1 : currentIndex - 1);
  if (!isOpen) return null;

  const currentItem = items[currentIndex];
  const showPdfFallback = currentItem.type === "pdf" && isIOS();

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center">
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />

      {/* Modal */}
      <div
        className="
          relative flex flex-col w-full max-w-[100vw] bg-white
          h-dvh max-h-[75dvh] rounded-none
          sm:max-h-[90dvh] sm:h-[88vh]
          md:max-h-[100vh] md:max-w-5xl md:rounded-lg md:mx-4
          lg:h-[86vh] lg:max-w-6xl
          box-border overflow-hidden
        "
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Header (sticky) */}
        <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b bg-gray-50 px-3 py-2 md:px-4 md:py-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-gray-900 md:text-lg">
              {currentItem.title}
            </h3>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 md:text-sm">
              <span>{currentIndex + 1} of {items.length}</span>
              <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-800">
                {currentItem.type.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 md:gap-2">
            <button
              onClick={prevItem}
              disabled={items.length <= 1}
              className="h-9 w-9 rounded-md hover:bg-gray-200 disabled:opacity-40 md:h-8 md:w-8"
              aria-label="Previous"
            >
              <ChevronLeft className="mx-auto h-5 w-5" />
            </button>
            <button
              onClick={nextItem}
              disabled={items.length <= 1}
              className="h-9 w-9 rounded-md hover:bg-gray-200 disabled:opacity-40 md:h-8 md:w-8"
              aria-label="Next"
            >
              <ChevronRight className="mx-auto h-5 w-5" />
            </button>

            {currentItem.type === "pdf" && currentItem.url && (
              <a
                href={currentItem.url}
                download
                className="hidden h-9 items-center justify-center rounded-md px-2 hover:bg-gray-200 text-gray-700 md:flex"
                title="Download PDF"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </a>
            )}

            <button
              onClick={onClose}
              className="hidden md:inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-gray-200 md:h-8 md:w-8"
              aria-label="Close"
            >
              <X className="mx-auto h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Always-on-top Close (mobile only) */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="
            md:hidden
            absolute right-3 top-3 z-30
            inline-flex h-9 w-9 items-center justify-center rounded-full
            bg-black/60 text-white backdrop-blur
            active:scale-95
          "
        >
          <X className="h-5 w-5" />
        </button>

        {/* Content */}
        <div className="relative flex-1 overflow-auto overscroll-contain min-h-0 touch-pan-y">
          {currentItem.url && currentItem.url !== "#" ? (
            currentItem.type === "pdf" ? (
              showPdfFallback ? (
                // iOS-friendly PDF fallback
                <div className="h-full w-full">
                  <object
                    data={currentItem.url}
                    type="application/pdf"
                    className="block h-full w-full"
                  >
                    <div className="flex h-full w-full items-center justify-center p-4 text-center">
                      <div>
                        <p className="text-sm text-gray-600 mb-3">
                          This PDF can’t be displayed inline on your device.
                        </p>
                        <a
                          href={currentItem.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-white"
                        >
                          Open PDF in new tab
                        </a>
                      </div>
                    </div>
                  </object>
                </div>
              ) : (
                // Non-iOS: iframe is fine
                <iframe
                  key={currentItem.url}
                  src={currentItem.url}
                  className="block h-full w-full border-0"
                  title={`${modalTitle}: ${currentItem.title}`}
                  allow="clipboard-read; clipboard-write; fullscreen"
                />
              )
            ) : (
              // Non-PDF content
              // Non-PDF content (newsletters)
<div className="relative h-full w-full">
  <iframe
    key={currentItem.url}
    src={currentItem.url}
    className="block h-full w-full border-0"
    title={`${modalTitle}: ${currentItem.title}`}
    allow="clipboard-read; clipboard-write; fullscreen"
    sandbox="allow-scripts allow-same-origin allow-forms"
  />
  {/* Overlay to hide awesomewrap banner - adjust height/position as needed */}
  {modalTitle === "Newsletter" && (
    <div className="absolute top-0 left-0 right-0 h-12 bg-white pointer-events-none" />
  )}
</div>
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
              <div className="text-center">
                <svg className="mx-auto h-16 w-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <p className="mt-2 text-gray-500">Content not available</p>
              </div>
            </div>
          )}
        </div>

        {/* Indicators */}
        <div
          className="
            pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2
            md:static md:mb-3 md:mt-2 md:translate-x-0
          "
        >
          <div className="pointer-events-auto flex gap-2 rounded-full bg-black/50 px-3 py-2 md:bg-transparent">
            {items.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentIndex(index)}
                className={`h-2 w-2 rounded-full transition ${
                  index === currentIndex ? "bg-white md:bg-gray-800" : "bg-gray-400"
                }`}
                aria-label={`Go to item ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


export default function InsightsArchivePage() {
  const [isNewsletterModalOpen, setIsNewsletterModalOpen] = useState(false);
  const [isPitchDeckModalOpen, setIsPitchDeckModalOpen] = useState(false);
  const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
  const [currentNewsletterIndex, setCurrentNewsletterIndex] = useState(0);
  const [currentPitchDeckIndex, setCurrentPitchDeckIndex] = useState(0);
  const [currentRecordingIndex, setCurrentRecordingIndex] = useState(0);

  const openNewsletter = (index: number) => {
    setCurrentNewsletterIndex(index);
    setIsNewsletterModalOpen(true);
  };

  const openPitchDeck = (index: number) => {
    setCurrentPitchDeckIndex(index);
    setIsPitchDeckModalOpen(true);
  };

  const openRecording = (index: number) => {
    setCurrentRecordingIndex(index);
    setIsRecordingModalOpen(true);
  };

  return (
    <main className="mx-auto w-full">
      {/* Market Notes */}
      {/* <SectionBar title="Market Notes" />
      <div className="rounded-sm border border-border bg-secondary p-4 leading-relaxed text-foreground">
        Market breadth has improved meaningfully, with nearly two‑thirds of Nifty 500 stocks trading above their 200‑day
        averages, signaling stronger underlying trends even as indices remain range‑bound. In such phases, systematic
        momentum strategies often have an edge — cutting laggards quickly while allowing winners to run. Qode Tactical
        Fund (QTF) is designed to capture this strength across sectors with disciplined rules.
      </div> */}

      {/* Newsletter Archive */}
      <SectionBar title="Newsletter Archive" />
      <Slider
        items={newsletters}
        onItemClick={openNewsletter}
        sectionId="newsletter"
      />

      {/* Pitch Decks Archive */}
      {/* <SectionBar title="Fact Sheet Archive" />
      <Slider 
        items={pitchDecks}
        onItemClick={openPitchDeck}
        sectionId="pitchDeck"
      /> */}

      {/* Past Recordings */}
      {/* <SectionBar title="Past Recordings (Investor Calls / Webinars, etc.)" />
      <Slider
        items={recordings}
        onItemClick={openRecording}
        sectionId="recording"
      /> */}

      {/* Newsletter Modal */}
 <ContentModal
        isOpen={isNewsletterModalOpen}
        onClose={() => setIsNewsletterModalOpen(false)}
        items={newsletters}
        currentIndex={currentNewsletterIndex}
        setCurrentIndex={setCurrentNewsletterIndex}
        modalTitle="Newsletter"
      /> 

      {/* Pitch Deck Modal */}
      {/* <ContentModal
        isOpen={isPitchDeckModalOpen}
        onClose={() => setIsPitchDeckModalOpen(false)}
        items={pitchDecks}
        currentIndex={currentPitchDeckIndex}
        setCurrentIndex={setCurrentPitchDeckIndex}
        modalTitle="Pitch Deck"
      /> */}

      {/* Recording Modal */}
      {/* <ContentModal
        isOpen={isRecordingModalOpen}
        onClose={() => setIsRecordingModalOpen(false)}
        items={recordings}
        currentIndex={currentRecordingIndex}
        setCurrentIndex={setCurrentRecordingIndex}
        modalTitle="Recording"
      /> */}
    </main>
  )
}