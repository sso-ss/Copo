import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t } from "../i18n";
import { startMotionPreview } from "./motion-preview";

interface Preferences {
  buddyCharacter: "cat" | "puff";
  buddySize: "small" | "medium" | "large";
  appearance: "system" | "light" | "dark";
}

/** Native preferences are shared across asset- and gateway-origin windows. */
export async function startPersonalization(): Promise<void> {
  startMotionPreview();
  let preferences: Preferences = { buddySize: "medium", appearance: "system", buddyCharacter: "cat" };
  const system = matchMedia("(prefers-color-scheme: dark)");
  const controls = [...document.querySelectorAll<HTMLInputElement>("input[data-preference]")];
  const error = document.getElementById("personalization-error");
  const preview = document.querySelector<HTMLElement>(".personalization-preview");
  let saving = false;
  function render(): void {
    const dark = preferences.appearance === "dark" || (preferences.appearance === "system" && system.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    if (preview) preview.dataset.buddySize = preferences.buddySize;
    const character = preferences.buddyCharacter ?? "cat";
    const still = preview?.querySelector<HTMLImageElement>("img");
    if (still) {
      const source = `./motion-artwork/${character === "puff" ? "puff/idle-still.png" : "cat-idle.png"}`;
      if (still.getAttribute("src") !== source) still.src = source;
    }
    if (document.documentElement.dataset.buddyCharacter !== character) {
      document.documentElement.dataset.buddyCharacter = character;
      window.dispatchEvent(new Event("companion-character-changed"));
    }
    for (const control of controls) {
      control.checked = control.value === (control.dataset.preference === "buddyCharacter" ? character : preferences[control.dataset.preference as keyof Preferences]);
    }
  }
  render();
  system.addEventListener("change", render);
  try {
    await listen<Preferences>("companion:preferences", ({ payload }) => { preferences = payload; render(); });
    preferences = await invoke<Preferences>("companion_preferences");
    render();
    for (const control of controls) {
      control.disabled = false;
      control.addEventListener("change", () => {
        if (!control.checked || saving) return;
        saving = true;
        if (error) error.hidden = true;
        for (const input of controls) input.disabled = true;
        void invoke<Preferences>("set_companion_preferences", { [control.dataset.preference!]: control.value })
          .then((next) => { preferences = next; })
          .catch(() => {
            if (error) { error.textContent = t("personalization-save-error"); error.hidden = false; }
          })
          .finally(() => {
            saving = false; render();
            for (const input of controls) input.disabled = false;
            if (document.activeElement === document.body && document.hasFocus()) control.focus();
          });
      });
    }
  } catch {
    if (error) { error.textContent = t("personalization-desktop-only"); error.hidden = false; }
  }
}
