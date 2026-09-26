import { describe, expect, test } from "bun:test"

import {
  createUsageResource,
  type ResourceState,
} from "../shell/src/ui/features/usage/resource"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe("Usage refresh lifecycle", () => {
  test("switching periods discards a late result even if the transport ignores abort", async () => {
    const old = deferred<number>()
    const current = deferred<number>()
    const values: Array<ResourceState<number>> = []
    let signal: AbortSignal | undefined
    const oldResource = createUsageResource(
      (next) => {
        signal = next
        return old.promise
      },
      (state) => values.push(state),
    )
    const oldRequest = oldResource.refresh()
    oldResource.dispose()
    expect(signal?.aborted).toBe(true)
    const nextResource = createUsageResource(
      () => current.promise,
      (state) => values.push(state),
    )
    const nextRequest = nextResource.refresh()
    current.resolve(30)
    await nextRequest
    old.resolve(7)
    await oldRequest
    expect(values.at(-1)).toEqual({ data: 30, loading: false, error: null })
    expect(values.some((state) => state.data === 7)).toBe(false)
    nextResource.dispose()
  })

  test("failed refresh preserves the last totals, then retry replaces them", async () => {
    let calls = 0
    const values: Array<ResourceState<number>> = []
    const resource = createUsageResource(
      () => {
        calls++
        if (calls === 2) return Promise.reject(new Error("offline"))
        return Promise.resolve(calls * 100)
      },
      (state) => values.push(state),
    )
    await resource.refresh()
    await resource.refresh()
    expect(values.at(-1)).toEqual({
      data: 100,
      loading: false,
      error: "offline",
    })
    await resource.refresh()
    expect(values.at(-1)).toEqual({ data: 300, loading: false, error: null })
    resource.dispose()
  })

  test("failed first load is unavailable, not a zero-usage report", async () => {
    const values: Array<ResourceState<number>> = []
    const resource = createUsageResource<number>(
      () => Promise.reject(new Error("unavailable")),
      (state) => values.push(state),
    )
    await resource.refresh()
    expect(values.at(-1)).toEqual({
      data: null,
      loading: false,
      error: "unavailable",
    })
    resource.dispose()
  })

  test("poll ticks do not overlap and leaving the tab prevents further updates", async () => {
    const pending = deferred<number>()
    let calls = 0
    const values: Array<ResourceState<number>> = []
    const resource = createUsageResource(
      () => {
        calls++
        return pending.promise
      },
      (state) => values.push(state),
    )
    const first = resource.refresh()
    await resource.refresh()
    expect(calls).toBe(1)
    resource.dispose()
    pending.reject(new Error("request cancelled"))
    await first
    expect(values).toHaveLength(1)
    await resource.refresh()
    expect(calls).toBe(1)
  })
})
