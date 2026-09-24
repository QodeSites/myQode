import { loadCollection } from "@/lib/postmanCollection"
import { Explorer } from "./_components/explorer"

export const metadata = {
  title: "API Demo",
  robots: { index: false, follow: false },
}

export default async function DemoPage() {
  const collection = await loadCollection()

  const healthy = collection.requests.filter(
    (r) => r.responses.length > 0 && r.responses.every((res) => !res.error),
  ).length
  const failing = collection.requests.filter((r) => r.responses.some((res) => res.error)).length

  return (
    <main
      id="main-content"
      className="min-h-screen bg-[#efecd3] px-6 py-8 text-[#002017] dark:bg-[#0e1512] dark:text-[#f3f5f4]"
    >
      <header className="mx-auto mb-8 max-w-7xl">
        <p className="mb-2 text-[11px] font-semibold tracking-[0.2em] text-[#37584f]/70 uppercase dark:text-[#c6d0cb]/60">
          Internal · Not for distribution
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-playfair)] text-3xl text-[#02422b] dark:text-[#8fd3b4]">
              {collection.name}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[#37584f] dark:text-[#c6d0cb]">
              Saved requests and recorded responses from the Nuvama PMS collection. Credentials are
              redacted and investor PII is masked.
            </p>
          </div>

          <dl className="flex gap-5 text-sm">
            {[
              { label: "Endpoints", value: collection.requests.length },
              { label: "OK", value: healthy },
              { label: "Failing", value: failing },
            ].map((s) => (
              <div key={s.label}>
                <dt className="text-[10px] font-semibold tracking-wider text-[#37584f]/70 uppercase dark:text-[#c6d0cb]/60">
                  {s.label}
                </dt>
                <dd className="font-[family-name:var(--font-playfair)] text-xl text-[#02422b] dark:text-[#8fd3b4]">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {collection.notices.length > 0 && (
          <ul className="mt-5 space-y-1.5">
            {collection.notices.map((n) => (
              <li
                key={n}
                className="rounded-lg border-l-2 border-[#dabd38] bg-[#dabd38]/12 px-3 py-2 text-xs text-[#8a5a00] dark:text-[#dabd38]"
              >
                {n}
              </li>
            ))}
          </ul>
        )}
      </header>

      <Explorer collection={collection} />
    </main>
  )
}
