import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireSession } from "@/lib/requireSession";
import { registerClient } from "@/lib/sseClients";

// An SSE connection is held open for as long as the tab is; it must never be
// cached, buffered, or handed to a static optimiser.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The live channel. One long-lived response per open tab; `pushToUser` writes a
 * single content-free line into it and the client refetches.
 *
 * Nothing about the notification travels over this stream — only "something
 * changed". That keeps the authorisation question in exactly one place (the
 * GET, which filters by `userId`) instead of two.
 */
export async function GET(req: NextRequest) {
  await connectDB();
  const check = await requireSession();
  if (check.error) return check.error;
  const { userDoc } = check;

  const userId = String(userDoc._id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      send(": connected\n\n");
      const unregister = registerClient(userId, send);

      /**
       * A 25s comment heartbeat. Proxies and browsers drop an idle connection
       * after roughly a minute, and a dead stream looks identical to a quiet
       * one — the bell would simply stop updating with nothing in any log.
       */
      const beat = setInterval(() => send(": ping\n\n"), 25_000);

      const shutdown = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        unregister();
        try { controller.close(); } catch { /* already closed */ }
      };

      req.signal.addEventListener("abort", shutdown);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx buffers proxied responses by default, which would hold every
      // event until the buffer filled — i.e. never, for one-line pushes.
      "X-Accel-Buffering": "no",
    },
  });
}
