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
  /**
   * The month the document itself states on its cover — NOT the file date.
   * All seven documents currently read August 2026.
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
    asOf: "August 2026",
    downloadName: "Qode Corporate Overview.pdf",
  },
  {
    slug: "qode-all-weather",
    title: "Qode All Weather",
    asOf: "August 2026",
    strategy: "Qode All Weather",
    downloadName: "Qode All Weather.pdf",
  },
  {
    slug: "qode-all-weather-factsheet",
    title: "Qode All Weather Factsheet",
    asOf: "August 2026",
    strategy: "Qode All Weather",
    downloadName: "Qode All Weather Factsheet.pdf",
  },
  {
    slug: "qode-growth-fund",
    title: "Qode Growth Fund",
    asOf: "August 2026",
    strategy: "Qode Growth Fund",
    downloadName: "Qode Growth Fund.pdf",
  },
  {
    slug: "qode-growth-fund-factsheet",
    title: "Qode Growth Fund Factsheet",
    asOf: "August 2026",
    strategy: "Qode Growth Fund",
    downloadName: "Qode Growth Fund Factsheet.pdf",
  },
  {
    slug: "qode-tactical-fund",
    title: "Qode Tactical Fund",
    asOf: "August 2026",
    strategy: "Qode Tactical Fund",
    downloadName: "Qode Tactical Fund.pdf",
  },
  {
    slug: "qode-tactical-fund-factsheet",
    title: "Qode Tactical Fund Factsheet",
    asOf: "August 2026",
    strategy: "Qode Tactical Fund",
    downloadName: "Qode Tactical Fund Factsheet.pdf",
  },
];

/** Looks up a document by slug. Returns null for anything not listed. */
export function documentBySlug(slug: string): DistributorDocument | null {
  return DISTRIBUTOR_DOCUMENTS.find((d) => d.slug === slug) ?? null;
}
