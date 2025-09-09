"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useClient } from "@/contexts/ClientContext";
import { ChevronDown, ChevronRight, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DocFile {
  name: string;
  url: string;
  size?: string;
  lastModified?: string;
}

interface DocSection {
  id: string;
  title: string;
  description: string;
  folderName: string;
  files: DocFile[];
  loading: boolean;
  expanded: boolean;
  disabled: boolean;
}

const DOC_TEMPLATES = [
  {
    id: "pms-agreement",
    title: "PMS Agreement",
    folderName: "PMS Agreement",
    description: "Your official agreement with Qode, executed at onboarding.",
    expanded: true, // Only this section is open initially
  },
  {
    id: "account-opening-docs",
    title: "Account Opening Documents",
    folderName: "Account Opening Documents",
    description: "Verification of linked bank and demat accounts.",
    expanded: false,
  },
  {
    id: "cml",
    title: "CML",
    folderName: "CML",
    description: "Capital Market License and regulatory documents.",
    expanded: false,
  },
];

export default function AccountDocumentsPage() {
  const { selectedClientId, clientLoading } = useClient();
  const [docSections, setDocSections] = useState<DocSection[]>([]);

  // Initialize doc sections and fetch files
  useEffect(() => {
    const initialSections = DOC_TEMPLATES.map((template) => ({
      ...template,
      files: [],
      loading: false,
      disabled: clientLoading || !selectedClientId,
    }));
    setDocSections(initialSections);

    // Fetch files for all sections if selectedClientId is available
    if (selectedClientId && !clientLoading) {
      initialSections.forEach((section) => {
        if (!section.disabled) {
          fetchFolderFiles(section.id, section.folderName);
        }
      });
    }
  }, [selectedClientId, clientLoading]);

  // Function to fetch files for a specific folder
  const fetchFolderFiles = async (sectionId: string, folderName: string) => {
    if (!selectedClientId) return;

    // Set loading state
    setDocSections((prev) =>
      prev.map((section) =>
        section.id === sectionId ? { ...section, loading: true } : section
      )
    );

    try {
      const folderUrl = `https://vault.qodeinvest.com/client-documents/ClientList/${selectedClientId}/${encodeURIComponent(
        folderName
      )}`;

      const response = await fetch(folderUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch folder contents");
      }

      const htmlText = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, "text/html");
      const links = doc.querySelectorAll("a[href]");
      const files: DocFile[] = [];

      links.forEach((link) => {
        const href = link.getAttribute("href");
        const text = link.textContent?.trim();

        if (
          href &&
          text &&
          !href.includes("../") &&
          !href.endsWith("/") &&
          text.includes(".")
        ) {
          const fileName = decodeURIComponent(text);
          const fileUrl = `${folderUrl}/${encodeURIComponent(fileName)}`;
          files.push({ name: fileName, url: fileUrl });
        }
      });

      setDocSections((prev) =>
        prev.map((section) =>
          section.id === sectionId
            ? { ...section, files, loading: false }
            : section
        )
      );
    } catch (error) {
      console.error("Error fetching folder files:", error);
      setDocSections((prev) =>
        prev.map((section) =>
          section.id === sectionId
            ? { ...section, files: [], loading: false }
            : section
        )
      );
    }
  };

  const toggleSection = (sectionId: string) => {
    const section = docSections.find((s) => s.id === sectionId);
    if (!section || section.disabled) return;

    // Toggle expanded state
    setDocSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, expanded: !s.expanded } : s
      )
    );
  };

  return (
    <main className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-balance">
          Account Documents
        </h1>
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
        ) : docSections.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No documents found for this client.
          </div>
        ) : (
          <ul className="divide-y">
            {docSections.map((section) => (
              <li key={section.id} className="border-b last:border-b-0">
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 max-w-3xl">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleSection(section.id)}
                          disabled={section.disabled}
                          className={`flex items-center gap-2 text-left ${
                            section.disabled
                              ? "cursor-not-allowed text-muted-foreground"
                              : "cursor-pointer hover:text-primary"
                          }`}
                          aria-expanded={section.expanded}
                          aria-controls={`section-${section.id}-files`}
                        >
                          {section.loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : section.expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <h3 className="font-semibold">{section.title}</h3>
                          {section.files.length > 0 && (
                            <span className="text-xs bg-muted px-2 py-1 rounded-full">
                              {section.files.length}{" "}
                              file{section.files.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </button>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground ml-6">
                        {section.description}
                      </p>
                    </div>
                    <div className="text-sm font-medium">
                      {section.disabled ? (
                        <span className="text-muted-foreground">
                          Not available
                        </span>
                      ) : (
                        <Button
                          onClick={() => toggleSection(section.id)}
                          className="bg-primary"
                        >
                          {section.expanded ? "Collapse" : "View Files"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {section.expanded && (
                  <div
                    id={`section-${section.id}-files`}
                    className="bg-muted/20 border-t"
                  >
                    {section.loading ? (
                      <div className="p-4 flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">
                          Loading files...
                        </span>
                      </div>
                    ) : section.files.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        No files found in this section.
                      </div>
                    ) : (
                      <ul className="divide-y divide-border/50">
                        {section.files.map((file, index) => (
                          <li
                            key={`${section.id}-${index}`}
                            className="p-4 pl-12"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">
                                    {file.name}
                                  </p>
                                  {file.size && (
                                    <p className="text-xs text-muted-foreground">
                                      {file.size}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <Link
                                href={file.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-primary underline underline-offset-4 hover:no-underline flex-shrink-0"
                                aria-label={`Open ${file.name}`}
                              >
                                Open
                              </Link>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}