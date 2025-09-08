"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useClient } from "@/contexts/ClientContext";
import { Button } from "@/components/ui/button";

interface Doc {
  title: string;
  description: string;
  href: string;
  disabled?: boolean;
}

const DOC_TEMPLATES = [
  {
    id: "pms-agreement",
    title: "PMS Agreement",
    folderName: "PMS Agreement",
    description: "Your official agreement with Qode, executed at onboarding.",
    placeholderFile: "PMS_Agreement.pdf",
  },
  {
    id: "account-opening-docs",
    title: "Account Opening Documents",
    folderName: "Account Opening Documents",
    description: "Verification of linked bank and demat accounts.",
    placeholderFile: "Account_Opening.pdf",
  },
  {
    id: "cml",
    title: "CML",
    folderName: "CML",
    description: "Capital Market License and regulatory documents.",
    placeholderFile: "CML_Document.pdf",
  },
];

export default function AccountDocumentsPage() {
  const { selectedClientCode, clientLoading } = useClient();
  const [docs, setDocs] = useState<Doc[]>([]);

  useEffect(() => {
    if (clientLoading || !selectedClientCode) {
      setDocs(
        DOC_TEMPLATES.map((template) => ({
          title: template.title,
          description: template.description,
          href: "#",
          disabled: true,
        }))
      );
      return;
    }

    const newDocs = DOC_TEMPLATES.map((template) => ({
      title: template.title,
      description: template.description,
      href: `http://139.5.189.227:8888/client-documents/ClientList/${selectedClientCode}/${encodeURIComponent(
        template.folderName
      )}`,
      disabled: false,
    }));
    console.log("Generated docs:", newDocs);
    setDocs(newDocs);
  }, [selectedClientCode, clientLoading]);

  return (
    <main className="p-4 md:p-6 bg-card">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-balance">Account Documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Access important documents related to your Qode PMS account.
        </p>
      </header>

      <section aria-labelledby="docs-list" className="rounded-md border bg-card">
        <h2 id="docs-list" className="sr-only">
          Document list
        </h2>

        {clientLoading ? (
          <ul className="divide-y">
            {[...Array(3)].map((_, index) => (
              <li key={index} className="p-4">
                <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
                  <div className="max-w-3xl animate-pulse">
                    <div className="h-6 w-48 bg-gray-200 rounded mb-2"></div>
                    <div className="h-4 w-96 bg-gray-200 rounded"></div>
                  </div>
                  <div className="h-4 w-24 bg-gray-200 rounded"></div>
                </div>
              </li>
            ))}
          </ul>
        ) : docs.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No documents found for this client.
          </div>
        ) : (
          <ul className="divide-y">
            {docs.map((d) => (
              <li key={d.title} className="p-4">
                <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
                  <div className="max-w-3xl">
                    <h3 className="font-semibold">{d.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{d.description}</p>
                  </div>
                  <Link
                    href={d.href}
                    target={d.disabled ? undefined : "_blank"}
                    rel={d.disabled ? undefined : "noopener noreferrer"}
                    className={`text-sm font-medium underline underline-offset-4 ${
                      d.disabled ? "text-muted-foreground cursor-not-allowed" : "text-primary"
                    }`}
                    aria-label={`${d.title} - ${d.disabled ? "not available" : "click to view"}`}
                  >
                    <Button>Click Here</Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}