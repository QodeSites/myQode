import type { MetadataRoute } from "next"

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://myqode.qodeinvest.com"

// Only the sign-in and policy pages are public. Everything else is a client's private data.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/login", "/privacypolicy", "/termsandcondition", "/cancellation", "/contactus", "/llms.txt"],
        disallow: ["/api/", "/app/", "/portfolio/", "/admin/", "/distributor/", "/auth/", "/demo/", "/reset-password"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
