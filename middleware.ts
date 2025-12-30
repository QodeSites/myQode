import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth/jwt";

// Admin middleware: session cookie-based
export async function middleware(request: NextRequest) {
  // ----- ADMIN MIDDLEWARE -----
  if (request.nextUrl.pathname.startsWith("/admin")) {
    // Allow login and API auth routes to pass through
    if (
      request.nextUrl.pathname === "/admin/login" ||
      request.nextUrl.pathname.startsWith("/api/auth/")
    ) {
      return NextResponse.next();
    }

    // Restrict other /admin routes to session-authenticated users only
    const sessionId = request.cookies.get("admin-session")?.value;
    if (!sessionId) {
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Session exists, proceed (actual validation can occur on the page/api itself)
    return NextResponse.next();
  }

  // ----- API JWT AUTH MIDDLEWARE -----
  if (request.nextUrl.pathname.startsWith("/api/")) {

    if (
      request.nextUrl.pathname === "/api/auth/login" ||
      request.nextUrl.pathname === "/api/auth/refresh" ||
      request.nextUrl.pathname === "/api/auth/logout"
    ) {
      return NextResponse.next();
    }
    // As per new requirement, Authorization comes from backend now (always check header).
    const authHeader = request.headers.get("authorization");
    console.log('authHeader',authHeader,request.headers.get("x-client-type"))
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.replace("Bearer ", "").trim();

    try {
      const payload = await verifyToken(token);
      // continue request
    } catch (err: any) {
      if (err.code === "JWT_EXPIRED") {
        return NextResponse.json({ error: "Token expired" }, { status: 401 });
      }
    
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/portfolio-details/:path*",
    "/api/auth/client-data/:path*",
  ],
};