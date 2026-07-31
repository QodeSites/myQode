import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Strips the float suffix from an account identifier.
 *
 * `pms_clients_master.ownerid` and `.groupid` are varchar columns holding
 * float-formatted values ("65941.0") — an upstream import wrote numbers into
 * text columns. `pms_master_sheet.account_code` has no such suffix, so any
 * exact-match lookup using the raw value silently returns nothing: a blank
 * portfolio chart rather than a visible error.
 *
 * Only a trailing ".0" (or ".00", …) is removed. A value with real decimal
 * precision is a different identifier and is returned unchanged rather than
 * being silently altered.
 *
 *   normaliseAccountCode("65941.0")  // "65941"
 *   normaliseAccountCode("65941")    // "65941"
 *   normaliseAccountCode("6594.15")  // "6594.15"  (untouched)
 */
export function normaliseAccountCode(code: string | null | undefined): string {
  if (!code) return ""
  return String(code).trim().replace(/\.0+$/, "")
}
