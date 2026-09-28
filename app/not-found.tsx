import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
}

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "#EFECD3", color: "#002017" }}>
      <div className="max-w-md w-full">
        <p className="text-xs font-bold tracking-[0.14em]" style={{ color: "#37584F" }}>ERROR 404</p>
        <h1 className="font-serif text-4xl mt-3">We couldn’t find that page</h1>
        <div className="h-0.5 w-10 mt-4" style={{ background: "#DABD38" }} />
        <p className="mt-5 text-[15px] leading-relaxed" style={{ color: "#37584F" }}>
          The link may be old or mistyped. Your portfolio is still where you left it.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/app" className="rounded-md px-5 py-3 text-sm font-bold" style={{ background: "#02422B", color: "#DABD38" }}>
            Go to myQode
          </Link>
          <Link href="/contactus" className="rounded-md px-5 py-3 text-sm font-bold border" style={{ borderColor: "rgba(55,88,79,0.35)", color: "#02422B" }}>
            Contact Investor Relations
          </Link>
        </div>
      </div>
    </main>
  )
}
