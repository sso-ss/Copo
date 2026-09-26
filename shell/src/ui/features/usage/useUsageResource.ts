import { useEffect, useRef, useState } from "react";
import { createUsageResource, fetchUsageJson, type ResourceState } from "./resource";

export function useUsageResource<T>(url: string, active: boolean, intervalMs = 5000) {
  const [snapshot, setSnapshot] = useState<ResourceState<T> & { url: string }>({
    url,
    data: null,
    loading: true,
    error: null,
  });
  const last = useRef(snapshot);
  last.current = snapshot;
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!active) return;
    const resource = createUsageResource(
      (signal) => fetchUsageJson<T>(url, signal),
      (next) => setSnapshot({ ...next, url }),
      last.current.url === url ? last.current.data : null,
    );
    const poll = () => {
      if (document.visibilityState !== "hidden") void resource.refresh();
    };
    refresh.current = resource.refresh;
    poll();
    const timer = window.setInterval(poll, intervalMs);
    document.addEventListener("visibilitychange", poll);
    return () => {
      resource.dispose();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [url, active, intervalMs]);
  const state = snapshot.url === url ? snapshot : { data: null, loading: true, error: null };
  return { ...state, refresh: () => void refresh.current() };
}
