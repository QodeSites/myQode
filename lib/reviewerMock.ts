// Mock data served to the Play Store / App Store reviewer account.
// Activated when user.isReviewer === true — no database reads happen.
// Credentials: reviewer@qodeinvest.com / Review@123

// ── Shared helpers ────────────────────────────────────────────────────────────

const DATA_AS_OF   = '21 Mar 2025'
const INCEPTION_1  = '15 Mar 2021'   // DEMO001 – Qode All Weather
const INCEPTION_2  = '10 Jan 2022'   // DEMO002 – Qode Future Horizons

// ── NAV / Drawdown series (13 monthly points: Mar 2024 → Mar 2025) ────────────

const NAV_SERIES_1: { date: string; portfolio: number; benchmark: number | null }[] = [
  { date: '2024-03-28', portfolio: 100.0000, benchmark: 100.0000 },
  { date: '2024-04-30', portfolio:  97.8200, benchmark:  98.2400 },
  { date: '2024-05-31', portfolio: 101.4500, benchmark: 100.8100 },
  { date: '2024-06-28', portfolio: 104.2300, benchmark: 103.1200 },
  { date: '2024-07-31', portfolio: 108.1400, benchmark: 106.4500 },
  { date: '2024-08-30', portfolio: 105.6800, benchmark: 104.2100 },
  { date: '2024-09-30', portfolio: 109.8700, benchmark: 107.5300 },
  { date: '2024-10-31', portfolio: 113.2100, benchmark: 110.8400 },
  { date: '2024-11-29', portfolio: 111.4300, benchmark: 109.2200 },
  { date: '2024-12-31', portfolio: 114.0200, benchmark: 111.5100 },
  { date: '2025-01-31', portfolio: 111.8700, benchmark: 109.8300 },
  { date: '2025-02-28', portfolio: 113.1500, benchmark: 110.6200 },
  { date: '2025-03-21', portfolio: 114.5600, benchmark: 111.2300 },
]

// DEMO002 – slightly different curve
const NAV_SERIES_2: { date: string; portfolio: number; benchmark: number | null }[] = [
  { date: '2024-03-28', portfolio: 100.0000, benchmark: 100.0000 },
  { date: '2024-04-30', portfolio:  96.4100, benchmark:  98.2400 },
  { date: '2024-05-31', portfolio: 100.2200, benchmark: 100.8100 },
  { date: '2024-06-28', portfolio: 102.8700, benchmark: 103.1200 },
  { date: '2024-07-31', portfolio: 106.5300, benchmark: 106.4500 },
  { date: '2024-08-30', portfolio: 103.4100, benchmark: 104.2100 },
  { date: '2024-09-30', portfolio: 108.1200, benchmark: 107.5300 },
  { date: '2024-10-31', portfolio: 111.3800, benchmark: 110.8400 },
  { date: '2024-11-29', portfolio: 109.2100, benchmark: 109.2200 },
  { date: '2024-12-31', portfolio: 112.4300, benchmark: 111.5100 },
  { date: '2025-01-31', portfolio: 109.7600, benchmark: 109.8300 },
  { date: '2025-02-28', portfolio: 111.4200, benchmark: 110.6200 },
  { date: '2025-03-21', portfolio: 113.1200, benchmark: 111.2300 },
]

// Combined (no benchmark for multi-strategy)
const NAV_SERIES_COMBINED: { date: string; portfolio: number; benchmark: null }[] =
  NAV_SERIES_1.map((s, i) => ({
    date: s.date,
    portfolio: +((s.portfolio * 0.55 + NAV_SERIES_2[i].portfolio * 0.45)).toFixed(4),
    benchmark: null,
  }))

// Drawdown series
const DD_SERIES_1: { date: string; portfolio: number; benchmark: number | null }[] = [
  { date: '2024-03-28', portfolio:  0.0000, benchmark:  0.0000 },
  { date: '2024-04-30', portfolio: -2.1800, benchmark: -1.7600 },
  { date: '2024-05-31', portfolio: -0.5400, benchmark: -1.1900 },
  { date: '2024-06-28', portfolio:  0.0000, benchmark:  0.0000 },
  { date: '2024-07-31', portfolio:  0.0000, benchmark:  0.0000 },
  { date: '2024-08-30', portfolio: -2.3100, benchmark: -2.0800 },
  { date: '2024-09-30', portfolio: -0.8700, benchmark: -0.8500 },
  { date: '2024-10-31', portfolio:  0.0000, benchmark:  0.0000 },
  { date: '2024-11-29', portfolio: -1.5700, benchmark: -1.4200 },
  { date: '2024-12-31', portfolio:  0.0000, benchmark:  0.0000 },
  { date: '2025-01-31', portfolio: -1.9300, benchmark: -1.4600 },
  { date: '2025-02-28', portfolio: -1.2100, benchmark: -0.5500 },
  { date: '2025-03-21', portfolio: -2.3100, benchmark: -1.2300 },
]

