import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { claudeCodeInstallHint } from "../../../../../src/lib/config/app-install-hints";
import { t } from "../../../i18n";
import type { AppEntry } from "../../../proxy/client";
import { openUrl } from "../../../tauri/shell";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { cx } from "../../components/cx";
import { isWindows } from "../../platform";

import type { MutationResult } from "./useApps";

const COPIED_FLASH_MS = 1400;
const CLAUDE_DOWNLOAD_URL = "https://claude.ai/download";

interface AppCardProps {
  app: AppEntry;
  onConfigure: (enabled: boolean, automaticReview?: boolean) => Promise<MutationResult>;
}

export function AppCard({ app, onConfigure }: AppCardProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [restartWarnOpen, setRestartWarnOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const isCodex = app.id === "codex" || app.id === "codex-desktop";
  const automaticReview = app.enabled && app.routing?.automatic_review === true;
  const needsWindowsRestartWarning = app.id === "claude-code" && isWindows();
  const comingSoon = app.kind === "coming-soon";
  const notInstalled = app.status === "not-installed";
  const install = app.id === "claude-code"
    ? claudeCodeInstallHint(isWindows()) : app.install;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyInstall = async (): Promise<void> => {
    if (!install) return;
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(install.command);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  };

  const changeConfiguration = async (enabled: boolean, review?: boolean): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      // Every configure request detects the app again on the gateway. A
      // stale card cannot configure an uninstalled app, or block a new install.
      const result = await onConfigure(enabled, review);
      if (result.ok) {
        setInstallOpen(false);
        setRestartWarnOpen(false);
        setReviewOpen(false);
      } else if (result.notInstalled) {
        setInstallOpen(true);
      } else {
        setError(result.error ?? t("apps-configuration-error"));
      }
    } catch {
      setError(t("apps-configuration-error"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const disconnect = (): void => {
    setError(null);
    if (needsWindowsRestartWarning) setRestartWarnOpen(true);
    else void changeConfiguration(false);
  };

  const errorMessage = error && (
    <p className="state__caption state__caption--error" role="alert">{error}</p>
  );

  return (
    <article
      className={cx("app-card", comingSoon && "app-card--soon")}
      data-app-id={app.id}
      aria-busy={busy}
    >
      <header className="app-card__head">
        <h3 className="app-card__name">{app.name}</h3>
        <div className="app-card__control">
          {comingSoon ? (
            <span className="chip app-card__pill">{t("apps-coming-soon")}</span>
          ) : (
            <Button
              variant={app.enabled ? "secondary" : "primary"}
              size="sm"
              disabled={busy}
              onClick={() => app.enabled ? disconnect() : void changeConfiguration(true)}
              aria-label={t(app.enabled ? "apps-disconnect-name" : "apps-configure-name", { name: app.name })}
            >
              {busy ? t(app.enabled ? "apps-disconnecting" : "apps-configuring")
                : t(app.enabled ? "apps-disconnect" : "apps-configure")}
            </Button>
          )}
        </div>
      </header>

      {!comingSoon && (
        <p className="app-card__hint" role="status">
          {t(app.enabled
            ? notInstalled ? "apps-configured-missing" : "apps-configured"
            : "apps-not-configured")}
        </p>
      )}

      {isCodex && (
        <div className="app-card__install">
          <p className="app-card__hint">{t(automaticReview ? "apps-codex-review-configured" : "apps-codex-approval-help")}</p>
          {!notInstalled && (
            <Button variant="secondary" size="sm" disabled={busy}
              onClick={() => { setError(null); setReviewOpen(true); }}>
              {t(automaticReview ? "apps-codex-review-remove" : "apps-codex-review-setup")}
            </Button>
          )}
        </div>
      )}

      {(app.id === "codex" || app.id === "codex-desktop") && app.routing &&
        (app.routing.notice || (app.routing.managed && !app.enabled)) && (
          <div className="app-card__install">
            {app.routing.notice && <p className="app-card__hint">
              {app.routing.uses_existing_setup ? t("apps-codex-existing") : app.routing.notice}
            </p>}
            {app.routing.managed && !app.enabled && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={disconnect}>
                {t("apps-remove-settings")}
              </Button>
            )}
          </div>
        )}
      {!installOpen && !restartWarnOpen && !reviewOpen && errorMessage}

      {app.conflict && (
        <div className="app-card__conflict" role="status">
          <span className="app-card__conflict-text">
            <span className="app-card__conflict-title">{t("apps-conflict-title")}</span>
            <span className="app-card__conflict-detail">
              {t("apps-conflict-detail", {
                name: app.name,
                setting: app.conflict === "foreign-base-url" ? "ANTHROPIC_BASE_URL" : "apiKeyHelper",
              })}
            </span>
          </span>
        </div>
      )}

      {isCodex && <ConfirmDialog
        open={reviewOpen}
        title={t(automaticReview ? "apps-codex-review-remove" : "apps-codex-review-setup")}
        body={<>
          <p>{t(automaticReview ? "apps-codex-review-remove-help" : "apps-codex-review-consent")}</p>
          {!automaticReview && <p>{t("apps-codex-review-credentials")}</p>}
          <p>{t("apps-codex-review-restart")}</p>
          {errorMessage}
        </>}
        confirmLabel={t(automaticReview ? "apps-codex-review-remove" : "apps-codex-review-setup")}
        cancelLabel={t("apps-close")}
        busyLabel={t("apps-configuring")}
        busy={busy}
        onConfirm={() => changeConfiguration(true, !automaticReview)}
        onCancel={() => { setReviewOpen(false); setError(null); }}
      />}

      <ConfirmDialog
        open={installOpen}
        title={t("apps-install-title", { name: app.name })}
        body={
          <div className="app-card__install">
            <p>{t("apps-install-missing", { name: app.name })}</p>
            {install ? (
              <>
                <p>{t("apps-install-command-help", { name: app.name })}</p>
                <div className="app-card__cmd">
                  <code className="app-card__cmd-text mono">{install.command}</code>
                  <div className="app-card__cmd-actions">
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => void copyInstall()}>
                      {t(copied ? "apps-copied" : "apps-copy-command")}
                    </Button>
                  </div>
                </div>
                {copyFailed && <p role="status">{t("apps-copy-manually")}</p>}
              </>
            ) : app.id === "claude-desktop" ? (
              <>
                <p>{t("apps-install-desktop-help")}</p>
                <a
                  className="btn btn--secondary"
                  href={CLAUDE_DOWNLOAD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    if (!isTauri()) return;
                    event.preventDefault();
                    void openUrl(CLAUDE_DOWNLOAD_URL).catch(() => {
                      setError(t("apps-open-download-error", { url: CLAUDE_DOWNLOAD_URL }));
                    });
                  }}
                >
                  {t("apps-download-desktop")}
                </a>
              </>
            ) : <p>{t("apps-install-generic", { name: app.name })}</p>}
            <p>{t("apps-check-again-help")}</p>
            {errorMessage}
          </div>
        }
        confirmLabel={t("apps-check-again")}
        cancelLabel={t("apps-close")}
        busyLabel={t("apps-configuring")}
        busy={busy}
        onConfirm={() => changeConfiguration(true)}
        onCancel={() => { setInstallOpen(false); setError(null); }}
      />

      {needsWindowsRestartWarning && (
        <ConfirmDialog
          open={restartWarnOpen}
          title={t("apps-restart-title")}
          body={
            <>
              <p>{t("apps-restart-help")}</p>
              <p>{t("apps-restart-command", { command: "/exit" })}</p>
              {errorMessage}
            </>
          }
          confirmLabel={t("apps-disconnect")}
          cancelLabel={t("apps-keep-configured")}
          busyLabel={t("apps-disconnecting")}
          busy={busy}
          onConfirm={() => changeConfiguration(false)}
          onCancel={() => { setRestartWarnOpen(false); setError(null); }}
        />
      )}
    </article>
  );
}
