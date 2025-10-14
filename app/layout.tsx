import type React from "react"
import type { Metadata } from "next"
import { Analytics } from "@vercel/analytics/next"
import "@/app/globals.css"
import { Lato, Playfair_Display } from "next/font/google"
import { Suspense } from "react"
import { ClientProvider } from "@/contexts/ClientContext"

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

const APP_NAME = "Qode Dashboard";
const APP_DEFAULT_TITLE = "Qode Dashboard";
const APP_TITLE_TEMPLATE = "%s - Qode";
const APP_DESCRIPTION = "Client dashboard for Qode";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: APP_TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  generator: "v0.app",
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
  },
  twitter: {
    card: "summary",
    title: {
      default: APP_DEFAULT_TITLE,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
  },
  icons: {
    icon: "/favicon.ico",
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
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${lato.variable} ${playfair.variable} antialiased`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        
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
        <ClientProvider>
          <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
          <Analytics />
        </ClientProvider>
      </body>
    </html>
  )
}