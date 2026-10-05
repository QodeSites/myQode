import type React from "react"
import type { Metadata } from "next"
import { Analytics } from "@vercel/analytics/next"
import "@/app/globals.css"
import { Lato, Playfair_Display } from "next/font/google"
import { Suspense } from "react"
import { ClientProvider } from "@/contexts/ClientContext"
import { FirebaseAnalyticsProvider } from "@/components/firebase-analytics-provider"
import { AnalyticsProvider } from "@/components/analytics-provider"

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-lato",
  display: "swap",
})

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  weight: ["400", "700", "900"],
  display: "swap",
})

const APP_NAME = "myQode";
const APP_DEFAULT_TITLE = "myQode by Qode Advisors";
const APP_TITLE_TEMPLATE = "%s | myQode";
const APP_DESCRIPTION = "Sign in to see your Qode PMS accounts: portfolio value, returns against the benchmark, holdings, statements and service requests.";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://myqode.qodeinvest.com";

// Organisation details for search engines (schema.org). Same contact details the app shows.
const ORG_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FinancialService",
  name: "Qode Advisors LLP",
  description: "SEBI registered portfolio manager.",
  url: SITE_URL,
  logo: `${SITE_URL}/icons/512.png`,
  email: "investor.relations@qodeinvest.com",
  telephone: "+91 98203 00028",
  address: {
    "@type": "PostalAddress",
    streetAddress: "2nd Floor, Tree Building, Raghuvanshi Mills Compound, Gandhi Nagar, Upper Worli, Lower Parel",
    addressLocality: "Mumbai",
    addressRegion: "Maharashtra",
    postalCode: "400013",
    addressCountry: "IN",
  },
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: APP_TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_DEFAULT_TITLE,
    startupImage: [
      {
        url: "/icons/512.png",
        media: "(device-width: 768px) and (device-height: 1024px)",
      },
    ],
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
    images: [{ url: "/icons/512.png", width: 512, height: 512, alt: "Qode" }],
  },
  twitter: {
    card: "summary",
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
    images: ["/icons/512.png"],
  },
  icons: {
    icon: "/favicon.ico?v=2",
    apple: [
      { url: "/icons/120.png", sizes: "120x120", type: "image/png" },
      { url: "/icons/152.png", sizes: "152x152", type: "image/png" },
      { url: "/icons/167.png", sizes: "167x167", type: "image/png" },
      { url: "/icons/180.png", sizes: "180x180", type: "image/png" },
    ],
  },
}

export const viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${lato.variable} ${playfair.variable} antialiased`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_SCHEMA) }} />
        
        {/* iOS-specific meta tags */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Qode" />
        
        {/* Additional Apple Touch Icons */}
        <link rel="apple-touch-icon" href="/icons/180.png" />
        <link rel="apple-touch-icon" sizes="120x120" href="/icons/120.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/152.png" />
        <link rel="apple-touch-icon" sizes="167x167" href="/icons/167.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/180.png" />
        
        {/* iOS Splash Screens - Optional but recommended */}
        <link rel="apple-touch-startup-image" href="/icons/512.png" />
      </head>
      <body className="font-sans bg-background text-foreground">
        <AnalyticsProvider />
        {/* WCAG 2.4.1 Bypass Blocks — skip link as first focusable element */}
        <a href="#main-content" className="skip-to-content">
          Skip to main content
        </a>
        <ClientProvider>
          <Suspense fallback={<div role="status" aria-live="polite">Loading…</div>}>
            <FirebaseAnalyticsProvider>{children}</FirebaseAnalyticsProvider>
          </Suspense>
          <Analytics />
        </ClientProvider>
      </body>
    </html>
  )
}