const DD_SERIES_2: { date: string; portfolio: number; benchmark: number | null }[] = [
  { date: '2024-03-28', portfolio:  0.0000, benchmark:  0.0000 },
  { date: '2024-04-30', portfolio: -3.5900, benchmark: -1.7600 },
  { date: '2024-05-31', portfolio: -1.7800, benchmark: -1.1900 },
  { date: '2024-06-28', portfolio:  0.0000, benchmark:  0.0000 },
  { date: '2024-07-31', portfolio:  0.0000, benchmark:  0.0000 },
  { date: '2024-08-30', portfolio: -2.9200, benchmark: -2.0800 },
  { date: '2024-09-30', portfolio: -0.4100, benchmark: -0.8500 },
  { date: '2024-10-31', portfolio:  0.0000, benchmark:  0.0000 },
  { date: '2024-11-29', portfolio: -1.9400, benchmark: -1.4200 },
  { date: '2024-12-31', portfolio:  0.0000, benchmark:  0.0000 },
  { date: '2025-01-31', portfolio: -2.3400, benchmark: -1.4600 },
  { date: '2025-02-28', portfolio: -1.4200, benchmark: -0.5500 },
  { date: '2025-03-21', portfolio: -2.6400, benchmark: -1.2300 },
]

const DD_SERIES_COMBINED: { date: string; portfolio: number; benchmark: null }[] =
  DD_SERIES_1.map((s, i) => ({
    date: s.date,
    portfolio: +((s.portfolio + DD_SERIES_2[i].portfolio) / 2).toFixed(4),
    benchmark: null,
  }))

// ── Trailing returns ──────────────────────────────────────────────────────────

const TRAILING_1 = {
  w1: 0.42, d10: 1.15, m1: 2.31, m3: 4.87, m6: 8.23,
  y1: 14.56, y3: 12.40, currentDD: -2.31, maxDD: -18.45, sinceInception: 12.40,
}

const TRAILING_2 = {
  w1: 0.38, d10: 1.02, m1: 2.14, m3: 4.21, m6: 7.88,
  y1: 13.12, y3: 11.80, currentDD: -2.64, maxDD: -21.30, sinceInception: 11.80,
}

const TRAILING_BENCHMARK = {
  w1: 0.31, d10: 0.88, m1: 1.95, m3: 3.72, m6: 6.41,
  y1: 11.23, y3:  9.87, currentDD: -1.23, maxDD: -24.67, sinceInception: 9.87,
}

const TRAILING_COMBINED = {
  w1: 0.40, d10: 1.09, m1: 2.24, m3: 4.57, m6: 8.08,
  y1: 13.91, y3: 12.14, currentDD: -2.46, maxDD: -19.72, sinceInception: 12.14,
}

// ── Monthly P&L ───────────────────────────────────────────────────────────────

type YearRow = {
  year: number
  jan: number | null; feb: number | null; mar: number | null
  apr: number | null; may: number | null; jun: number | null
  jul: number | null; aug: number | null; sep: number | null
  oct: number | null; nov: number | null; dec: number | null
  total: number | null; yearCashFlow?: number | null
}

const MONTHLY_PCT_1: YearRow[] = [
  { year: 2021, jan: null, feb: null, mar: 0.00, apr: 2.31, may: 1.87, jun: -1.24, jul: 3.45, aug: 2.12, sep: -0.87, oct: 4.23, nov: -1.56, dec: 3.14, total: 14.72 },
  { year: 2022, jan: 2.41, feb: -2.87, mar: 1.23, apr: -3.41, may: -1.12, jun: -2.31, jul: 4.56, aug: 3.21, sep: -1.78, oct: 3.87, nov: 2.14, dec: -0.87, total: 5.21 },
  { year: 2023, jan: 3.12, feb: 1.45, mar: 2.87, apr: -0.98, may: 3.21, jun: 2.54, jul: 4.12, aug: -1.23, sep: 2.87, oct: -0.54, nov: 3.41, dec: 1.87, total: 24.12 },
  { year: 2024, jan: 4.12, feb: 2.31, mar: -1.87, apr: 3.54, may: -0.87, jun: 2.12, jul: 5.23, aug: -2.31, sep: 4.87, oct: 3.21, nov: -1.54, dec: 2.87, total: 28.41 },
  { year: 2025, jan: -1.23, feb: 1.45, mar: null, apr: null, may: null, jun: null, jul: null, aug: null, sep: null, oct: null, nov: null, dec: null, total: null },
]

