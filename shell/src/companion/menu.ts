import { availableLocales, localeLabel } from "../i18n";

/** Compact menu pages stay inside the narrow companion window. */
export function createProfileMenu(changeLanguage: (tag: string) => Promise<void>) {
  const container = document.getElementById("account-menu")!;
  const avatar = document.getElementById("avatar")!;
  const popover = document.getElementById("profile-menu")!;
  const main = document.getElementById("profile-main")!;
  const languages = document.getElementById("language-options")!;
  let page = main;
  let trigger: HTMLButtonElement | null = null;

  const items = () => [...page.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => !button.hidden && !button.disabled);
  function focus(button?: HTMLButtonElement): void {
    for (const item of items()) item.tabIndex = item === button ? 0 : -1;
    button?.focus();
  }
  function back(restoreFocus = true): void {
    page.hidden = page !== main;
    main.hidden = false;
    page = main;
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus && trigger) focus(trigger);
    trigger = null;
  }
  function close(restoreFocus = false): void {
    popover.hidden = true;
    avatar.setAttribute("aria-expanded", "false");
    back(false);
    if (restoreFocus) avatar.focus();
  }
  function open(last = false): void {
    popover.hidden = false;
    avatar.setAttribute("aria-expanded", "true");
    const buttons = items();
    focus(last ? buttons[buttons.length - 1] : buttons[0]);
  }
  function submenu(button: HTMLButtonElement): void {
    const target = document.getElementById(button.dataset.submenu ?? "");
    if (!target) return;
    main.hidden = true;
    target.hidden = false;
    page = target;
    trigger = button;
    button.setAttribute("aria-expanded", "true");
    focus(page.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? items()[0]);
  }
  function syncLocale(tag: string): void {
    for (const button of languages.querySelectorAll<HTMLButtonElement>("button")) {
      button.setAttribute("aria-checked", String(button.dataset.locale === tag));
    }
  }

  for (const tag of availableLocales()) {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.dataset.locale = tag;
    button.lang = tag;
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", "false");
    button.textContent = localeLabel(tag);
    button.addEventListener("click", () => { close(true); void changeLanguage(tag); });
    languages.append(button);
  }
  for (const button of popover.querySelectorAll<HTMLButtonElement>("button")) button.tabIndex = -1;
  avatar.addEventListener("click", () => { if (popover.hidden) open(); else close(); });
  avatar.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation(); open(event.key === "ArrowUp");
    }
  });
  popover.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
    if (!button) return;
    if (button.dataset.submenu) submenu(button);
    else if (button.hasAttribute("data-menu-back")) back();
    else if (button.dataset.action || button.dataset.section) close(true);
  });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !container.contains(event.target)) close();
  });
  document.addEventListener("focusin", (event) => {
    if (!popover.hidden && event.target instanceof Node && !container.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (popover.hidden) return;
    const buttons = items();
    const current = document.activeElement as HTMLButtonElement;
    const index = buttons.indexOf(current);
    if (event.key === "Escape") { event.preventDefault(); if (page === main) close(true); else back(); }
    else if (event.key === "Tab") close();
    else if (event.key === "ArrowLeft" && page !== main) { event.preventDefault(); back(); }
    else if (event.key === "ArrowRight" && current?.dataset.submenu) { event.preventDefault(); submenu(current); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focus(buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); focus(buttons[event.key === "Home" ? 0 : buttons.length - 1]);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && event.key !== " ") {
      const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
      const match = ordered.find((button) => button.textContent?.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (match) { event.preventDefault(); focus(match); }
    }
  });
  return { close, syncLocale };
}
