/**
 * Converts a number to Indian-format words.
 *
 * Every financial document states its amount in words as well as figures, so
 * both the fee statement and the distributor's tax invoice need this. Shared
 * rather than duplicated: two copies would eventually disagree, and an invoice
 * whose words and figures differ is a defect on the face of the document.
 */
export function amountInWords(n: number): string {
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen',
  ]
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  const two = (x: number): string =>
    x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ' ' + ones[x % 10] : ''}`
  const three = (x: number): string =>
    x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x)

  const whole = Math.floor(Math.abs(n))
  const paise = Math.round((Math.abs(n) - whole) * 100)
  if (whole === 0 && paise === 0) return 'Zero Rupees Only'

  const crore = Math.floor(whole / 1_00_00_000)
  const lakh = Math.floor((whole % 1_00_00_000) / 1_00_000)
  const thousand = Math.floor((whole % 1_00_000) / 1000)
  const rest = whole % 1000

  const parts: string[] = []
  if (crore) parts.push(`${three(crore)} Crore`)
  if (lakh) parts.push(`${three(lakh)} Lakh`)
  if (thousand) parts.push(`${three(thousand)} Thousand`)
  if (rest) parts.push(three(rest))

  const rupees = parts.join(' ') || 'Zero'
  return paise ? `${rupees} Rupees and ${two(paise)} Paise Only` : `${rupees} Rupees Only`
}
