/** Read-only synthetic usage endpoints shared by Settings and Dashboard. */
import type { TokenUsageSummary, TokenUsageEventsPage, TokenUsagePeriod } from "../src/lib/token-usage/store"
import type { getCopilotUsage } from "../src/services/github/get-copilot-usage"

export function usageFixture(url: URL, scenario: string): object | null {
  const empty = scenario === "signed-out" || scenario === "auth-error"
  const period: TokenUsagePeriod = url.searchParams.get("period") === "month" ? "month"
    : url.searchParams.get("period") === "week" ? "week" : "day"
  const range = { start_ms: 1_750_000_000_000, end_ms: 1_750_086_400_000,
    start_utc: "2025-06-15T15:06:40.000Z", end_utc: "2025-06-16T15:06:40.000Z" }
  const totals = { input_tokens: empty ? 0 : 1200, output_tokens: empty ? 0 : 300,
    cache_read_input_tokens: 0, cache_creation_input_tokens: 0, total_tokens: empty ? 0 : 1500,
    request_count: empty ? 0 : 3, total_nano_aiu: 0 }
  if (url.pathname === "/token-usage") {
    return { period, range, totals, byModel: empty ? [] : [{ ...totals, model: "qa-fixture-model", is_premium: false }] } satisfies TokenUsageSummary
  }
  if (url.pathname === "/token-usage/events") {
    return { period, range, items: [], page: 1, page_size: 20, total: 0, total_pages: 0 } satisfies TokenUsageEventsPage
  }
  if (url.pathname === "/usage") {
    const quota = { entitlement: 300, remaining: empty ? 300 : 240, percent_remaining: empty ? 100 : 80,
      unlimited: false, overage_count: 0, overage_permitted: false, quota_id: "qa-fixture", quota_remaining: empty ? 300 : 240 }
    return { login: empty ? "" : "octocat", access_type_sku: "qa-fixture", analytics_tracking_id: "qa-fixture",
      assigned_date: range.start_utc, can_signup_for_limited: false, chat_enabled: !empty,
      organization_login_list: [], organization_list: [], quota_reset_date: "2025-07-01",
      quota_snapshots: { chat: quota, completions: quota, premium_interactions: quota },
      endpoints: { api: "http://127.0.0.1", telemetry: "http://127.0.0.1" } } satisfies Awaited<ReturnType<typeof getCopilotUsage>>
  }
  return null
}
