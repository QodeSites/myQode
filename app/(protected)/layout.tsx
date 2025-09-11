// app/layout.tsx
import type React from "react";
import "@/app/globals.css";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import QodeHeader from "@/components/qode-header";
import QodeSidebar from "@/components/qode-sidebar";
import QodeFooter from "@/components/footer";
import ClientLayout from "@/app/(protected)/client-layout";

// Metadata (optional, for SEO or page configuration)
export const metadata = {
    title: "Qode App",
    description: "A Next.js application with authentication",
};

// Server-side RootLayout
export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const cookieStore = await cookies();
    const isAuthed = cookieStore.get("qode-auth")?.value === "1";

    if (!isAuthed) {
        redirect("/login");
    }

    return (
        <div className="flex flex-col min-h-screen">
            <ClientLayout>{children}</ClientLayout>
            <QodeFooter />
        </div>
    );
}