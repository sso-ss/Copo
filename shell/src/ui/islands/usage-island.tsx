import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Usage } from "../features/usage/Usage";

export function mountUsage(): void {
  const el = document.getElementById("usage-root");
  if (!el) return;
  createRoot(el).render(
    <StrictMode>
      <Usage />
    </StrictMode>,
  );
}
