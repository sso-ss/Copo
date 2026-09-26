export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** A disposed period/page can never replace the currently selected data. */
export function createUsageResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  onChange: (state: ResourceState<T>) => void,
  initialData: T | null = null,
): { refresh: () => Promise<void>; dispose: () => void } {
  let state: ResourceState<T> = { data: initialData, loading: false, error: null };
  let disposed = false;
  let controller: AbortController | null = null;
  return {
    async refresh() {
      if (disposed || state.loading) return;
      controller = new AbortController();
      state = { ...state, loading: true };
      onChange(state);
      try {
        const data = await load(controller.signal);
        if (disposed) return;
        state = { data, loading: false, error: null };
      } catch (error) {
        if (disposed) return;
        state = {
          ...state,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      onChange(state);
    },
    dispose() {
      disposed = true;
      controller?.abort();
    },
  };
}

export async function fetchUsageJson<T>(url: string, signal: AbortSignal): Promise<T> {
  // These same-origin, read-only endpoints accept local dashboard requests.
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: { message?: string }; message?: string };
      message = body.error?.message || body.message || message;
    } catch {
      /* Status still identifies a non-JSON failure. */
    }
    throw new Error(`${response.status}: ${message}`);
  }
  return response.json() as Promise<T>;
}
