import { t } from "../i18n";

/** Only fixed error codes cross the companion IPC boundary; never raw replies. */
export function connectionErrorMessage(code: unknown): string | null {
  switch (code) {
    case "claude-code-foreign-base-url": return t("connection-error-base-url");
    case "claude-code-foreign-api-key-helper": return t("connection-error-helper");
    case "claude-code-missing-api-key": return t("connection-error-api-key");
    case "claude-code-not-installed": return t("connection-error-install");
    case "gateway-unavailable": return t("connection-error-gateway");
    default: return null;
  }
}
