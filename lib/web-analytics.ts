/**
 * web-analytics.ts — Lightweight event analytics for the myQode web portal.
 *
 * Mirrors myqode-mobile/utils/analytics.ts so both platforms feed the same
 * pms_mobile_analytics table with platform: 'web' vs 'ios'/'android', letting
 * the admin dashboard compare them directly. Posts to the same endpoint the
 * mobile app already uses (/api/mobile/engagement/analytics) — that route
 * degrades gracefully without a mobile JWT, storing whatever userId/platform
 * the client sends.
 *
 * Usage:
 *   import { WebAnalytics } from '@/lib/web-analytics';
 *   WebAnalytics.identify('client@email.com');   // call once email is known
 *   WebAnalytics.screen('Portfolio');             // on route change
 *   WebAnalytics.event('strategy_changed', { from: 'QAW', to: 'QGF' });
 *   WebAnalytics.error('api_error', { endpoint: '/api/...' });
 */

type Props = Record<string, string | number | boolean | null> | undefined;

type AnalyticsEvent = {
  type: 'screen' | 'event' | 'error';
  name: string;
  properties?: Props;
  userId: string | null;
  sessionId: string;
  timestamp: string;
  platform: 'web';
  appVersion: string;
};

const ENDPOINT = '/api/mobile/engagement/analytics';
const BATCH_INTERVAL_MS = 10_000;
const MAX_QUEUE_SIZE = 50;

let _userId: string | null = null;
let _sessionId = generateSessionId();
let _queue: AnalyticsEvent[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildEvent(type: AnalyticsEvent['type'], name: string, properties?: Props): AnalyticsEvent {
  return {
    type,
    name,
    properties: properties ?? {},
    userId: _userId,
    sessionId: _sessionId,
    timestamp: new Date().toISOString(),
    platform: 'web',
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown',
  };
}

function enqueue(event: AnalyticsEvent) {
  _queue.push(event);
  if (_queue.length >= MAX_QUEUE_SIZE) flush();
  else scheduleFlush();
}

function scheduleFlush() {
  if (_flushTimer !== null) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flush();
  }, BATCH_INTERVAL_MS);
}

function flush() {
  if (_flushTimer !== null) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (_queue.length === 0 || typeof window === 'undefined') return;

  const batch = _queue.splice(0, _queue.length);
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: batch }),
    keepalive: true, // let the request survive a page navigation
  }).catch(() => {
    // Never block/break the UI for analytics — silently drop on failure.
  });
}

export const WebAnalytics = {
  identify(email: string) {
    _userId = email;
  },

  screen(screenName: string, properties?: Props) {
    enqueue(buildEvent('screen', screenName, properties));
  },

  event(eventName: string, properties?: Props) {
    enqueue(buildEvent('event', eventName, properties));
  },

  error(errorName: string, properties?: Props) {
    enqueue(buildEvent('error', errorName, properties));
  },

  reset() {
    flush();
    _userId = null;
    _sessionId = generateSessionId();
  },

  flush,
};
