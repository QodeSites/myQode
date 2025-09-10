"use client";

import Link from "next/link";

export default function QodeFooter() {
  return (
    <footer className="fixed bottom-0 left-0 w-full flex flex-row px-20 py-4 border-t-2 z-10 bg-background">
      <div>
        <span>© 2025 Qode. All rights reserved.</span>
      </div>
      <div className="ml-auto flex gap-4">
        <Link href="/privacypolicy">Privacy Policy</Link>
        <Link href="/termsandcondition">Terms and Conditions</Link>
        <Link href="/cancellation">Returns and Cancellation</Link>
        <Link href="/contactus">Contact Us</Link>
      </div>
    </footer>
  );
}