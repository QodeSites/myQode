import type React from "react";

/**
 * Internal distributor overview — deliberately OUTSIDE app/(protected).
 *
 * That route group's layout requires a `qode-auth` investor session and
 * redirects to /login without one. Internal staff authenticate with the
 * `admin-session` cookie instead, so a page placed inside (protected) bounced
 * them to the investor login even with a valid admin session.
 *
 * Access is enforced in two places, neither of them here:
 *   1. middleware.ts redirects to /admin/login when the admin-session cookie
 *      is absent — UX only, since it does not validate the cookie.
 *   2. /api/distributor/internal-overview validates the session against Redis
 *      before returning any data. That is the real security boundary.
 */
export const metadata = {
  title: "Distributor Overview — Internal",
  robots: { index: false, follow: false },
};

export default function InternalDistributorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main id="main-content" className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6">
      {children}
    </main>
  );
}
