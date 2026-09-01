// The documents a distribution partner can download and share.
//
// Filenames on disk are slugs, not the names partners see. The originals
// carried version numbers and month suffixes ("Qode Growth Fund 3.pdf",
// "Qode_Corporate_Overview_Aug.pdf") which would leak into the download and
// mean nothing to a client on the other end. Replacing a document means
// overwriting the file at the same slug — no page or link needs editing.

export type DistributorDocument = {
  /** URL-safe id, and the filename stem on disk. */
  slug: string;
  /** What a partner sees. */
  title: string;
  /** One line describing what it is for. */
  description: string;
  /**
   * The month the document itself states on its cover — NOT the file date.
   * The corporate overview reads August 2026; all three factsheets read July
   * 2026. Showing one date for all four would misdate three of them.
   */
  asOf: string;
  /** Strategy documents carry their strategy name, for colour and grouping. */
  strategy?: string;
  /** What the browser saves it as. */
  downloadName: string;
};

export const DISTRIBUTOR_DOCUMENTS: readonly DistributorDocument[] = [
  {
    slug: "corporate-overview",
    title: "Corporate overview",
    description:
      "Who Qode is, the investment philosophy, fee and custodian structure.",
    asOf: "August 2026",
    downloadName: "Qode Corporate Overview.pdf",
  },
  {
    slug: "qode-all-weather",
    title: "Qode All Weather",
    description: "Strategy factsheet — framework, performance and risk metrics.",
    asOf: "July 2026",
    strategy: "Qode All Weather",
    downloadName: "Qode All Weather.pdf",
  },
  {
    slug: "qode-growth-fund",
    title: "Qode Growth Fund",
    description: "Strategy factsheet — framework, performance and risk metrics.",
    asOf: "July 2026",
    strategy: "Qode Growth Fund",
    downloadName: "Qode Growth Fund.pdf",
  },
  {
    slug: "qode-tactical-fund",
    title: "Qode Tactical Fund",
    description: "Strategy factsheet — framework, performance and risk metrics.",
    asOf: "July 2026",
    strategy: "Qode Tactical Fund",
    downloadName: "Qode Tactical Fund.pdf",
  },
];

/** Looks up a document by slug. Returns null for anything not listed. */
export function documentBySlug(slug: string): DistributorDocument | null {
  return DISTRIBUTOR_DOCUMENTS.find((d) => d.slug === slug) ?? null;
}
