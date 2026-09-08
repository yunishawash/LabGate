type PushFn = (data: string) => void;

/**
 * In-memory registry of open SSE connections, kept on `global` so it survives
 * HMR in development.
 *
 * ⚠️ Single process only. There is no Redis pub/sub, so this breaks silently
 * under PM2 cluster mode, multiple replicas, or a load balancer without sticky
 * sessions — notifications simply stop arriving for some users. Fine for one
 * plant server; see SPEC §16 before scaling out.
 */
declare global {
  // eslint-disable-next-line no-var
  var __sseClients: Map<string, Set<PushFn>>;
}

if (!global.__sseClients) global.__sseClients = new Map();
export const sseClients = global.__sseClients;

export function registerClient(userId: string, push: PushFn): () => void {
  const key = String(userId);
  let set = sseClients.get(key);
  if (!set) {
    set = new Set();
    sseClients.set(key, set);
  }
  set.add(push);

  return () => {
    const current = sseClients.get(key);
    if (!current) return;
    current.delete(push);
    if (current.size === 0) sseClients.delete(key);
  };
}

/**
 * Nudge a user's open tabs to refetch. The payload is deliberately content-free:
 * the client refetches its unread count rather than trusting anything pushed
 * over the wire.
 */
export function pushToUser(userId: string) {
  const set = sseClients.get(String(userId));
  if (!set?.size) return;
  for (const push of set) {
    try {
      push("event: notification\ndata: 1\n\n");
    } catch {
      set.delete(push);
    }
  }
}