const MONTHLY_PCT_2: YearRow[] = [
  { year: 2022, jan: 1.87, feb: -3.12, mar: 0.94, apr: -4.21, may: -0.87, jun: -2.54, jul: 3.87, aug: 2.74, sep: -2.14, oct: 3.41, nov: 1.87, dec: -1.12, total: 1.67 },
  { year: 2023, jan: 2.87, feb: 1.12, mar: 3.21, apr: -1.34, may: 2.87, jun: 2.14, jul: 3.87, aug: -1.54, sep: 2.54, oct: -0.87, nov: 3.12, dec: 1.54, total: 21.87 },
  { year: 2024, jan: 3.87, feb: 1.94, mar: -2.14, apr: 3.12, may: -1.12, jun: 1.87, jul: 4.87, aug: -2.64, sep: 4.41, oct: 2.87, nov: -1.87, dec: 2.54, total: 19.87 },
  { year: 2025, jan: -1.54, feb: 1.21, mar: null, apr: null, may: null, jun: null, jul: null, aug: null, sep: null, oct: null, nov: null, dec: null, total: null },
]

const MONTHLY_INR_1: YearRow[] = [
  { year: 2021, jan: null, feb: null, mar: 0, apr: 57750, may: 48141, jun: -32516, jul: 92246, aug: 57889, sep: -23920, oct: 117437, nov: -43875, dec: 88141, total: 361293, yearCashFlow: 2000000 },
  { year: 2022, jan: 68450, feb: -82400, mar: 35200, apr: -98700, may: -32400, jun: -67800, jul: 134200, aug: 94500, sep: -52800, oct: 114200, nov: 63200, dec: -26100, total: 149550, yearCashFlow: 500000 },
  { year: 2023, jan: 95100, feb: 44200, mar: 87600, apr: -30200, may: 98100, jun: 77800, jul: 126300, aug: -37800, sep: 88100, oct: -16700, nov: 105400, dec: 58100, total: 696000, yearCashFlow: 0 },
  { year: 2024, jan: 134200, feb: 75400, mar: -61200, apr: 115900, may: -28500, jun: 69500, jul: 171400, aug: -75800, sep: 159800, oct: 105500, nov: -50700, dec: 94300, total: 709800, yearCashFlow: 0 },
  { year: 2025, jan: -43200, feb: 50900, mar: null, apr: null, may: null, jun: null, jul: null, aug: null, sep: null, oct: null, nov: null, dec: null, total: null, yearCashFlow: null },
]

const MONTHLY_INR_2: YearRow[] = [
  { year: 2022, jan: 37400, feb: -64200, mar: 18700, apr: -86400, may: -17800, jun: -52800, jul: 80100, aug: 56700, sep: -44700, oct: 71200, nov: 39200, dec: -23500, total: 13900, yearCashFlow: 2000000 },
  { year: 2023, jan: 60800, feb: 23700, mar: 68300, apr: -28700, may: 62000, jun: 46600, jul: 84600, aug: -33900, sep: 56200, oct: -19500, nov: 69700, dec: 35200, total: 425000, yearCashFlow: 0 },
  { year: 2024, jan: 88700, feb: 44600, mar: -49600, apr: 73100, may: -26400, jun: 44400, jul: 116500, aug: -63900, sep: 107400, oct: 70200, nov: -46200, dec: 62800, total: 421600, yearCashFlow: 0 },
  { year: 2025, jan: -37800, feb: 29700, mar: null, apr: null, may: null, jun: null, jul: null, aug: null, sep: null, oct: null, nov: null, dec: null, total: null, yearCashFlow: null },
]

// ── Quarterly P&L ─────────────────────────────────────────────────────────────

type QRow = { year: number; q1: number | null; q2: number | null; q3: number | null; q4: number | null; total: number | null; yearCashFlow?: number | null }

