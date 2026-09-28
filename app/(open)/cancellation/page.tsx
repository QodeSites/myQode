import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cancellation and refund policy",
  description: "How cancellations and refunds work for payments made through myQode.",
  alternates: { canonical: "/cancellation" },
};



export default async function Page() {

  return (
    <main className="space-y-auto">
        <h1 className="text-pretty text-lg font-bold text-foreground flex items-center gap-2">Refund and Cancellation</h1>
        <span className="text-md">
          As a portfolio management service, Qode does not offer refunds or cancellations. All investments are actively managed on your behalf and are subject to market risks; once investment decisions are executed, they cannot be undone. Please review your investment commitments carefully before proceeding.
        </span>
    </main>
  )
}