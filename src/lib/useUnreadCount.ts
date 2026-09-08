"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The unread badge, kept live by the SSE stream.
 *
 * The stream carries no content — only "something changed" — so this refetches
 * the count rather than trusting the wire. That keeps one authorisation path
 * (the GET, filtered by userId) instead of two, and means a dropped event costs
 * at most one stale minute rather than a wrong number forever.
 */
export function useUnreadCount(enabled: boolean) {
  const [unread, setUnread] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=1");
      if (!res.ok) return;
      const d = await res.json();
      setUnread(d.unread ?? 0);
    } catch {
      /* offline for a moment; the next event or poll picks it up */
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setUnread(0);
      return;
    }
    refetch();

    const es = new EventSource("/api/notifications/stream");
    es.addEventListener("notification", () => {
      /**
       * Coalesce: approving a stage can deliver to several people at once, and
       * a burst of events must not become a burst of identical requests.
       */
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refetch, 400);
    });

    /**
     * EventSource reconnects on its own after an error, so no retry logic here.
     * A slow poll covers the gap where the browser has given up entirely (a
     * laptop asleep through the night, a proxy that killed the connection).
     */
    const poll = setInterval(refetch, 120_000);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      clearInterval(poll);
      es.close();
    };
  }, [enabled, refetch]);

  return { unread, refetch };
}
