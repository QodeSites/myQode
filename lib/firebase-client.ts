// Firebase Web SDK initialization.
//
// Runs on the browser only. The same web bundle loads inside the iOS and
// Android Capacitor WebViews, so a single Firebase project tracks all three
// surfaces. Platform is distinguished via a custom `app_platform` event
// parameter set on every event.
//
// Required env vars (all NEXT_PUBLIC_ since they need to ship to the browser):
//   NEXT_PUBLIC_FIREBASE_API_KEY
//   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID
//   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
//   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
//   NEXT_PUBLIC_FIREBASE_APP_ID
//   NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID

import { initializeApp, getApps, FirebaseApp } from 'firebase/app'
import {
  getAnalytics,
  isSupported,
  logEvent,
  setUserId,
  setUserProperties,
  Analytics,
} from 'firebase/analytics'

let firebaseApp: FirebaseApp | null = null
let analytics: Analytics | null = null
let analyticsReady: Promise<Analytics | null> | null = null

function readConfig() {
  return {
    apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId:     process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  }
}

function detectPlatform(): 'ios' | 'android' | 'web' {
  if (typeof window === 'undefined') return 'web'
  // Capacitor exposes its platform on window.Capacitor when running inside
  // the native WebView. In a regular browser, this is undefined.
  const cap = (window as any).Capacitor
  const p = cap?.getPlatform?.() ?? cap?.platform
  if (p === 'ios' || p === 'android') return p
  // Fallback heuristic on user agent if Capacitor object isn't available
  // (e.g. very early page lifecycle on some builds).
  const ua = window.navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua) && /MyQode|Capacitor/i.test(ua)) return 'ios'
  if (/Android/i.test(ua) && /MyQode|Capacitor/i.test(ua)) return 'android'
  return 'web'
}

function initIfNeeded(): FirebaseApp | null {
  if (typeof window === 'undefined') return null
  if (firebaseApp) return firebaseApp
  const cfg = readConfig()
  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
    console.warn('[firebase] env vars missing — analytics disabled')
    return null
  }
  firebaseApp = getApps()[0] ?? initializeApp(cfg)
  return firebaseApp
}

// Returns analytics instance (or null if unsupported / env missing).
// Promise so callers can `await ensureAnalytics()` without blocking SSR.
export function ensureAnalytics(): Promise<Analytics | null> {
  if (analyticsReady) return analyticsReady
  analyticsReady = (async () => {
    const app = initIfNeeded()
    if (!app) return null
    if (!(await isSupported())) return null
    analytics = getAnalytics(app)
    return analytics
  })()
  return analyticsReady
}

export async function trackScreen(
  name: string,
  extra: Record<string, unknown> = {}
) {
  const a = await ensureAnalytics()
  if (!a) return
  logEvent(a, 'screen_view', {
    firebase_screen: name,
    firebase_screen_class: name,
    app_platform: detectPlatform(),
    ...extra,
  })
}

export async function trackEvent(
  name: string,
  params: Record<string, unknown> = {}
) {
  const a = await ensureAnalytics()
  if (!a) return
  logEvent(a, name, {
    app_platform: detectPlatform(),
    ...params,
  })
}

export async function identifyUser(
  userId: string | null,
  properties: Record<string, unknown> = {}
) {
  const a = await ensureAnalytics()
  if (!a) return
  setUserId(a, userId)
  if (Object.keys(properties).length > 0) {
    setUserProperties(a, properties as { [key: string]: any })
  }
}

export { detectPlatform }
