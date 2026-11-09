import { subscribeChanges } from "./change-hub.ts";
export function synchronization(
  scope: { workspace: string; account: string; user: string },
  signal: AbortSignal,
  validate: () => Promise<boolean>,
) {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false,
        pending: ReturnType<typeof setTimeout> | undefined;
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        if (closed) return;
        try {
          if ((controller.desiredSize ?? 0) < -8) {
            stop();
            return;
          }
          controller.enqueue(
            encoder.encode("data: " + JSON.stringify(data) + "\n\n"),
          );
        } catch {
          stop();
        }
      };
      const unsubscribe = subscribeChanges({
        ...scope,
        notify: (c) => {
          if (c.topic === "model_deltas") return;
          if (!pending)
            pending = setTimeout(() => {
              pending = undefined;
              send({ invalidate: true });
            }, 500);
        },
      });
      const stop = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        if (pending) clearTimeout(pending);
        signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {}
      };
      let validating = false;
      const heartbeat = setInterval(() => {
        if (validating) return;
        validating = true;
        void validate()
          .then((ok) => {
            if (ok) send({ heartbeat: true });
            else stop();
          })
          .catch(stop)
          .finally(() => {
            validating = false;
          });
      }, 30000);
      cleanup = stop;
      signal.addEventListener("abort", stop, { once: true });
      send({ invalidate: true });
      if (signal.aborted) stop();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
