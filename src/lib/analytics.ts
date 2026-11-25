// Custom-event tracking through Umami (cookieless; the script is added in
// src/components/Analytics.tsx). Safe to call anywhere on the client: it is a
// no-op when Umami isn't configured, and events fired before the script has
// loaded (e.g. on page mount) are queued and sent once it arrives.
//
// Never pass personal data (names, emails, phones, addresses, postcodes,
// free-text notes). Plan, dish and payment-method names are fine.

type EventData = Record<string, string | number | boolean>;

type Umami = { track: (event: string, data?: EventData) => void };

declare global {
  interface Window {
    umami?: Umami;
  }
}

const QUEUE_RETRY_MS = 500;
const QUEUE_GIVE_UP_MS = 10_000;

const queue: [string, EventData | undefined][] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function startFlushing() {
  if (flushTimer) return;
  const startedAt = Date.now();
  flushTimer = setInterval(() => {
    const umami = window.umami;
    if (umami) {
      for (const [event, data] of queue.splice(0)) umami.track(event, data);
    }
    if (umami || Date.now() - startedAt > QUEUE_GIVE_UP_MS) {
      // Not configured or blocked (e.g. by an ad blocker): drop the queue.
      queue.length = 0;
      clearInterval(flushTimer!);
      flushTimer = null;
    }
  }, QUEUE_RETRY_MS);
}

export function track(event: string, data?: EventData) {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID) return;
  try {
    if (window.umami) {
      window.umami.track(event, data);
    } else {
      queue.push([event, data]);
      startFlushing();
    }
  } catch {
    // Analytics must never break the page.
  }
}
