"use client";

import Link from "next/link";

export default function QodeFooter() {
  return (
    <footer className="block md:fixed bottom-0 left-0 w-full border-t-2 z-10 bg-background px-4 sm:px-6 md:px-8 py-4">
      <div className="flex flex-col sm:flex-row items-center sm:items-center justify-between gap-3 sm:gap-0">
        {/* Left text */}
        <span className="text-sm md:text-md text-center sm:text-left">
          © 2025 Qode. All rights reserved.
        </span>

        {/* Links */}
        <div className="flex flex-col sm:flex-row gap-2 md:gap-4 text-center sm:text-right">
          <Link href="/privacypolicy" className="text-sm md:text-md">
            Privacy Policy
          </Link>
          <Link href="/termsandcondition" className="text-sm md:text-md">
            Terms and Conditions
          </Link>
          <Link href="/cancellation" className="text-sm md:text-md">
            Returns and Cancellation
          </Link>
          <Link href="/contactus" className="text-sm md:text-md">
            Contact Us
          </Link>
        </div>
      </div>
    </footer>
  );
}
