// GET /api/mobile/app-version
// Returns the current minimum required version and latest version for the app.
// The frontend compares the installed version against minVersion to decide whether
// to show a force-update modal, or against latestVersion for a soft-update nudge.
//
// Config is driven entirely by environment variables so you can roll a new minimum
// without a code deploy — just update the env vars and redeploy.
//
// Environment variables (all optional — sensible defaults are provided):
//   APP_MIN_VERSION      e.g. "1.1.0"   — anything below this forces an update
//   APP_LATEST_VERSION   e.g. "1.1.2"   — the version currently in the stores
//   APP_FORCE_UPDATE     e.g. "true"    — set to "true" to force ALL users to update
//                                         regardless of their installed version
//   APP_UPDATE_MESSAGE   e.g. "A critical update is required."
//   APP_IOS_URL          App Store URL
//   APP_ANDROID_URL      Play Store URL

import { NextResponse } from 'next/server'

const DEFAULT_MIN_VERSION    = '1.0.0'
const DEFAULT_LATEST_VERSION = '1.1.2'
const DEFAULT_IOS_URL        = 'https://apps.apple.com/app/myqode/id6743498744'
const DEFAULT_ANDROID_URL    = 'https://play.google.com/store/apps/details?id=com.qodeinvest.myqode'
const DEFAULT_MESSAGE        = 'A new version of myQode is available. Please update for the best experience and latest features.'
const FORCE_MESSAGE          = 'A critical update is required. Please update myQode to continue using the app.'

export async function GET() {
  const minVersion    = process.env.APP_MIN_VERSION    ?? DEFAULT_MIN_VERSION
  const latestVersion = process.env.APP_LATEST_VERSION ?? DEFAULT_LATEST_VERSION
  const forceAll      = process.env.APP_FORCE_UPDATE   === 'true'
  const iosUrl        = process.env.APP_IOS_URL        ?? DEFAULT_IOS_URL
  const androidUrl    = process.env.APP_ANDROID_URL    ?? DEFAULT_ANDROID_URL
  const message       = process.env.APP_UPDATE_MESSAGE ?? (forceAll ? FORCE_MESSAGE : DEFAULT_MESSAGE)

  return NextResponse.json({
    minVersion,
    latestVersion,
    forceUpdate: forceAll,
    message,
    updateUrls: {
      ios:     iosUrl,
      android: androidUrl,
    },
  })
}
