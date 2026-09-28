import type { MetadataRoute } from "next"

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://myqode.qodeinvest.com"

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { path: "/login", priority: 1 },
    { path: "/contactus", priority: 0.6 },
    { path: "/privacypolicy", priority: 0.3 },
    { path: "/termsandcondition", priority: 0.3 },
    { path: "/cancellation", priority: 0.3 },
  ].map(({ path, priority }) => ({ url: `${SITE_URL}${path}`, changeFrequency: "monthly", priority }))
}
