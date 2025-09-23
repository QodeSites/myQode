// app/layout.tsx
import type React from "react";
import "@/app/globals.css";
import QodeFooter from "@/components/footer";
import ClientLayout from "@/app/(protected)/client-layout";

// Metadata (optional, for SEO or page configuration)
export const metadata = {
    title: "myQode",
    description: "A Next.js application with authentication",
};

// Server-side RootLayout
export default async function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex flex-col min-h-screen">
            <ClientLayout>{children}</ClientLayout>
            {/* <QodeFooter /> */}
        </div>
    );
}