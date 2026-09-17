import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * Proxy for the qode360 valuation indicator endpoints.
 *
 * The Valuation Spread Indicator on /distributors/indicators reads the same
 * precomputed tables qode360's research dashboard reads. This site holds none
 * of that data, so every request is forwarded to the qode360 FastAPI backend:
 *
 *   /api/distributor/indicators/indicator/get_ratio_df?factor_col=p%2Fb
 *     -> ${QODE360_API_URL}/indicator/get_ratio_df/?factor_col=p%2Fb
 *
 * AUTHORIZATION IS ENFORCED HERE. The backend endpoints are public, but this
 * page is for signed-in distribution partners, so the portal session is
 * checked before anything is forwarded: the `qode-auth` and
 * `qode-user-context` cookies must be present and the email must resolve to
 * a row in pms_clients_master — the same check /api/distributor/clients makes
 * before returning a partner's data. An anonymous visitor cannot use this
 * site as a relay to the backend.
 *
 * QODE360_API_URL is a server-only env var (no NEXT_PUBLIC_ prefix) with the
 * production backend as the fallback, so a missing setting degrades to the
 * right place rather than to nothing.
 */

const DEFAULT_QODE360_API_URL = "https://qode360-backend.qodeinvest.com/api/v1";

function upstreamBase(): string {
  return (process.env.QODE360_API_URL || DEFAULT_QODE360_API_URL).replace(/\/+$/, "");
}

/** True when the request carries a portal session for a known partner. */
async function isPortalPartner(request: NextRequest): Promise<boolean> {
  if (request.cookies.get("qode-auth")?.value !== "1") return false;
  const raw = request.cookies.get("qode-user-context")?.value;
  if (!raw) return false;

  let email: string | undefined;
  try {
    email = JSON.parse(raw)?.email;
  } catch {
    return false;
  }
  if (!email) return false;

  try {
    const result = await query(
      `SELECT 1 FROM pms_clients_master WHERE email = $1 LIMIT 1`,
      [email],
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error("[indicators proxy] partner lookup failed", err);
    return false;
  }
}

async function forward(
  request: NextRequest,
  segments: string[],
): Promise<NextResponse> {
  if (!(await isPortalPartner(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only the indicator namespace is reachable through this proxy. Anything
  // else on the backend is not this page's business.
  if (segments[0] !== "indicator") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Every FastAPI indicator route is declared with a trailing slash. Next
  // strips it from the incoming path, and without it the backend answers
  // with a 307 to an http:// URL — so always add it back here.
  const path = segments.map(encodeURIComponent).join("/");
  const url = `${upstreamBase()}/${path}/${request.nextUrl.search}`;

  const init: RequestInit = {
    method: request.method,
    headers: { accept: "application/json" },
    cache: "no-store",
  };
  if (request.method === "POST") {
    const body = await request.text();
    if (body) {
      init.body = body;
      init.headers = {
        ...init.headers,
        "content-type": request.headers.get("content-type") || "application/json",
      };
    }
  }

  try {
    const upstream = await fetch(url, init);
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[indicators proxy] upstream fetch failed", { url, err });
    return NextResponse.json(
      { error: "Indicator service unavailable" },
      { status: 502 },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(request, path);
}
