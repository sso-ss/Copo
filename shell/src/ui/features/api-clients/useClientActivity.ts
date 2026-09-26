import { useEffect, useState } from "react";

import { apiCall } from "../../../proxy/client";
import type { ClientActivity } from "../../../../../src/lib/http/client-activity";

/** Poll after each response so slow requests cannot overlap or overwrite newer data. */
export function useClientActivity(): Record<string, ClientActivity> | null {
  const [activity, setActivity] = useState<Record<string, ClientActivity> | null>(null);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (): Promise<void> => {
      if (!document.hidden) {
        const result = await apiCall({
          kind: "client-activity",
          method: "GET",
          path: "/settings/api/clients/activity",
        });
        if (disposed) return;
        setActivity(result.ok
          ? Object.fromEntries(result.data.activity.map((entry) => [entry.apiKeyId, entry]))
          : null);
      }
      if (!disposed) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  return activity;
}
