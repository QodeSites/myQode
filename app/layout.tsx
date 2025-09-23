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
  display: "swap",
})

export const metadata: Metadata = {
  title: "Qode Dashboard",
  description: "Client dashboard for Qode",
  generator: "v0.app",
  icons: {
    icon: "/favicon.ico",
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${lato.variable} ${playfair.variable} antialiased`}>
      <body className="font-sans bg-background text-foreground">
        <ClientProvider>
          <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
          <Analytics />
        </ClientProvider>

      </body>
    </html>
  )
}
