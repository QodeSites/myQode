import { PdfDialog } from "@/components/pdf-dialog";
import Link from "next/link"

const dialogByTitle: Record<string, { title: string; pdfSrc?: string; imageSrc?: string }> = {
  "Hedging Policy": {
    title: "Qode Hedging Policy",
    pdfSrc: "/policies/hedging-policy.pdf",
    // imageSrc: "/docs/hedging-policy.png",
  },
  "Liquidity Rules": {
    title: "Liquidity Rules",
    pdfSrc: "/policies/liquidity-rules.pdf",
    // imageSrc: "/liquidity-rules-policy-preview.png",
  },
  "Rebalance Policy": {
    title: "Rebalance Policy",
    pdfSrc: "/policies/rebalance-policy.pdf",
    // imageSrc: "/rebalance-policy-preview.png",
  },
  "Concentration Limits": {
    title: "Concentration Limits",
    pdfSrc: "/policies/concentration-limits.pdf",
    // imageSrc: "/concentration-limits-policy-preview.png",
  },
}

type Policy = { title: string; description: string; href: string }

const policies: Policy[] = [
  {
    title: "Hedging Policy",
    description:
      "We use derivatives prudently to manage downside risk, not for speculation. Protective put options & hedges are employed where appropriate to safeguard portfolios against significant market declines.",
    href: "#",
  },
  {
    title: "Liquidity Rules",
    description: "We follow a defined liquidity policy to ensure capital is available for hedging and client needs.",
    href: "#",
  },
  {
    title: "Rebalance Policy",
    description: "All portfolios are rebalanced monthly, realigning holdings to strategy weights to control drift.",
    href: "#",
  },
  {
    title: "Concentration Limits",
    description: "We impose no sector caps; portfolios are built bottom‑up, with structural gold allocations.",
    href: "#",
  },
]

export default function PoliciesPage() {
  return (
    <main className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-balance">Policies</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Key operating policies that guide portfolio construction and risk management.
        </p>
      </header>

      <section aria-labelledby="policies-list" className="rounded-md border bg-card">
        <h2 id="policies-list" className="sr-only">
          Policies list
        </h2>

        <ul className="divide-y">
          {policies.map((p) => {
            const dlg = dialogByTitle[p.title]
            return (
              <li key={p.title} className="p-4">
                <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
                  <div className="max-w-3xl">
                    <h3 className="font-semibold">{p.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                  </div>

                  {dlg ? (
                    <PdfDialog
                      title={dlg.title}
                      pdfSrc={dlg.pdfSrc}
                      // imageSrc={dlg.imageSrc}
                      trigger={
                        <button
                          type="button"
                          className="text-sm font-medium text-primary underline underline-offset-4"
                          aria-label={`Open ${p.title}`}
                        >
                          [click here]
                        </button>
                      }
                    />
                  ) : (
                    <Link
                      href={p.href}
                      className="text-sm font-medium text-primary underline underline-offset-4"
                      aria-label={`${p.title} policy link`}
                    >
                      [click here]
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}
