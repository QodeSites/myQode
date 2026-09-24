"use client"

import { useState } from "react"

type Props = { value: unknown; depth?: number; initialOpen?: boolean }

const PUNCT = "text-[#37584f]/70 dark:text-[#c6d0cb]/60"

function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="text-[#37584f]/60 italic dark:text-[#c6d0cb]/50">null</span>
  switch (typeof value) {
    case "string":
      return <span className="text-[#02422b] dark:text-[#8fd3b4] break-all">&quot;{value}&quot;</span>
    case "number":
      return <span className="text-[#8a5a00] dark:text-[#dabd38]">{String(value)}</span>
    case "boolean":
      return <span className="text-[#550e0e] dark:text-[#e79a9a]">{String(value)}</span>
    default:
      return <span>{String(value)}</span>
  }
}

/**
 * Collapsible JSON tree. Nodes below the first two levels start collapsed so a
 * 400-record array stays navigable.
 */
export function JsonView({ value, depth = 0, initialOpen }: Props) {
  const isContainer = value !== null && typeof value === "object"
  const [open, setOpen] = useState(initialOpen ?? depth < 1)

  if (!isContainer) return <Leaf value={value} />

  const isArray = Array.isArray(value)
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)

  const [openBrace, closeBrace] = isArray ? ["[", "]"] : ["{", "}"]

  if (entries.length === 0) {
    return (
      <span className={PUNCT}>
        {openBrace}
        {closeBrace}
      </span>
    )
  }

  return (
    <span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="cursor-pointer rounded px-0.5 hover:bg-[#02422b]/10 focus-visible:ring-2 focus-visible:ring-[#02422b] focus-visible:outline-none dark:hover:bg-[#dabd38]/15"
      >
        <span className={PUNCT}>{openBrace}</span>
        {!open && (
          <span className="mx-1 text-xs text-[#37584f]/70 dark:text-[#c6d0cb]/60">
            {entries.length} {entries.length === 1 ? "item" : "items"}
          </span>
        )}
        {!open && <span className={PUNCT}>{closeBrace}</span>}
      </button>

      {open && (
        <>
          <ul className="ml-4 border-l border-[#37584f]/20 pl-3 dark:border-[#c6d0cb]/15">
            {entries.map(([key, child]) => (
              <li key={key} className="py-px">
                <span className="text-[#37584f] dark:text-[#c6d0cb]">
                  {isArray ? <span className="opacity-50">{key}</span> : `"${key}"`}
                </span>
                <span className={PUNCT}>: </span>
                <JsonView value={child} depth={depth + 1} />
              </li>
            ))}
          </ul>
          <span className={PUNCT}>{closeBrace}</span>
        </>
      )}
    </span>
  )
}
