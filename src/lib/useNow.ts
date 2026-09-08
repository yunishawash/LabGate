"use client";
import { useEffect, useState } from "react";

/**
 * The current time, as state rather than as a `Date.now()` call during render.
 *
 * Two reasons, both real:
 *  1. A client component is still prerendered on the server. `Date.now()` inside
 *     render produces a different value there than in the browser, which is a
 *     hydration mismatch waiting for a slow request to expose it.
 *  2. "Waiting 47h" on a queue screen that never ticks is worse than no number —
 *     somebody leaves the tab open and reads a stale age as a live one.
 *
 * Returns `null` on the first render (server and hydration agree on null), then
 * the real time, refreshed on an interval. Callers render a dash until it lands.
 */
export function useNow(everyMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
