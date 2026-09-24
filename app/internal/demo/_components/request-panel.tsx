import type { DemoRequest } from "@/lib/postmanCollectionShared"

export function MethodTag({ method }: { method: string }) {
  return (
    <span className="rounded bg-[#02422b] px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide text-[#dabd38]">
      {method}
    </span>
  )
}

export function RequestPanel({ request }: { request: DemoRequest }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#37584f]/20 bg-[#f7f5e9] dark:border-[#c6d0cb]/15 dark:bg-[#1a201d]">
      <header className="border-b border-[#37584f]/15 px-4 py-3 dark:border-[#c6d0cb]/10">
        <h2 className="font-[family-name:var(--font-playfair)] text-base text-[#02422b] dark:text-[#8fd3b4]">
          Request
        </h2>
      </header>

      <div className="space-y-5 p-4">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-[#37584f]/70 uppercase dark:text-[#c6d0cb]/60">
            Endpoint
          </p>
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#02422b]/4 px-3 py-2 dark:bg-black/25">
            <MethodTag method={request.method} />
            <code className="font-mono text-xs break-all text-[#37584f] dark:text-[#c6d0cb]">
              <span className="opacity-60">{request.host}</span>
              <span className="font-semibold text-[#02422b] dark:text-[#8fd3b4]">
                {request.pathname}
              </span>
            </code>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-[#37584f]/70 uppercase dark:text-[#c6d0cb]/60">
            Headers
          </p>
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 font-mono text-xs">
            {request.headers.map((h, i) => (
              <div key={`${h.key}-${i}`} className="contents">
                <dt className="font-semibold text-[#02422b] dark:text-[#8fd3b4]">{h.key}</dt>
                <dd className="break-all text-[#37584f] dark:text-[#c6d0cb]">
                  {h.value}
                  {h.secret && (
                    <span className="ml-2 rounded bg-[#dabd38]/25 px-1.5 py-0.5 font-sans text-[10px] font-medium text-[#8a5a00] dark:text-[#dabd38]">
                      redacted
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {request.body && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-[#37584f]/70 uppercase dark:text-[#c6d0cb]/60">
              Body
            </p>
            {request.bodyFields.length > 0 ? (
              <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 font-mono text-xs">
                {request.bodyFields.map((f) => (
                  <div key={f.key} className="contents">
                    <dt className="font-semibold text-[#02422b] dark:text-[#8fd3b4]">{f.key}</dt>
                    <dd className="break-all text-[#37584f] dark:text-[#c6d0cb]">{f.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <pre className="overflow-auto rounded-lg bg-[#02422b]/4 p-3 font-mono text-xs text-[#37584f] dark:bg-black/25 dark:text-[#c6d0cb]">
                {request.body}
              </pre>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