const QUARTERLY_PCT_1: QRow[] = [
  { year: 2021, q1: 0.00, q2:  2.87, q3: 4.78, q4:  5.78, total: 14.72 },
  { year: 2022, q1: 0.61, q2: -6.72, q3: 5.92, q4:  5.14, total:  5.21 },
  { year: 2023, q1: 7.52, q2:  4.78, q3: 5.71, q4:  4.72, total: 24.12 },
  { year: 2024, q1: 4.54, q2:  4.76, q3: 7.69, q4:  4.41, total: 28.41 },
  { year: 2025, q1: null, q2:  null, q3: null, q4:  null, total:  null },
]

const QUARTERLY_PCT_2: QRow[] = [
  { year: 2022, q1: -0.32, q2: -7.45, q3: 4.41, q4: 4.87, total:  1.67 },
  { year: 2023, q1:  7.21, q2:  3.67, q3: 4.87, q4: 3.78, total: 21.87 },
  { year: 2024, q1:  3.61, q2:  3.84, q3: 6.54, q4: 3.41, total: 19.87 },
  { year: 2025, q1:  null, q2:  null, q3: null, q4: null,  total:  null },
]

const QUARTERLY_INR_1: QRow[] = [
  { year: 2021, q1: 0, q2: 71875, q3: 127215, q4: 162203, total: 361293, yearCashFlow: 2000000 },
  { year: 2022, q1: 21250, q2: -198900, q3: 175900, q4: 151300, total: 149550, yearCashFlow: 500000 },
  { year: 2023, q1: 226900, q2: 145700, q3: 176600, q4: 146800, total: 696000, yearCashFlow: 0 },
  { year: 2024, q1: 148400, q2: 157000, q3: 254600, q4: 149800, total: 709800, yearCashFlow: 0 },
  { year: 2025, q1: null, q2: null, q3: null, q4: null, total: null, yearCashFlow: null },
]

const QUARTERLY_INR_2: QRow[] = [
  { year: 2022, q1: -8100, q2: -157400, q3: 115900, q4: 63400, total: 13800, yearCashFlow: 2000000 },
  { year: 2023, q1: 152800, q2: 79900, q3: 106900, q4: 85400, total: 425000, yearCashFlow: 0 },
  { year: 2024, q1: 83700, q2: 91100, q3: 160000, q4: 86800, total: 421600, yearCashFlow: 0 },
  { year: 2025, q1: null, q2: null, q3: null, q4: null, total: null, yearCashFlow: null },
]

// ── Public mock response builders ─────────────────────────────────────────────

export const REVIEWER_ACCOUNT_CODES = ['DEMO001', 'DEMO002']

export const REVIEWER_MOCK_SNAPSHOT = {
  owners: [
    {
      id: 'DEMO_OWNER',
      name: 'Demo User',
      email: 'reviewer@qodeinvest.com',
      groupId: null,
      isHeadOfFamily: false,
      totalValue: 6300000,
      accounts: [
        {
          id: 'DEMO001',
          strategyPrefix: 'QAW',
          strategyName: 'Qode All Weather',
          strategyColor: '#3B82F6',
          type: 'Individual Account',
          clientId: 'DEMO_C1',
          lastUpdated: '2025-03-21',
          portfolioValue: 3500000,
          status: 'active',
          isClosed: false,
          mobile: null,
        },
        {
          id: 'DEMO002',
          strategyPrefix: 'QFH',
          strategyName: 'Qode Future Horizons',
          strategyColor: '#8B5CF6',
          type: 'Individual Account',
          clientId: 'DEMO_C2',
          lastUpdated: '2025-03-21',
          portfolioValue: 2800000,
          status: 'active',
          isClosed: false,
          mobile: null,
        },
      ],
    },
  ],
  totalPortfolioValue: 6300000,
  formattedTotal: '₹63,00,000',
  activeAccountCount: 2,
  isHeadOfFamily: false,
  groupId: null,
}

