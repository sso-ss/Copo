import { useEffect, useState, type ReactNode } from "react";
import { resolveLocale, t } from "../../../i18n";
import { Button } from "../../components/Button";
import { useUsageResource } from "./useUsageResource";
import type { CopilotUsage, Period, Quota, TokenTotals, UsageEvents, UsageSummary } from "./types";

const PERIODS: Period[] = ["day", "week", "month"];
const TOKEN_COLUMNS: Array<
  [
    keyof Pick<
      TokenTotals,
      | "input_tokens"
      | "output_tokens"
      | "cache_read_input_tokens"
      | "cache_creation_input_tokens"
      | "total_tokens"
    >,
    string,
  ]
> = [
  ["input_tokens", "dashboard-col-input"],
  ["output_tokens", "dashboard-col-output"],
  ["cache_read_input_tokens", "dashboard-col-cache-read"],
  ["cache_creation_input_tokens", "dashboard-col-cache-write"],
  ["total_tokens", "dashboard-col-total"],
];

function number(value: number): string {
  return new Intl.NumberFormat(resolveLocale()).format(value);
}
function cost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return `${new Intl.NumberFormat(resolveLocale(), { maximumFractionDigits: 4 }).format(value / 1e9)} AIU`;
}
function date(value: number | string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString(resolveLocale());
}
function resetDate(value: string): string {
  // A provider date without a time must not shift to the previous local day.
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`).toLocaleDateString(resolveLocale())
    : date(value);
}
function initialPeriod(): Period {
  const period = new URLSearchParams(window.location.search).get("period");
  return PERIODS.includes(period as Period) ? (period as Period) : "month";
}
function ErrorNotice({
  error,
  label,
  retry,
}: {
  error: string | null;
  label: string;
  retry: () => void;
}) {
  if (!error) return null;
  return (
    <div className="usage-error" role="alert">
      <p>
        <strong>{t(label)}</strong>
        <br />
        {error}
      </p>
      <Button size="sm" onClick={retry}>
        {t("common-retry")}
      </Button>
    </div>
  );
}
function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="usage-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="table usage-table">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}
function QuotaRow({ name, quota }: { name: string; quota: Quota }) {
  const usedPercent = Math.max(0, 100 - quota.percent_remaining);
  return (
    <div className="card usage-quota">
      <div className="usage-heading-row">
        <h4>{name.replace(/_/g, " ")}</h4>
        <span>
          {quota.unlimited
            ? t("dashboard-quota-unlimited")
            : t("dashboard-quota-percent-used", {
                percent: number(Math.round(usedPercent * 10) / 10),
              })}
        </span>
      </div>
      {!quota.unlimited && (
        <progress
          className="usage-progress"
          max={100}
          value={Math.min(100, usedPercent)}
          data-level={usedPercent > 90 ? "error" : usedPercent > 75 ? "warning" : "normal"}
          aria-label={name.replace(/_/g, " ")}
        />
      )}
      <div className="usage-heading-row state__caption">
        <span>
          {quota.unlimited
            ? "— / ∞"
            : `${number(Math.max(0, quota.entitlement - quota.remaining))} / ${number(quota.entitlement)}`}
        </span>
        <span>
          {t("dashboard-quota-remaining", { n: quota.unlimited ? "∞" : number(quota.remaining) })}
        </span>
      </div>
    </div>
  );
}

export function Usage(): JSX.Element {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(window.location.hash === "#usage");
  const [, setLocale] = useState(resolveLocale);
  useEffect(() => {
    const sync = () => setActive(window.location.hash === "#usage");
    const locale = () => setLocale(resolveLocale());
    window.addEventListener("hashchange", sync);
    window.addEventListener("maximal:locale-changed", locale);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("maximal:locale-changed", locale);
    };
  }, []);
  const summary = useUsageResource<UsageSummary>(`/token-usage?period=${period}`, active);
  const events = useUsageResource<UsageEvents>(
    `/token-usage/events?period=${period}&page=${page}&page_size=20`,
    active,
  );
  const account = useUsageResource<CopilotUsage>("/usage", active, 60_000);
  const totals = summary.data?.totals;
  const rows = summary.data?.byModel;
  const records = events.data;
  const quotas = Object.entries(account.data?.quota_snapshots ?? {});
  function selectPeriod(next: Period) {
    setPage(1);
    setPeriod(next);
    const url = new URL(window.location.href);
    url.searchParams.set("period", next);
    window.history.replaceState(null, "", url);
  }
  return (
    <div className="usage-view">
      <div className="usage-toolbar">
        <label className="usage-period">
          {t("dashboard-period-label")}
          <select
            className="input"
            value={period}
            onChange={(event) => selectPeriod(event.target.value as Period)}
          >
            {PERIODS.map((key) => (
              <option key={key} value={key}>
                {t(`usage-period-${key}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="state__caption">{t("usage-recorded-scope")}</p>
      </div>
      <section
        className="subsection"
        aria-labelledby="usage-summary-title"
        aria-busy={summary.loading}
      >
        <div className="usage-heading-row">
          <h3 className="subsection__title" id="usage-summary-title">
            {t("dashboard-token-usage-title")}
          </h3>
        </div>
        <p className="state__caption">
          {summary.data
            ? `${date(summary.data.range.start_ms)} – ${date(summary.data.range.end_ms - 1)}`
            : "—"}
        </p>
        <ErrorNotice
          error={summary.error}
          label="dashboard-error-summary"
          retry={summary.refresh}
        />
        <dl className="usage-primary-metrics">
          <div>
            <dt>{t("usage-total-tokens")}</dt>
            <dd>{totals ? number(totals.total_tokens) : "—"}</dd>
          </div>
          <div>
            <dt>{t("dashboard-col-requests")}</dt>
            <dd>{totals ? number(totals.request_count) : "—"}</dd>
          </div>
          <div>
            <dt>{t("dashboard-col-cost")}</dt>
            <dd>{totals ? cost(totals.total_nano_aiu) : "—"}</dd>
          </div>
        </dl>
        <dl className="usage-token-breakdown">
          {TOKEN_COLUMNS.filter(([field]) => field !== "total_tokens").map(([field, label]) => (
            <div key={field}>
              <dt>{t(label)}</dt>
              <dd>{totals ? number(totals[field]) : "—"}</dd>
            </div>
          ))}
        </dl>
        {summary.loading && !totals && (
          <p className="state__caption" role="status">
            {t("dashboard-refreshing-summary")}
          </p>
        )}
        {totals?.request_count === 0 && (
          <p className="state__caption">{t("dashboard-empty-summary")}</p>
        )}
      </section>

      <section
        className="subsection"
        aria-labelledby="usage-allowances-title"
        aria-busy={account.loading}
      >
        <h3 className="subsection__title" id="usage-allowances-title">
          {t("dashboard-quotas-title")}
        </h3>
        <p className="state__caption">{t("usage-allowances-scope")}</p>
        {account.data?.login && <p className="state__caption">{account.data.login}</p>}
        {account.data?.quota_reset_date && (
          <p className="state__caption">
            {t("usage-reset", { date: resetDate(account.data.quota_reset_date) })}
          </p>
        )}
        <ErrorNotice error={account.error} label="dashboard-error-usage" retry={account.refresh} />
        <div className="usage-quotas">
          {quotas.map(([name, quota]) => (
            <QuotaRow key={name} name={name} quota={quota} />
          ))}
        </div>
        {account.loading && !account.data && (
          <p className="state__caption" role="status">
            {t("dashboard-refreshing-summary")}
          </p>
        )}
        {account.data && quotas.length === 0 && (
          <p className="state__caption">{t("dashboard-not-available")}</p>
        )}
      </section>

      <section
        className="subsection"
        aria-labelledby="usage-models-title"
        aria-busy={summary.loading}
      >
        <div className="usage-heading-row">
          <h3 className="subsection__title" id="usage-models-title">
            {t("dashboard-by-model-title")}
          </h3>
          <span className="state__caption">
            {rows ? t("dashboard-by-model-count", { n: rows.length }) : "—"}
          </span>
        </div>
        {rows && rows.length > 0 ? (
          <ScrollTable label={t("dashboard-by-model-title")}>
            <thead>
              <tr>
                <th scope="col">{t("dashboard-col-model")}</th>
                <th scope="col" className="usage-number">
                  {t("dashboard-col-requests")}
                </th>
                {TOKEN_COLUMNS.map(([field, label]) => (
                  <th scope="col" className="usage-number" key={field}>
                    {t(label)}
                  </th>
                ))}
                <th scope="col" className="usage-number">
                  {t("dashboard-col-cost")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.model}>
                  <th scope="row">{row.model}</th>
                  <td className="usage-number">{number(row.request_count)}</td>
                  {TOKEN_COLUMNS.map(([field]) => (
                    <td className="usage-number" key={field}>
                      {number(row[field])}
                    </td>
                  ))}
                  <td className="usage-number">{cost(row.total_nano_aiu)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        ) : (
          <p className="state__caption">
            {t(rows ? "dashboard-empty-summary" : "dashboard-by-model-none")}
          </p>
        )}
      </section>

      <section
        className="subsection"
        aria-labelledby="usage-events-title"
        aria-busy={events.loading}
      >
        <h3 className="subsection__title" id="usage-events-title">
          {t("dashboard-event-details-title")}
        </h3>
        <div className="usage-heading-row">
          <span className="state__caption" aria-live="polite">
            {records
              ? t("dashboard-events-meta", {
                  page: records.page,
                  total: Math.max(1, records.total_pages),
                  events: records.total,
                })
              : t("dashboard-events-none")}
          </span>
          <div className="actions">
            <Button
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={events.loading || !records || page <= 1}
            >
              {t("dashboard-pager-previous")}
            </Button>
            <Button
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={events.loading || !records || page >= records.total_pages}
            >
              {t("dashboard-pager-next")}
            </Button>
          </div>
        </div>
        <ErrorNotice error={events.error} label="dashboard-error-details" retry={events.refresh} />
        {records && records.items.length > 0 ? (
          <ScrollTable label={t("dashboard-event-details-title")}>
            <thead>
              <tr>
                {["time", "user", "endpoint", "model", "session", "trace"].map((key) => (
                  <th scope="col" key={key}>
                    {t(`dashboard-col-${key}`)}
                  </th>
                ))}
                {TOKEN_COLUMNS.map(([field, label]) => (
                  <th scope="col" className="usage-number" key={field}>
                    {t(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.items.map((record) => (
                <tr key={record.id}>
                  <td title={record.created_at_utc}>{date(record.created_at_ms)}</td>
                  <td>{record.user_id || "—"}</td>
                  <td>{record.endpoint.replace(/_/g, " ")}</td>
                  <td>{record.model}</td>
                  <td>{record.session_id || "—"}</td>
                  <td>{record.trace_id || "—"}</td>
                  {TOKEN_COLUMNS.map(([field]) => (
                    <td className="usage-number" key={field}>
                      {number(record[field])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        ) : (
          records && <p className="state__caption">{t("dashboard-empty-events")}</p>
        )}
        {events.loading && !records && (
          <p className="state__caption" role="status">
            {t("dashboard-refreshing-details")}
          </p>
        )}
      </section>

      <details className="advanced-section">
        <summary className="advanced-section__summary">
          <span className="advanced-section__title">{t("dashboard-api-response-title")}</span>
        </summary>
        <div className="advanced-section__body">
          <pre className="usage-raw">
            {account.data ? JSON.stringify(account.data, null, 2) : t("dashboard-not-available")}
          </pre>
        </div>
      </details>
    </div>
  );
}
