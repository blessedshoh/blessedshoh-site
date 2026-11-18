// Usage counting for the admin dashboard. Each event is sent at most once per page view
// and only the event's name goes out: no cookies, no identifiers, no outside tracker.

export const EVENTS = ["priced", "shared", "link_opened", "risk", "tree", "chain", "sketch", "compare", "work"] as const;
export type UsageEvent = (typeof EVENTS)[number];

const sent = new Set<UsageEvent>();

export function track(event: UsageEvent) {
  if (sent.has(event) || typeof window === "undefined") return;
  sent.add(event);
  fetch("/hit", { method: "POST", body: event, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {
    // Counting must never get in the visitor's way.
  });
}
