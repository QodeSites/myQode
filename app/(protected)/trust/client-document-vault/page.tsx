"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useClient } from "@/contexts/ClientContext";
import { ChevronDown, ChevronRight, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DocFile {
  name: string;
  url: string;
  size?: string | number;
  lastModified?: string;
  section: string;
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
  hasError?: boolean;
}

// Static template for section mapping, but we only use this once for rendering UI structure:
const DOC_TEMPLATES = [
  {
    id: "pms-agreement",
    title: "PMS Agreement",
    folderName: "PMS Agreement",
    description: "Your official agreement with Qode, executed at onboarding.",
    expanded: true,
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

// Map folderName to section id
const FOLDER_TO_ID: Record<string, string> = {
  "PMS Agreement": "pms-agreement",
  "Account Opening Documents": "account-opening-docs",
  "CML": "cml",
};

export default function AccountDocumentsPage() {
  const { selectedClientId, clientLoading, clients } = useClient();

  const [docSections, setDocSections] = useState<DocSection[]>(
    DOC_TEMPLATES.map((template) => ({
      ...template,
      files: [],
      loading: false,
      disabled: true,
      hasError: false,
    }))
  );

  const [hadFetchError, setHadFetchError] = useState<boolean>(false);

  // Update sections' disabled state on loading/client change
  useEffect(() => {
    setDocSections((prev) =>
      prev.map((section) => ({
        ...section,
        disabled: clientLoading || !selectedClientId,
      }))
    );
  }, [clientLoading, selectedClientId]);

  // Fetch and organize all files for the client
  const fetchAndDistributeFiles = useCallback(
    async (clientId: string) => {
      // Set all loading true, clear hasError
      setDocSections((prev) =>
        prev.map((section) => ({ ...section, loading: true, hasError: false }))
      );
      setHadFetchError(false);

      try {
        const apiUrl = `/api/list-folder?path=docs/client-documents/${clientId}/`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const responseData = await response.json();

        // Defensive: response.data?.data (response.data.data)
        const files: DocFile[] =
          responseData?.data?.map((item: any) => ({
            name: item.filename,
            url: item.url,
            size: item.size,
            lastModified: item.lastModified,
            section: item.section,
          })) || [];

        // Group files by folder name/section
        const grouped: Record<string, DocFile[]> = {};
        for (const file of files) {
          if (!grouped[file.section]) grouped[file.section] = [];
          grouped[file.section].push(file);
        }

        setDocSections((prev) =>
          prev.map((section) => ({
            ...section,
            loading: false,
            hasError: false,
            // Only use files for this section.folderName/section
            files: grouped[section.folderName] ? grouped[section.folderName] : [],
          }))
        );
      } catch (error) {
        setHadFetchError(true);
        setDocSections((prev) =>
          prev.map((section) => ({
            ...section,
            loading: false,
            hasError: true,
            // Don't clear files
          }))
        );
      }
    },
    []
  );

  // Re-fetch whenever client changes
  useEffect(() => {
    if (selectedClientId && !clientLoading) {
      fetchAndDistributeFiles(selectedClientId);
    }
  }, [selectedClientId, clientLoading, fetchAndDistributeFiles]);

  // Retry handler for a single section (force full fetch for simplicity)
  const retryFetch = () => {
    if (selectedClientId) {
      fetchAndDistributeFiles(selectedClientId);
    }
  };

  const toggleSection = (sectionId: string) => {
    setDocSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, expanded: !s.expanded } : s
      )
    );
  };

  return (
    <main className="space-y-10">
      <header className="mb-6">
        <h1 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">
          Account Documents
        </h1>
        <p className="text-sm text-muted-foreground">
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
                          <h3 className="text-pretty text-xl font-bold text-foreground flex items-center gap-2">{section.title}</h3>
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
                        {section.hasError && (
                          <span className="text-destructive ml-2">
                            (Failed to load documents)
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-sm font-medium">
                      {section.disabled ? (
                        <span className="text-muted-foreground">
                          Not available
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          {section.hasError && (
                            <Button
                              onClick={() => retryFetch()}
                              variant="outline"
                              size="sm"
                              disabled={section.loading}
                            >
                              Retry
                            </Button>
                          )}
                          <Button
                            onClick={() => toggleSection(section.id)}
                            className="bg-primary"
                          >
                            {section.expanded ? "Collapse" : "View Files"}
                          </Button>
                        </div>
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
                        {section.hasError
                          ? "Failed to load files. Please try again."
                          : "No files found in this section."
                        }
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
                                  {/* {file.size && (
                                    <p className="text-xs text-muted-foreground">
                                      {typeof file.size === "number"
                                        ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                                        : file.size}
                                    </p>
                                  )} */}
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