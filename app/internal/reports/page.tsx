import { ReportConsole } from "./_components/console"

export const metadata = {
  title: "Client Reports",
  robots: { index: false, follow: false },
}

export default function ReportsPage() {
  return (
    <main
      id="main-content"
      className="min-h-screen bg-[#efecd3] px-6 py-8 text-[#002017] dark:bg-[#0e1512] dark:text-[#f3f5f4] print:bg-white print:p-0"
    >
      <header className="print:hidden mx-auto mb-6 max-w-[110rem]">
        <p className="mb-2 text-[11px] font-semibold tracking-[0.2em] text-[#37584f]/70 uppercase dark:text-[#c6d0cb]/60">
          Internal · Not for distribution
        </p>
        <h1 className="font-[family-name:var(--font-playfair)] text-3xl text-[#02422b] dark:text-[#8fd3b4]">
          Client Reports
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[#37584f] dark:text-[#c6d0cb]">
          Statements generated from custodian records held in{" "}
          <code className="font-mono text-xs">pms_clients_tracker</code> — 827k transactions across
          514 accounts since 2018. Capital gains are matched FIFO with a 12-month long-term
          threshold.
        </p>
      </header>

      <ReportConsole />
    </main>
  )
}
