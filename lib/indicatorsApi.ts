/**
 * Base path the Valuation Spread Indicator fetches from.
 *
 * In qode360 the chart hits the FastAPI backend directly. Here it goes
 * through /api/distributor/indicators/[...path], a server-side proxy that
 * checks the partner's portal session and forwards to the qode360 backend.
 * That keeps the backend origin out of the browser bundle and means an
 * anonymous visitor cannot use this site as a relay to it.
 *
 * URLs are built as `${INDICATOR_API_BASE}/indicator/<endpoint>/...`,
 * matching the backend's /api/v1/indicator/... routes one-to-one.
 */
export const INDICATOR_API_BASE = "/api/distributor/indicators";
