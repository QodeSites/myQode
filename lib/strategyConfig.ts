// Shared strategy configuration derived from account code prefix (first 3 chars)
// Account code format: QFH0008, QAW0009, QTF0009, QGF0001 …

export const STRATEGY_NAMES: Record<string, string> = {
  QFH: 'Qode Future Horizons',
  QAW: 'Qode All Weather',
  QTF: 'Qode Tactical Fund',
  QGF: 'Qode Growth Fund',
}

export const STRATEGY_BENCHMARKS: Record<string, string> = {
  QAW: 'NIFTY 50',
  QTF: 'NIFTY MIDCAP 150',
  QGF: 'NIFTY SMLCAP 250',
  QFH: 'NIFTY MICROCAP250',
}

export const STRATEGY_COLORS: Record<string, string> = {
  QAW: '#008455',
  QTF: '#550E0E',
  QGF: '#0A3452',
  QFH: '#A78C11',
}

/** Extract the 3-char prefix from any account code. */
export function getPrefix(accountCode: string): string {
  return accountCode.substring(0, 3).toUpperCase()
}

export function getStrategyName(accountCode: string): string {
  return STRATEGY_NAMES[getPrefix(accountCode)] ?? 'Unknown Strategy'
}

export function getStrategyBenchmark(accountCode: string): string {
  return STRATEGY_BENCHMARKS[getPrefix(accountCode)] ?? 'NIFTY 50'
}

export function getStrategyColor(accountCode: string): string {
  return STRATEGY_COLORS[getPrefix(accountCode)] ?? '#666666'
}
