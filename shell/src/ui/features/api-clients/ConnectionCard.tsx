import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "../../../i18n";
import type { ClientActivity } from "../../../../../src/lib/http/client-activity-types";
import { Checkbox } from "../../components/Checkbox";
import type { ApiKeyEntry } from "../../../../../src/lib/config/settings-types";
import type { MutationResult } from "./useApiKeys";

interface ConnectionCardProps {
  entry: ApiKeyEntry;
  activity?: ClientActivity;
  activityAvailable: boolean;
  update: (
    id: string,
    patch: { label?: string; key?: string; enabled?: boolean },
  ) => Promise<MutationResult>;
  onDelete: () => void;
}

const MASK_CAP = 24;
const COPIED_FLASH_MS = 1200;

function mask(value: string): string {
  return "•".repeat(Math.min(value.length, MASK_CAP));
}

export function ConnectionCard({
  entry,
  activity,
  activityAvailable,
  update,
  onDelete,
}: ConnectionCardProps): JSX.Element {
  const status = activityAvailable ? activity?.status ?? "none" : "unavailable";
  const lastFinishedAt = activityAvailable ? activity?.lastFinishedAt : null;
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(entry.label);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingName) setNameDraft(entry.label);
  }, [entry.label, editingName]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  const commitName = useCallback((): void => {
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === entry.label) {
      setNameDraft(entry.label);
      return;
    }
    void update(entry.id, { label: next });
  }, [nameDraft, entry.id, entry.label, update]);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(entry.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    } catch {
      // Clipboard unavailable (insecure context). Silent.
    }
  };

  return (
    <article className="connection-card" data-key-id={entry.id}>
      <header className="connection-card__head">
        <span
          className={`connection-card__dot is-${status}`}
          aria-hidden
        />
        {editingName ? (
          <input
            ref={nameInputRef}
            type="text"
            className="connection-card__name-input"
            value={nameDraft}
            maxLength={64}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitName();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setNameDraft(entry.label);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="connection-card__name"
            onClick={() => setEditingName(true)}
            title="Click to rename"
          >
            {entry.label || <span className="muted">Untitled</span>}
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--sm connection-card__delete"
          onClick={onDelete}
          aria-label={`Remove ${entry.label}`}
          title="Remove this connection"
        >
          ✕
        </button>
      </header>

      <div className="connection-card__activity" role="status">
        <span className={`connection-card__status is-${status}`} data-i18n={`activity-${status}`}>
          {t(`activity-${status}`)}
        </span>
        {status === "working" && <span>{t("activity-active", { n: activity?.activeRequests ?? 0 })}</span>}
        {status !== "working" && lastFinishedAt && (
          <time dateTime={new Date(lastFinishedAt).toISOString()}>
            {t("activity-last", { time: new Date(lastFinishedAt).toLocaleTimeString() })}
          </time>
        )}
      </div>
      <div className="connection-card__body">
        <div className="connection-card__field">
          <label className="connection-card__field-label">Connection key</label>
          <div className="connection-card__key">
            <span
              className={
                "connection-card__key-text mono"
                + (copied ? " is-copied" : "")
              }
            >
              {copied ? "Copied" : showKey ? entry.key : mask(entry.key)}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => void onCopy()}
            >
              Copy
            </button>
          </div>
        </div>

        <label className="connection-card__enabled">
          <Checkbox
            checked={entry.enabled}
            onCheckedChange={(next) =>
              void update(entry.id, { enabled: next })
            }
            aria-label={`Enable ${entry.label}`}
          />
          <span>{entry.enabled ? "On" : "Off"}</span>
        </label>
      </div>
    </article>
  );
}
