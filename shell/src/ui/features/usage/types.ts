// Read-only wire fields displayed by Settings, matching /token-usage and /usage.
export type Period = "day" | "week" | "month";
export interface TokenTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  total_tokens: number;
  request_count: number;
  total_nano_aiu: number;
}
export interface UsageSummary {
  period: Period;
  range: { start_ms: number; end_ms: number };
  totals: TokenTotals;
  byModel: Array<TokenTotals & { model: string }>;
}
export interface UsageEvent {
  id: number;
  created_at_ms: number;
  created_at_utc: string;
  user_id: string | null;
  endpoint: string;
  model: string;
  session_id: string | null;
  trace_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  total_tokens: number;
}
export interface UsageEvents {
  items: UsageEvent[];
  page: number;
  total: number;
  total_pages: number;
}
export interface Quota {
  entitlement: number;
  remaining: number;
  percent_remaining: number;
  unlimited: boolean;
}
export interface CopilotUsage {
  login?: string;
  quota_reset_date?: string;
  quota_snapshots?: Record<string, Quota> | null;
}
