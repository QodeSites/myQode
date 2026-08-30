import type React from "react";

/**
 * Layout for the admin sign-in pages.
 *
 * These sit in a route group so they do NOT inherit app/admin/layout.tsx.
 * That shell renders the rail, the nav and the signed-in user footer — all of
 * which are wrong here: the whole point of this page is that nobody is signed
 * in yet, so it was showing "Signed in / Loading…" and a Sign out button to a
 * signed-out visitor.
 *
 * The route group changes no URLs: these are still /admin/login and
 * /admin/auth-complete.
 */
export const metadata = {
  title: "Sign in — myQode Back Office",
  robots: { index: false, follow: false },
};

export default function AdminAuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main
      id="main-content"
      className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10"
    >
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
