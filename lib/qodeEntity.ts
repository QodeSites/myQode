// Qode's own billing identity — the "Bill To" party on a distributor invoice.
//
// Held in one place rather than typed by each distributor: fifteen distributors
// entering our GSTIN by hand would produce fifteen variations, and a wrong
// recipient GSTIN invalidates the input tax credit on the invoice.
//
// Values below are from the GST registration certificate (Form GST REG-06,
// amended 11/12/2024). The GSTIN's check digit and state code were verified
// against lib/invoiceTax.ts#validateGstin before being committed here.
//
// State code 27 (Maharashtra) matters beyond identification: a distributor
// registered in Maharashtra raises CGST+SGST, everyone else raises IGST.

export interface BillingEntity {
  name: string
  gstin: string
  pan: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  /** GST state code, e.g. '27' for Maharashtra. Drives CGST+SGST vs IGST. */
  stateCode: string
  pincode: string
  /** SEBI portfolio manager registration — printed for identification. */
  sebiRegistration: string
}

export const QODE_ENTITY: BillingEntity = {
  name: 'Qode Advisors LLP',
  gstin: '27AABFQ1993R1ZG',
  // Characters 3–12 of the GSTIN, which is where the PAN is embedded.
  pan: 'AABFQ1993R',
  addressLine1: 'Floor 2, Office No. 203, Hamam House',
  addressLine2: 'Ambalal Doshi Marg, Fort',
  city: 'Mumbai',
  state: 'Maharashtra',
  stateCode: '27',
  pincode: '400001',
  sebiRegistration: 'INP000008914',
}

/**
 * Whether Qode's details are complete enough to appear on a tax invoice.
 *
 * The invoice UI gates generation on this. A tax invoice naming a recipient
 * without their GSTIN or registered address is not a valid tax invoice, and
 * producing one that merely looks valid is the failure this prevents.
 */
export function isQodeEntityComplete(entity: BillingEntity = QODE_ENTITY): boolean {
  return Boolean(
    entity.name.trim() &&
      entity.gstin.trim() &&
      entity.addressLine1.trim() &&
      entity.stateCode.trim(),
  )
}

/** The parts of Qode's address that are set, for rendering as lines. */
export function qodeAddressLines(entity: BillingEntity = QODE_ENTITY): string[] {
  return [
    entity.addressLine1,
    entity.addressLine2,
    [entity.city, entity.state, entity.pincode].filter(Boolean).join(', '),
  ]
    .map((l) => l.trim())
    .filter(Boolean)
}
