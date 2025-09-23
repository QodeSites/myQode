"use client";
import * as React from "react";

/* =========================
   Types
   ========================= */
type ReportItem = {
  name: string;
  snapshot: string;
  video_tutorial: string;
  used_for?: string;
};

type ReportGroup = {
  id: number;
  type_of_report: string;
  report_name: ReportItem[];
};

type FlatRow = {
  sr: number;
  type: string;
  name: string;
  snapshot: string;
  tutorial: string;
  used_for: string;
};

type VideoFile = {
  name: string;
  url: string;
};

type SnapshotFile = {
  name: string;
  url: string;
};

type SnapshotData = {
  [reportName: string]: SnapshotFile[];
};

/* =========================
   Video Modal Component
   ========================= */
function VideoModal({
  isOpen,
  onClose,
  videoUrl,
  title
}: {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string;
  title: string;
}) {
  const modalRef = React.useRef<HTMLDivElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [playbackSpeed, setPlaybackSpeed] = React.useState(1);

  const speedOptions = [
    { value: 0.25, label: '0.25x' },
    { value: 0.5, label: '0.5x' },
    { value: 0.75, label: '0.75x' },
    { value: 1, label: '1x' },
    { value: 1.25, label: '1.25x' },
    { value: 1.5, label: '1.5x' },
    { value: 1.75, label: '1.75x' },
    { value: 2, label: '2x' },
  ];

  // Close modal on escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  // Handle playback speed change
  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  // Reset speed when modal opens with new video
  React.useEffect(() => {
    if (isOpen && videoRef.current) {
      setPlaybackSpeed(1);
      videoRef.current.playbackRate = 1;
    }
  }, [isOpen, videoUrl]);

  // Close modal on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === modalRef.current) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-4xl bg-white rounded-lg shadow-xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-sm p-1"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Video Container */}
        <div className="pb-2">
          <div className="relative w-full" style={{ paddingBottom: '56.25%' /* 16:9 aspect ratio */ }}>
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              autoPlay
              className="absolute inset-0 w-full h-full rounded"
              onLoadedData={() => {
                if (videoRef.current) {
                  videoRef.current.playbackRate = playbackSpeed;
                }
              }}
              onError={(e) => {
                console.error('Video failed to load:', videoUrl);
                // You could add error handling UI here
              }}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </div>

        {/* Speed Controls */}
        <div className="px-4 pb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">Playback Speed:</span>
            <div className="flex gap-1">
              {speedOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleSpeedChange(option.value)}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors
                    ${playbackSpeed === option.value
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end p-4 border-t bg-gray-50 rounded-b-lg">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Image Modal Component
   ========================= */
function ImageModal({
  isOpen,
  onClose,
  images,
  title
}: {
  isOpen: boolean;
  onClose: () => void;
  images: SnapshotFile[];
  title: string;
}) {
  const modalRef = React.useRef<HTMLDivElement>(null);
  const [currentImageIndex, setCurrentImageIndex] = React.useState(0);

  // Close modal on escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleArrowKeys = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentImageIndex > 0) {
        setCurrentImageIndex(prev => prev - 1);
      } else if (e.key === 'ArrowRight' && currentImageIndex < images.length - 1) {
        setCurrentImageIndex(prev => prev + 1);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('keydown', handleArrowKeys);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', handleArrowKeys);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, currentImageIndex, images.length]);

  // Reset current image index when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setCurrentImageIndex(0);
    }
  }, [isOpen]);

  // Close modal on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === modalRef.current) {
      onClose();
    }
  };

  const goToPrevious = () => {
    setCurrentImageIndex(prev => Math.max(0, prev - 1));
  };

  const goToNext = () => {
    setCurrentImageIndex(prev => Math.min(images.length - 1, prev + 1));
  };

  if (!isOpen || !images || images.length === 0) return null;

  const currentImage = images[currentImageIndex];

  // Additional safety check
  if (!currentImage) return null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-6xl bg-white rounded-lg shadow-xl h-[80vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            {images.length > 1 && (
              <span className="text-sm text-gray-500">
                {currentImageIndex + 1} of {images.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-sm p-1"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Image Container */}
        <div className="flex-1 p-4 flex items-center justify-center min-h-0 relative">
          {/* Navigation Arrows */}
          {images.length > 1 && currentImageIndex > 0 && (
            <button
              onClick={goToPrevious}
              className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-70 text-white p-2 rounded-full z-10"
              aria-label="Previous image"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {images.length > 1 && currentImageIndex < images.length - 1 && (
            <button
              onClick={goToNext}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-70 text-white p-2 rounded-full z-10"
              aria-label="Next image"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          <img
            src={currentImage.url}
            alt={currentImage.name}
            className="max-w-full max-h-full object-contain rounded"
            onError={(e) => {
              console.error('Image failed to load:', currentImage.url);
              // You could add error handling UI here
            }}
          />
        </div>

        {/* Thumbnail Strip (if multiple images) */}
        {images.length > 1 && (
          <div className="border-t p-4">
            <div className="flex gap-2 overflow-x-auto">
              {images.map((image, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentImageIndex(index)}
                  className={`flex-shrink-0 w-16 h-16 rounded border-2 overflow-hidden
                    ${index === currentImageIndex
                      ? 'border-primary'
                      : 'border-gray-200 hover:border-gray-300'
                    }`}
                >
                  <img
                    src={image.url}
                    alt={image.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      console.error('Thumbnail failed to load:', image.url);
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="flex justify-between items-center p-4 border-t bg-gray-50 rounded-b-lg">
          <div className="text-sm text-gray-600">
            {currentImage.name}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  description,
  snapshotImages,
  videoHref,
  videoTitle,
  onVideoClick,
  onSnapshotClick,
  isVideoLoading = false,
  isSnapshotLoading = false,
}: {
  description: string;
  snapshotImages: SnapshotFile[];
  videoHref: string;
  videoTitle: string;
  onVideoClick: (url: string, title: string) => void;
  onSnapshotClick: (images: SnapshotFile[], title: string) => void;
  isVideoLoading?: boolean;
  isSnapshotLoading?: boolean;
}) {
  return (
    <div className="mb-3 last:mb-0">
      {/* ≥sm layout: 5 columns */}
      <div className="hidden sm:grid sm:grid-cols-5 sm:items-center sm:gap-2">
        <p className="sm:col-span-3 text-sm text-card-foreground">{description}</p>
        <div className="sm:col-span-1 text-center">
          <ViewLink
            images={snapshotImages}
            title={videoTitle}
            onClick={onSnapshotClick}
            isLoading={isSnapshotLoading}
          />
        </div>
        <div className="sm:col-span-1 text-center">
          <VideoLink
            href={videoHref}
            title={videoTitle}
            onClick={onVideoClick}
            isLoading={isVideoLoading}
          />
        </div>
      </div>

      {/* Mobile layout: stacked with inline labels */}
      <div className="grid grid-cols-1 gap-2 sm:hidden">
        <p className="text-sm text-card-foreground">{description}</p>

        <div className="grid grid-cols-2 items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Snapshot</span>
          <div className="justify-self-end">
            <ViewLink
              images={snapshotImages}
              title={videoTitle}
              onClick={onSnapshotClick}
              isLoading={isSnapshotLoading}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Video</span>
          <div className="justify-self-end">
            <VideoLink
              href={videoHref}
              title={videoTitle}
              onClick={onVideoClick}
              isLoading={isVideoLoading}
            />
          </div>
        </div>
      </div>

      {/* Divider for mobile only */}
      <div className="sm:hidden mt-3 h-px bg-border" />
    </div>
  );
}

/* =========================
   Data (typed)
   ========================= */
const reports_available: ReportGroup[] = [
  {
    id: 1,
    type_of_report: "Accounting & Financial Report",
    report_name: [
      { name: "Account Statement - Non unitized", snapshot: "", video_tutorial: "" },
      { name: "Account Statement", snapshot: "", video_tutorial: "" },
      {
        name: "Profit and Loss Account - Balance Sheet",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      { name: "Trial Balance", snapshot: "", video_tutorial: "" },
    ],
  },
  {
    id: 2,
    type_of_report: "Activity Report",
    report_name: [
      {
        name: "Transaction Statement",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      {
        name: "Capital Register",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      { name: "Bank Book", snapshot: "", video_tutorial: "" },
    ],
  },
  {
    id: 3,
    type_of_report: "Income, Expenses & Tax Report",
    report_name: [
      { name: "Statement of Interest", snapshot: "", video_tutorial: "" },
      { name: "Statement of Dividend", snapshot: "", video_tutorial: "" },
      {
        name: "Corporate Benefit",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      {
        name: "Statement of Expenses",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      {
        name: "Statement of Capital Gain/Loss",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
    ],
  },
  {
    id: 4,
    type_of_report: "Portfolio Reporting & Performance",
    report_name: [
      { name: "Portfolio Fact Sheet", snapshot: "", video_tutorial: "" },
      { name: "Portfolio Position Analysis", snapshot: "", video_tutorial: "" },
      { name: "Portfolio Performance Summary", snapshot: "", video_tutorial: "" },
      {
        name: "Performance Appraisal",
        snapshot: "",
        video_tutorial: "",
        used_for: "Annual Compliance Reports",
      },
      { name: "Portfolio Performance with Benchmarks", snapshot: "", video_tutorial: "" },
      { name: "Performance by Security Since Inception", snapshot: "", video_tutorial: "" },
      { name: "Portfolio Appraisal", snapshot: "", video_tutorial: "" },
    ],
  },
  {
    id: 5,
    type_of_report: "Combined Report",
    report_name: [
      {
        name: "PMS Investor Report",
        snapshot: "",
        video_tutorial: "",
        used_for: "Quarterly Compliance Reports",
      },
    ],
  },
];

/* =========================
   Helpers
   ========================= */
function getFlatRows(data: ReportGroup[], videoFiles: VideoFile[], snapshotData: SnapshotData): FlatRow[] {
  const rows: FlatRow[] = [];
  let sr = 1;
  data.forEach((group) => {
    group.report_name.forEach((rn) => {
      // Find matching video file for this report
      let videoFile = videoFiles.find(file =>
        file.name.toLowerCase() === rn.name.toLowerCase()
      );

      // Special case: Handle "Statement of Capital Gain/Loss" -> "Statement of Capital Gain Loss"
      if (!videoFile && rn.name === "Statement of Capital Gain/Loss") {
        videoFile = videoFiles.find(file =>
          file.name.toLowerCase() === "statement of capital gain loss"
        );
      }

      rows.push({
        sr: sr++,
        type: group.type_of_report,
        name: rn.name,
        snapshot: rn.snapshot,
        tutorial: videoFile?.url || "",
        used_for: rn.used_for ?? "",
      });
    });
  });
  return rows;
}

/* =========================
   Video Tutorial Fetcher Hook
   ========================= */
function useVideoTutorials() {
  const [videoFiles, setVideoFiles] = React.useState<VideoFile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchVideoTutorials = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const folderUrl = 'https://vault.qodeinvest.com/reports-tutorial/';

      const response = await fetch(folderUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch video tutorials");
      }

      const htmlText = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, "text/html");
      const links = doc.querySelectorAll("a[href]");
      const files: VideoFile[] = [];

      links.forEach((link) => {
        const href = link.getAttribute("href");
        const text = link.textContent?.trim();

        if (
          href &&
          text &&
          !href.includes("../") &&
          !href.endsWith("/") &&
          text !== ".gitkeep" &&
          text !== "Parent Directory"
        ) {
          const fileName = decodeURIComponent(text);
          const fileUrl = `${folderUrl}${encodeURIComponent(fileName)}`;
          files.push({ name: fileName, url: fileUrl });
        }
      });

      setVideoFiles(files);
    } catch (error) {
      console.error("Error fetching video tutorials:", error);
      setError(error instanceof Error ? error.message : "Unknown error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchVideoTutorials();
  }, [fetchVideoTutorials]);

  return { videoFiles, loading, error, refetch: fetchVideoTutorials };
}

/* =========================
   Snapshot Data Fetcher Hook
   ========================= */
function useSnapshotData() {
  const [snapshotData, setSnapshotData] = React.useState<SnapshotData>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchSnapshotData = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const baseUrl = 'https://vault.qodeinvest.com/reports-snapshot/';
      const data: SnapshotData = {};

      // Get all report names from the reports_available data
      const reportNames = reports_available.flatMap(group =>
        group.report_name.map(report => report.name)
      );

      // Fetch snapshots for each report
      await Promise.allSettled(
        reportNames.map(async (reportName) => {
          try {
            let folderName = reportName;

            // Special case: Handle "Statement of Capital Gain/Loss" -> "Statement of Capital Gain Loss"
            if (reportName === "Statement of Capital Gain/Loss") {
              folderName = "Statement of Capital Gain Loss";
            }

            const folderUrl = `${baseUrl}${encodeURIComponent(folderName)}/`;
            const response = await fetch(folderUrl);

            if (!response.ok) {
              console.warn(`No snapshots found for report: ${reportName}`);
              return;
            }

            const htmlText = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, "text/html");
            const links = doc.querySelectorAll("a[href]");
            const files: SnapshotFile[] = [];

            links.forEach((link) => {
              const href = link.getAttribute("href");
              const text = link.textContent?.trim();

              if (
                href &&
                text &&
                !href.includes("../") &&
                !href.endsWith("/") &&
                text !== ".gitkeep" &&
                text !== "Parent Directory" &&
                (text.toLowerCase().endsWith('.png') ||
                  text.toLowerCase().endsWith('.jpg') ||
                  text.toLowerCase().endsWith('.jpeg') ||
                  text.toLowerCase().endsWith('.gif') ||
                  text.toLowerCase().endsWith('.webp'))
              ) {
                const fileName = decodeURIComponent(text);
                const fileUrl = `${folderUrl}${encodeURIComponent(fileName)}`;
                files.push({ name: fileName, url: fileUrl });
              }
            });

            if (files.length > 0) {
              data[reportName] = files;
            }
          } catch (error) {
            console.warn(`Failed to fetch snapshots for ${reportName}:`, error);
          }
        })
      );

      setSnapshotData(data);
    } catch (error) {
      console.error("Error fetching snapshot data:", error);
      setError(error instanceof Error ? error.message : "Unknown error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchSnapshotData();
  }, [fetchSnapshotData]);

  return { snapshotData, loading, error, refetch: fetchSnapshotData };
}

/* =========================
   UI Primitives
   ========================= */
function ViewLink({
  images,
  title,
  onClick,
  isLoading = false
}: {
  images: SnapshotFile[];
  title: string;
  onClick: (images: SnapshotFile[], title: string) => void;
  isLoading?: boolean;
}) {
  const hasImages = images && images.length > 0;

  if (isLoading) {
    return (
      <button
        type="button"
        className="h-9 rounded-md border border-dashed border-border text-muted-foreground cursor-not-allowed bg-muted px-3 text-sm font-semibold"
        disabled
      >
        Loading...
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`h-9 rounded-md border px-3 text-sm font-semibold transition
        ${hasImages
          ? "border-border bg-primary text-white hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-primary/40"
          : "border-dashed border-border text-muted-foreground cursor-not-allowed bg-muted"
        }`}
      disabled={!hasImages}
      aria-disabled={!hasImages}
      onClick={() => {
        if (hasImages) {
          onClick(images, title);
        }
      }}
    >
      {hasImages ? `View` : "—"}
    </button>
  );
}

function VideoLink({
  href,
  title,
  onClick,
  isLoading = false
}: {
  href?: string;
  title: string;
  onClick: (url: string, title: string) => void;
  isLoading?: boolean;
}) {
  const link = (href ?? "").trim();
  const isLink = link.length > 0;

  if (isLoading) {
    return (
      <button
        type="button"
        className="h-9 rounded-md border border-dashed border-border text-muted-foreground cursor-not-allowed bg-muted px-3 text-sm font-semibold"
        disabled
      >
        Loading...
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`h-9 rounded-md border px-3 text-sm font-semibold transition
        ${isLink
          ? "border-border bg-primary text-white hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-primary/40"
          : "border-dashed border-border text-muted-foreground cursor-not-allowed bg-muted"
        }`}
      disabled={!isLink}
      aria-disabled={!isLink}
      onClick={() => {
        if (isLink) {
          onClick(link, title);
        }
      }}
    >
      {isLink ? "Watch" : "—"}
    </button>
  );
}

/* =========================
   Page (responsive)
   ========================= */
export default function ReportingPortalPage(): JSX.Element {
  const { videoFiles, loading: videoLoading, error: videoError } = useVideoTutorials();
  const { snapshotData, loading: snapshotLoading, error: snapshotError } = useSnapshotData();
  const rows = React.useMemo(() => getFlatRows(reports_available, videoFiles, snapshotData), [videoFiles, snapshotData]);

  // Modal states
  const [videoModalState, setVideoModalState] = React.useState<{
    isOpen: boolean;
    videoUrl: string;
    title: string;
  }>({
    isOpen: false,
    videoUrl: '',
    title: ''
  });

  const [imageModalState, setImageModalState] = React.useState<{
    isOpen: boolean;
    images: SnapshotFile[];
    title: string;
  }>({
    isOpen: false,
    images: [],
    title: ''
  });

  const handleVideoClick = React.useCallback((url: string, title: string) => {
    setVideoModalState({
      isOpen: true,
      videoUrl: url,
      title: `${title} - Tutorial`
    });
  }, []);

  const handleSnapshotClick = React.useCallback((images: SnapshotFile[], title: string) => {
    setImageModalState({
      isOpen: true,
      images,
      title: `${title} - Snapshots`
    });
  }, []);

  const handleCloseVideoModal = React.useCallback(() => {
    setVideoModalState(prev => ({
      ...prev,
      isOpen: false
    }));
  }, []);

  const handleCloseImageModal = React.useCallback(() => {
    setImageModalState(prev => ({
      ...prev,
      isOpen: false
    }));
  }, []);

  return (
    <main className="min-h-[100dvh] w-full text-foreground">
      {/* Video Modal */}
      <VideoModal
        isOpen={videoModalState.isOpen}
        onClose={handleCloseVideoModal}
        videoUrl={videoModalState.videoUrl}
        title={videoModalState.title}
      />

      {/* Image Modal */}
      <ImageModal
        isOpen={imageModalState.isOpen}
        onClose={handleCloseImageModal}
        images={imageModalState.images}
        title={imageModalState.title}
      />

      {/* Banner */}
      <div className="w-full bg-primary py-2 text-center text-sm font-semibold text-white">
        Access all your portfolio details anytime on our secure reporting portal.
      </div>

      <section className="mx-auto w-full py-8 space-y-8">
        {/* Loading/Error Banners */}
        {(videoError || snapshotError) && (
          <div className="mx-auto max-w-4xl rounded-md border border-red-200 bg-red-50 p-3 text-center">
            <p className="text-sm text-red-700">
              {videoError && "Unable to load video tutorials. "}
              {snapshotError && "Unable to load report snapshots. "}
              Some content may not be available.
            </p>
          </div>
        )}

        {/* Intro + Link */}
        <div className="space-y-4 text-center">
          <p className="mx-auto text-base leading-relaxed text-card-foreground">
            At Qode, transparency is central to our philosophy. That's why we provide 24x7 access to your portfolio
            through <span className="mx-1 font-semibold">WealthSpectrum</span>, our secure reporting partner. From
            performance snapshots to tax packs, everything you need is organized in one place.
          </p>

          <div className="flex justify-center">
            <a
              href="https://eclientreporting.nuvamaassetservices.com/wealthspectrum/app/"
              target="_blank"
              rel="noreferrer"
              aria-label="Open WealthSpectrum reporting portal"
              className="inline-flex min-w-48 items-center justify-center rounded-md border border-border bg-primary px-4 py-2 text-lg font-semibold text-white hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              WealthSpectrum Portal
            </a>
          </div>
          <p className="text-md italic">[Your WealthSpectrum login can be either your Account ID or your registered Email ID.]</p>
        </div>

        {/* What You Can Access */}
        <section aria-labelledby="access-title" className="w-full space-y-4">
          <h2
            id="access-title"
            className="rounded-sm bg-primary px-4 py-2 text-center text-sm font-bold tracking-wide text-white"
          >
            What You Can Access
          </h2>

          <div className="overflow-hidden rounded-lg border border-border">
            {/* Desktop header */}
            <div
              className="hidden md:grid md:grid-cols-[200px_1fr] gap-0 bg-card px-3 py-2 text-xs font-semibold text-foreground border-b border-border"
              role="row"
            >
              <div role="columnheader">Feature</div>
              <div role="columnheader">Description</div>
            </div>

            {/* Body rows */}
            <div className="divide-y divide-border">
              <div className="md:grid md:grid-cols-[200px_1fr] items-start gap-0 px-3 py-3 text-sm" role="row">
                <div className="md:hidden space-y-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Feature</span>
                    <span className="font-semibold">Dashboard</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Description</span>
                    <span className="text-card-foreground">Gives you a quick snapshot of your portfolio with total assets, number of strategies, and linked accounts. The asset allocation chart shows how your investments are distributed across equity, fixed income, options, and cash.</span>
                  </div>
                </div>
                <div role="cell" className="hidden md:block font-semibold text-foreground">
                  Dashboard
                </div>
                <div role="cell" className="hidden md:block text-card-foreground">
                  Gives you a quick snapshot of your portfolio with total assets, number of strategies, and linked accounts. The asset allocation chart shows how your investments are distributed across equity, fixed income, options, and cash.
                </div>
              </div>

              <div className="md:grid md:grid-cols-[200px_1fr] items-start gap-0 px-3 py-3 text-sm" role="row">
                <div className="md:hidden space-y-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Feature</span>
                    <span className="font-semibold">Portfolio</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Description</span>
                    <span className="text-card-foreground">Shows detailed information about your holdings, including cost, market value, unrealized gains/losses, and percentage allocation for each security.</span>
                  </div>
                </div>
                <div role="cell" className="hidden md:block font-semibold text-foreground">
                  Portfolio
                </div>
                <div role="cell" className="hidden md:block text-card-foreground">
                  Shows detailed information about your holdings, including cost, market value, unrealized gains/losses, and percentage allocation for each security.
                </div>
              </div>

              <div className="md:grid md:grid-cols-[200px_1fr] items-start gap-0 px-3 py-3 text-sm" role="row">
                <div className="md:hidden space-y-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Feature</span>
                    <span className="font-semibold">Performance</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Description</span>
                    <span className="text-card-foreground">Tracks how your portfolio has performed over time. You can view overall portfolio returns, compare with benchmarks, and check trailing returns for 1M, 3M, and 6M periods.</span>
                  </div>
                </div>
                <div role="cell" className="hidden md:block font-semibold text-foreground">
                  Performance
                </div>
                <div role="cell" className="hidden md:block text-card-foreground">
                  Tracks how your portfolio has performed over time. You can view overall portfolio returns, compare with benchmarks, and check trailing returns for 1M, 3M, and 6M periods.
                </div>
              </div>

              <div className="md:grid md:grid-cols-[200px_1fr] items-start gap-0 px-3 py-3 text-sm" role="row">
                <div className="md:hidden space-y-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Feature</span>
                    <span className="font-semibold">Allocations</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Description</span>
                    <span className="text-card-foreground">Provides a clear breakdown of investments across asset classes and strategies, helping you understand portfolio diversification.</span>
                  </div>
                </div>
                <div role="cell" className="hidden md:block font-semibold text-foreground">
                  Allocations
                </div>
                <div role="cell" className="hidden md:block text-card-foreground">
                  Provides a clear breakdown of investments across asset classes and strategies, helping you understand portfolio diversification.
                </div>
              </div>

              <div className="md:grid md:grid-cols-[200px_1fr] items-start gap-0 px-3 py-3 text-sm" role="row">
                <div className="md:hidden space-y-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Feature</span>
                    <span className="font-semibold">Transactions</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Description</span>
                    <span className="text-card-foreground">Lists all portfolio activities including purchases, sales, and cash movements, along with realized gains and losses.</span>
                  </div>
                </div>
                <div role="cell" className="hidden md:block font-semibold text-foreground">
                  Transactions
                </div>
                <div role="cell" className="hidden md:block text-card-foreground">
                  Lists all portfolio activities including purchases, sales, and cash movements, along with realized gains and losses.
                </div>
              </div>

              <div className="md:grid md:grid-cols-[200px_1fr] items-start gap-0 px-3 py-3 text-sm" role="row">
                <div className="md:hidden space-y-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Feature</span>
                    <span className="font-semibold">Reports</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Description</span>
                    <span className="text-card-foreground">Access a variety of detailed reports that you will require. Below is the detailed breakdown the , snapshot and video tutorials.</span>
                  </div>
                </div>
                <div role="cell" className="hidden md:block font-semibold text-foreground">
                  Reports
                </div>
                <div role="cell" className="hidden md:block text-card-foreground">
                  Access a variety of detailed reports that you will require. Below is the detailed breakdown the , snapshot and video tutorials.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="reports-title" className="space-y-4 p-4">
          <h2
            id="reports-title"
            className="rounded-sm bg-primary px-4 py-2 text-center text-sm font-bold tracking-wide text-white"
          >
            Reports Available
          </h2>

          {/* Responsive Table */}
          <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
            {/* Desktop Header */}
            <div
              className="hidden md:grid md:grid-cols-[40px_250px_2fr_150px_150px] gap-2 bg-card px-3 py-2 text-xs font-semibold text-foreground border-b border-border"
              role="rowgroup"
            >
              <div role="columnheader" className="text-left">Sr. No.</div>
              <div role="columnheader" className="text-left">Type of Report</div>
              <div role="columnheader" className="text-left">Report Name</div>
              <div role="columnheader" className="text-left">Snapshot</div>
              <div role="columnheader" className="text-left">Video Tutorial</div>
            </div>

            {/* Body Rows */}
            <div className="divide-y divide-border" role="rowgroup">
              {rows.map((r) => {
                const snapshots = snapshotData[r.name] || [];

                return (
                  <div
                    key={`${r.sr}-${r.name}`}
                    className="flex flex-col md:grid md:grid-cols-[40px_250px_1fr_150px_150px] gap-2 px-3 py-3 text-sm hover:bg-gray-100 transition-colors"
                    role="row"
                  >
                    {/* Mobile Card Layout */}
                    <div className="md:hidden flex flex-col gap-2 rounded-lg bg-card p-3 border border-border">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Sr. No.</span>
                        <span className="font-medium text-foreground">{r.sr}</span>
                      </div>
                      <div className="flex justify-between items-start">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">Type</span>
                        <span className="text-right text-foreground">{r.type}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">Report Name</span>
                        <span className="font-medium text-foreground">{r.name}</span>
                        {r.used_for && (
                          <span className="text-[11px] text-muted-foreground">
                            Used for: <span className="font-medium">{r.used_for}</span>
                          </span>
                        )}
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Snapshot</span>
                        <ViewLink
                          images={snapshots}
                          title={r.name}
                          onClick={handleSnapshotClick}
                          isLoading={snapshotLoading}
                          className="text-primary hover:underline"
                        />
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Tutorial</span>
                        <VideoLink
                          href={r.tutorial}
                          title={r.name}
                          onClick={handleVideoClick}
                          isLoading={videoLoading}
                          className="text-primary hover:underline"
                        />
                      </div>
                    </div>

                    {/* Desktop Row */}
                    <div role="cell" className="hidden md:flex items-center text-muted-foreground">{r.sr}</div>
                    <div role="cell" className="hidden md:flex items-center text-foreground">{r.type}</div>
                    <div role="cell" className="hidden md:flex flex-col gap-1">
                      <span className="text-foreground font-medium">{r.name}</span>
                      {r.used_for && (
                        <span className="text-[11px] text-muted-foreground">
                          Used for: <span className="font-medium">{r.used_for}</span>
                        </span>
                      )}
                    </div>
                    <div role="cell" className="hidden md:flex items-center">
                      <ViewLink
                        images={snapshots}
                        title={r.name}
                        onClick={handleSnapshotClick}
                        isLoading={snapshotLoading}
                        className="text-primary hover:underline"
                      />
                    </div>
                    <div role="cell" className="hidden md:flex items-center">
                      <VideoLink
                        href={r.tutorial}
                        title={r.name}
                        onClick={handleVideoClick}
                        isLoading={videoLoading}
                        className="text-primary hover:underline"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}