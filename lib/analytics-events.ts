/**
 * The shared event vocabulary.
 *
 * Every Qode app sends these same names, which is the whole reason one
 * dashboard can cover the website, the mobile app and the backend. Names are
 * snake_case and past tense; adding one here without adding it everywhere
 * fragments the funnel, so treat this list as a contract rather than a default.
 */

export const EVENTS = {
  LOGIN_SUCCEEDED: "login_succeeded",
  PRODUCT_VIEWED: "product_viewed",
  FACTSHEET_DOWNLOADED: "factsheet_downloaded",
  PORTFOLIO_VIEWED: "portfolio_viewed",
  SUPPORT_CONTACTED: "support_contacted",
  CALL_BOOKED: "call_booked",
  RISK_PROFILE_COMPLETED: "risk_profile_completed",
  INVESTMENT_STARTED: "investment_started",
  SIP_STARTED: "sip_started",
  WITHDRAWAL_REQUESTED: "withdrawal_requested",
} as const

export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

export interface DefaultProperties {
  app: string
  platform: "web" | "ios" | "android" | "backend"
  app_version: string
  environment: string
}

export interface EventProperties {
  [EVENTS.LOGIN_SUCCEEDED]: { method: string }
  [EVENTS.PRODUCT_VIEWED]: { product: string }
  [EVENTS.FACTSHEET_DOWNLOADED]: { product: string }
  [EVENTS.PORTFOLIO_VIEWED]: Record<string, never>
  [EVENTS.SUPPORT_CONTACTED]: { channel: string }
  [EVENTS.CALL_BOOKED]: { source: string }
  [EVENTS.RISK_PROFILE_COMPLETED]: { risk_band: string }
  [EVENTS.INVESTMENT_STARTED]: { product: string }
  [EVENTS.SIP_STARTED]: { product: string; amount: number }
  [EVENTS.WITHDRAWAL_REQUESTED]: { product: string; amount: number }
}

export const APP_NAME = "my-qode"

export function defaultProperties(platform: DefaultProperties["platform"]): DefaultProperties {
  return {
    app: APP_NAME,
    platform,
    app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  }
}