export function reviewerMockPerformance(accountId: string) {
  const isDemo2 = accountId === 'DEMO002'
  return {
    accountId,
    isClosed: false,
    closedAt: null,
    strategy: isDemo2
      ? { prefix: 'QFH', name: 'Qode Future Horizons', benchmark: 'NIFTY 500', color: '#8B5CF6' }
      : { prefix: 'QAW', name: 'Qode All Weather',     benchmark: 'NIFTY 500', color: '#3B82F6' },
    amountInvested: isDemo2 ? 2000000 : 2500000,
    currentValue:   isDemo2 ? 2800000 : 3500000,
    totalReturns:   isDemo2 ?  800000 : 1000000,
    returnsPercent: isDemo2 ? 11.80 : 12.40,
    isNegative: false,
    inceptionDate: isDemo2 ? INCEPTION_2 : INCEPTION_1,
    dataAsOf: DATA_AS_OF,
    grossValue: isDemo2 ? 2800000 : 3500000,
    trailingReturns: {
      portfolio:  isDemo2 ? TRAILING_2 : TRAILING_1,
      benchmark: TRAILING_BENCHMARK,
    },
  }
}

export function reviewerMockNav(accountId: string) {
  const series = accountId === 'DEMO002' ? NAV_SERIES_2 : NAV_SERIES_1
  const allValues = series.flatMap(s => [s.portfolio, ...(s.benchmark !== null ? [s.benchmark] : [])])
  return {
    accountId,
    period: '1Y',
    isClosed: false,
    closedAt: null,
    strategy: accountId === 'DEMO002'
      ? { prefix: 'QFH', name: 'Qode Future Horizons', benchmark: 'NIFTY 500' }
      : { prefix: 'QAW', name: 'Qode All Weather',     benchmark: 'NIFTY 500' },
    series,
    minValue: +Math.min(...allValues).toFixed(2),
    maxValue: +Math.max(...allValues).toFixed(2),
  }
}

export function reviewerMockDrawdown(accountId: string) {
  const series = accountId === 'DEMO002' ? DD_SERIES_2 : DD_SERIES_1
  return { accountId, period: '1Y', isClosed: false, closedAt: null, series }
}

export function reviewerMockMonthlyPL(accountId: string) {
  const isDemo2 = accountId === 'DEMO002'
  return {
    isClosed: false,
    closedAt: null,
    percentData: isDemo2 ? MONTHLY_PCT_2 : MONTHLY_PCT_1,
    rupeeData:   isDemo2 ? MONTHLY_INR_2 : MONTHLY_INR_1,
  }
}

export function reviewerMockQuarterlyPL(accountId: string) {
  const isDemo2 = accountId === 'DEMO002'
  return {
    isClosed: false,
    closedAt: null,
    percentData: isDemo2 ? QUARTERLY_PCT_2 : QUARTERLY_PCT_1,
    rupeeData:   isDemo2 ? QUARTERLY_INR_2 : QUARTERLY_INR_1,
  }
}

export function reviewerMockCashflow(accountId: string) {
  const isDemo2 = accountId === 'DEMO002'
  if (isDemo2) {
    return {
      isClosed: false, closedAt: null,
      transactions: [
        { date: '2022-01-10', amount: 2000000, type: 'inflow',  formattedAmount: '+₹20,00,000' },
      ],
      total: 2000000, formattedTotal: '₹20,00,000',
    }
  }
  return {
    isClosed: false, closedAt: null,
    transactions: [
      { date: '2021-03-15', amount: 2000000, type: 'inflow',  formattedAmount: '+₹20,00,000' },
      { date: '2023-01-10', amount:  500000, type: 'inflow',  formattedAmount: '+₹5,00,000'  },
    ],
    total: 2500000, formattedTotal: '₹25,00,000',
  }
}

// ── Combined (owner-level: DEMO001 + DEMO002) ─────────────────────────────────

export const REVIEWER_MOCK_COMBINED_PERFORMANCE = {
  accountIds: ['DEMO001', 'DEMO002'],
  isClosed: false,
  closedAt: null,
  amountInvested: 4500000,
  currentValue: 6300000,
  totalReturns: 1800000,
  returnsPercent: 12.14,
  isNegative: false,
  inceptionDate: INCEPTION_1,
  dataAsOf: DATA_AS_OF,
  grossValue: 6300000,
  trailingReturns: { portfolio: TRAILING_COMBINED },
}

export const REVIEWER_MOCK_COMBINED_NAV = (() => {
  const allValues = NAV_SERIES_COMBINED.map(s => s.portfolio)
  return {
    accountIds: ['DEMO001', 'DEMO002'],
    period: '1Y',
    isClosed: false,
    closedAt: null,
    series: NAV_SERIES_COMBINED,
    minValue: +Math.min(...allValues).toFixed(2),
    maxValue: +Math.max(...allValues).toFixed(2),
  }
})()

