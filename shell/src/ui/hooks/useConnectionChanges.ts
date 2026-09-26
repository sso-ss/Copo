import { useEffect } from "react";
import { subscribeAuthEvents, type EventSubscription } from "../../proxy/client";

/** Push updates from either window, plus reconciliation for external file edits. */
export function useConnectionChanges(refresh: () => Promise<void>): void {
  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    let queued = false;
    let subscription: EventSubscription | undefined;
    const update = () => {
      if (disposed || document.hidden) return;
      if (refreshing) { queued = true; return; }
      refreshing = true;
      void refresh().finally(() => {
        refreshing = false;
        if (queued) { queued = false; update(); }
      });
    };
    void subscribeAuthEvents({ onConnections: update, onAuth: update, onOpen: update }).then((value) => {
      if (disposed) value.close(); else subscription = value;
    }).catch(() => { /* The timer also covers a missing event stream. */ });
    const timer = setInterval(update, 5000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      disposed = true;
      subscription?.close();
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
}
