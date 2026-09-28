import * as Sentry from "@sentry/nextjs"

/** Loads the right Sentry config for whichever runtime Next is booting. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
    // App notifications (lib/appNotifyWorker.ts): the production server, or any server with NOTIFY_WORKER=1.
    if (process.env.NOTIFY_WORKER !== "0" && (process.env.NODE_ENV === "production" || process.env.NOTIFY_WORKER === "1")) {
      const { startAppNotifyWorker } = await import("./lib/appNotifyWorker")
      startAppNotifyWorker()
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

export const onRequestError = Sentry.captureRequestError