export const REVIEWER_MOCK_COMBINED_DRAWDOWN = {
  accountIds: ['DEMO001', 'DEMO002'],
  period: '1Y',
  isClosed: false,
  closedAt: null,
  series: DD_SERIES_COMBINED,
}

export const REVIEWER_MOCK_COMBINED_MONTHLY_PL = {
  isClosed: false,
  closedAt: null,
  percentData: [
    { year: 2022, jan: 2.14, feb: -2.98, mar: 1.09, apr: -3.81, may: -0.99, jun: -2.43, jul: 4.22, aug: 2.97, sep: -1.95, oct: 3.64, nov: 2.01, dec: -0.99, total: 3.51 },
    { year: 2023, jan: 2.99, feb: 1.28, mar: 3.04, apr: -1.15, may: 3.04, jun: 2.34, jul: 3.99, aug: -1.38, sep: 2.70, oct: -0.71, nov: 3.26, dec: 1.70, total: 22.99 },
    { year: 2024, jan: 3.99, feb: 2.12, mar: -2.01, apr: 3.33, may: -0.99, jun: 1.99, jul: 5.05, aug: -2.47, sep: 4.64, oct: 3.04, nov: -1.70, dec: 2.70, total: 24.14 },
    { year: 2025, jan: -1.38, feb: 1.33, mar: null, apr: null, may: null, jun: null, jul: null, aug: null, sep: null, oct: null, nov: null, dec: null, total: null },
  ],
  rupeeData: [
    { year: 2022, jan: 105850, feb: -146600, mar: 54000, apr: -185100, may: -50200, jun: -120600, jul: 214300, aug: 151200, sep: -97500, oct: 185400, nov: 102400, dec: -49600, total: 163550, yearCashFlow: 4000000 },
    { year: 2023, jan: 155900, feb: 67900, mar: 155900, apr: -58900, may: 160100, jun: 124400, jul: 210900, aug: -71700, sep: 144300, oct: -36200, nov: 175100, dec: 93300, total: 1121000, yearCashFlow: 0 },
    { year: 2024, jan: 222900, feb: 120000, mar: -110800, apr: 189000, may: -54900, jun: 113900, jul: 287900, aug: -139700, sep: 267200, oct: 175700, nov: -96900, dec: 157100, total: 1131400, yearCashFlow: 0 },
    { year: 2025, jan: -81000, feb: 80600, mar: null, apr: null, may: null, jun: null, jul: null, aug: null, sep: null, oct: null, nov: null, dec: null, total: null, yearCashFlow: null },
  ],
}

export const REVIEWER_MOCK_COMBINED_QUARTERLY_PL = {
  isClosed: false,
  closedAt: null,
  percentData: [
    { year: 2022, q1: 0.14, q2: -7.09, q3: 5.17, q4: 5.01, total: 3.51 },
    { year: 2023, q1: 7.36, q2: 4.22, q3: 5.29, q4: 4.25, total: 22.99 },
    { year: 2024, q1: 4.08, q2: 4.30, q3: 7.12, q4: 3.91, total: 24.14 },
    { year: 2025, q1: null, q2: null, q3: null, q4: null, total: null },
  ],
  rupeeData: [
    { year: 2022, q1: 13150, q2: -356300, q3: 291800, q4: 214700, total: 163350, yearCashFlow: 4000000 },
    { year: 2023, q1: 379700, q2: 225600, q3: 283500, q4: 232200, total: 1121000, yearCashFlow: 0 },
    { year: 2024, q1: 232100, q2: 248100, q3: 414600, q4: 236600, total: 1131400, yearCashFlow: 0 },
    { year: 2025, q1: null, q2: null, q3: null, q4: null, total: null, yearCashFlow: null },
  ],
}

export const REVIEWER_MOCK_COMBINED_CASHFLOW = {
  isClosed: false,
  closedAt: null,
  transactions: [
    { date: '2021-03-15', accountId: 'DEMO001', amount: 2000000, type: 'inflow',  formattedAmount: '+₹20,00,000' },
    { date: '2022-01-10', accountId: 'DEMO002', amount: 2000000, type: 'inflow',  formattedAmount: '+₹20,00,000' },
    { date: '2023-01-10', accountId: 'DEMO001', amount:  500000, type: 'inflow',  formattedAmount: '+₹5,00,000'  },
  ],
  total: 4500000,
  formattedTotal: '₹45,00,000',
}
