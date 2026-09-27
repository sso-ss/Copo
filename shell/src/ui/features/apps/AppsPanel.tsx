import { useEffect, useState } from "react";

import { AppCard } from "./AppCard";
import { useApps } from "./useApps";
import { Stack } from "../../components/Stack";
import { t } from "../../../i18n";

export function AppsPanel(): JSX.Element {
  const [, repaint] = useState(0);
  useEffect(() => {
    const onLocaleChange = () => repaint((revision) => revision + 1);
    window.addEventListener("maximal:locale-changed", onLocaleChange);
    return () => window.removeEventListener("maximal:locale-changed", onLocaleChange);
  }, []);
  const {
    apps,
    isLoading,
    error,
    toggleClaudeCode,
    toggleClaudeDesktop,
    toggleCodex,
  } = useApps();

  return (
    <Stack proximity="region" className="apps-panel" aria-busy={isLoading}>
      {error && (
        <p className="state__caption state__caption--error" role="alert">
          {error}
        </p>
      )}

      {isLoading && apps.length === 0 ? (
        <p className="state__caption">{t("apps-loading")}</p>
      ) : (
        <Stack proximity="section" className="apps-list">
          {apps.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              onConfigure={
                app.id === "claude-desktop"
                  ? (enabled) => toggleClaudeDesktop(enabled)
                  : app.id === "codex" || app.id === "codex-desktop"
                    ? (enabled, automaticReview) => toggleCodex(enabled, app.id === "codex-desktop", automaticReview)
                    : (enabled) => toggleClaudeCode(enabled)
              }
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
