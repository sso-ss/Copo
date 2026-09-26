import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CompanionConnection, CompanionData } from "../../../src/lib/config/companion-types";
import type { ClientActivitySnapshot, ClientRequestEvent } from "../../../src/lib/http/client-activity-types";
import { applyI18n } from "../i18n/apply";
import { setLocale, t } from "../i18n";
import { createProfileMenu } from "./menu";
import { startPersonalization } from "../ui/personalization";
import { connectionErrorMessage } from "../ui/connection-errors";
import { createRenderer } from "./renderer";
import { CompanionState } from "./state";

const element = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing companion element: ${id}`);
  return node as T;
};
const isPanel = new URLSearchParams(location.search).has("panel");
const state = new CompanionState();
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const cat = element<HTMLButtonElement>("cat");
let hovered = false;
let hintSeen = false;
try { hintSeen = localStorage.getItem("companion.hint-seen") === "true"; } catch { /* optional preference */ }
let refreshPending = false;
let streamSeen = Date.now();
let busy = false;
let toggling = false;
let signingOut = false;
let renderArt: Awaited<ReturnType<typeof createRenderer>> | null = null;
const profileMenu = createProfileMenu(async (tag) => {
  try { await invoke("set_locale", { tag }); updateLocale(tag); } catch { showError(); }
});

function updateLocale(tag: string): void {
  setLocale(tag);
  profileMenu.syncLocale(tag);
  applyI18n();
  element("hint").textContent = t("companion-hint");
  panel();
}

void startPersonalization();
element(isPanel ? "panel" : "pet").hidden = false;

async function action(name: string): Promise<void> {
  if (name === "sign-out") { await signOut(); return; }
  try {
    await invoke("companion_action", { action: name });
  } catch { showError(); }
}

async function signOut(): Promise<void> {
  if (signingOut || !state.data?.account) return;
  if (state.running > 0) {
    element("action-error").textContent = t("companion-account-busy");
    element("action-error").hidden = false;
    return;
  }
  if (!window.confirm(t("account-confirm-sign-out"))) return;
  signingOut = true;
  element("action-error").hidden = true;
  panel();
  try { await invoke("companion_action", { action: "sign-out" }); }
  catch { showError(); }
  finally { signingOut = false; await refresh(); }
}

function showError(code?: unknown): void {
  const error = element("action-error");
  error.textContent = connectionErrorMessage(code) ?? t("companion-action-error");
  error.hidden = false;
}

async function settings(section: string): Promise<void> {
  // Account management can restart the gateway. Keep this entry unavailable
  // during observed requests instead of silently switching their identity.
  if (section === "account" && state.available && state.running > 0) {
    element("action-error").textContent = t("companion-account-busy");
    element("action-error").hidden = false;
    return;
  }
  try { await invoke("open_settings_at", { section }); } catch { showError(); }
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action], [data-section]") : null;
  if (target?.matches(":disabled")) return;
  if (target?.dataset.action) void action(target.dataset.action);
  if (target?.dataset.section) void settings(target.dataset.section);
});
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  if (event.key === "Escape") {
    void action("close");
  }
  if ((event.metaKey || event.ctrlKey) && event.key === ",") { event.preventDefault(); profileMenu.close(); void settings("account"); }
  if ((event.metaKey || event.ctrlKey) && event.key === "w") { event.preventDefault(); void action(isPanel ? "close" : "hide"); }
});

function dismissHint(): void {
  hintSeen = true;
  element("hint").hidden = true;
  try { localStorage.setItem("companion.hint-seen", "true"); } catch { /* optional preference */ }
}
cat.addEventListener("pointerenter", () => { hovered = true; dismissHint(); paint(); });
cat.addEventListener("pointerleave", () => { hovered = false; paint(); });
let press: { x: number; y: number } | null = null;
let dragged = false;
cat.addEventListener("pointerdown", (event) => { if (event.button === 0) { press = { x: event.screenX, y: event.screenY }; dragged = false; } });
cat.addEventListener("pointermove", (event) => {
  if (press && !dragged && Math.hypot(event.screenX - press.x, event.screenY - press.y) > 4) {
    dragged = true;
    press = null;
    dismissHint();
    void action("drag").then(() => action("place"));
  }
});
cat.addEventListener("pointerup", () => { press = null; });
cat.addEventListener("click", () => { if (!dragged) { dismissHint(); void action("panel"); } dragged = false; });
cat.addEventListener("contextmenu", (event) => { event.preventDefault(); void action("panel"); });
element("hint").addEventListener("click", () => { dismissHint(); void action("panel"); });
element("primary").addEventListener("click", () => void settings(state.data?.account ? "apps" : "account"));

function paint(): void {
  if (!isPanel) element("hint").hidden = hintSeen || !state.available || state.configured > 0 || state.running > 0;
  const display = state.display(Date.now());
  const status = t(display.key);
  element("pet-status").textContent = status;
  element("panel-status").textContent = status;
  cat.setAttribute("aria-label", t("companion-cat-label", { status }));
  cat.title = t("companion-hint");
  draw();
}

function draw(): void {
  if (!isPanel) renderArt?.(hovered ? "hover" : state.display(Date.now()).pose, performance.now() / 1000, !reduced.matches);
}

async function toggleConnection(connection: CompanionConnection): Promise<void> {
  if (toggling) return;
  toggling = true;
  element("action-error").hidden = true;
  panel();
  try {
    await invoke("companion_toggle", { id: connection.id, enabled: !connection.configured });
  } catch (error) { showError(error); }
  finally {
    await refresh();
    toggling = false;
    panel();
    if (document.activeElement === document.body) {
      const row = [...document.querySelectorAll<HTMLElement>(".connection")].find((entry) => entry.dataset.id === connection.id);
      row?.querySelector<HTMLButtonElement>(".connection-switch")?.focus({ preventScroll: true });
    }
  }
}

function connectionSwitch(connection: CompanionConnection): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "connection-switch";
  control.setAttribute("role", "switch");
  control.setAttribute("aria-label", connection.name);
  control.setAttribute("aria-checked", String(connection.configured));
  control.disabled = toggling || !state.available || !state.data?.account;
  control.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void toggleConnection(connection);
  });
  return control;
}

function panel(): void {
  if (!isPanel) { paint(); return; }
  const account = state.data?.account;
  element("menu-account-name").textContent = account?.login ?? t("account-sign-in");
  element("sign-out").hidden = !account;
  element<HTMLButtonElement>("sign-out").disabled = signingOut || !state.available;
  element("sign-in").hidden = !!account;
  element("identity").textContent = account ? t("companion-identity", account) : t("account-sign-in");
  element("avatar").setAttribute("aria-label", account ? t("companion-identity", account) : t("nav-account"));
  element("initials").textContent = account?.login.slice(0, 2).toUpperCase() ?? "○";
  const photo = element<HTMLImageElement>("photo");
  let avatar: URL | null = null;
  try { if (account?.avatarUrl) avatar = new URL(account.avatarUrl); } catch { /* fallback */ }
  const avatarUrl = avatar?.protocol === "https:" ? avatar.href : "";
  if (photo.getAttribute("src") !== avatarUrl) {
    photo.hidden = true;
    element("initials").hidden = false;
    if (avatarUrl) photo.src = avatarUrl; else photo.removeAttribute("src");
  }
  photo.onload = () => { photo.hidden = false; element("initials").hidden = true; };
  photo.onerror = () => { photo.hidden = true; element("initials").hidden = false; };
  element("recovery").hidden = state.available || state.starting;
  element("gateway-notice").hidden = !state.available || state.data?.gateway !== "upstream-error";
  element("tools-section").hidden = !state.available && !state.starting;
  const connections = state.data?.connections ?? [];
  element("empty").hidden = connections.length > 0 && !!account;
  element("empty-copy").textContent = t(account ? "companion-empty" : "companion-signin-help");
  element("primary").textContent = t(account ? "companion-add" : "account-sign-in");
  const cannotAddTool = toggling || !state.canAddTool;
  element<HTMLButtonElement>("add").disabled = !account || cannotAddTool;
  element<HTMLButtonElement>("primary").disabled = !!account && cannotAddTool;
  const list = element("connections");
  const opened = new Set([...list.querySelectorAll<HTMLDetailsElement>("details[open]")].map((row) => row.dataset.id));
  const focused = document.activeElement?.closest<HTMLElement>("[data-id]")?.dataset.id;
  const focusWasSwitch = document.activeElement?.getAttribute("role") === "switch";
  const focusWasButton = document.activeElement?.tagName === "BUTTON";
  list.replaceChildren();
  for (const connection of connections) {
    const row = document.createElement("details");
    row.className = "connection";
    row.dataset.id = connection.id;
    row.open = opened.has(connection.id);
    const summary = document.createElement("summary");
    const icon = document.createElement("span");
    icon.className = "connection-icon";
    icon.textContent = connection.id === "codex" ? ">_" : connection.id.startsWith("claude") ? "✳" : "↗";
    icon.setAttribute("aria-hidden", "true");
    const labels = document.createElement("span");
    const name = document.createElement("span");
    name.className = "connection-name";
    name.textContent = connection.name;
    const activity = state.activity?.activity.find((entry) => entry.apiKeyId === connection.apiKeyId);
    const working = state.available && (activity?.activeRequests ?? 0) > 0;
    row.dataset.working = String(working);
    const status = document.createElement("span");
    status.className = "connection-status";
    status.textContent = working ? t("activity-active", { n: activity?.activeRequests ?? 0 }) : t(!state.available ? "companion-unavailable" : activity?.status === "stopped" ? "companion-interrupted" : state.connected(connection) ? "companion-connected" : connection.configured ? "companion-configured" : "companion-disabled");
    labels.append(name, status);
    const control = connectionSwitch(connection);
    summary.append(icon, labels, control);
    const content = document.createElement("div");
    content.className = "connection-content";
    const note = document.createElement("p");
    note.className = "connection-note";
    note.textContent = t(connection.shared ? "companion-shared" : "companion-request-only");
    const verification = document.createElement("p");
    verification.className = "connection-note";
    verification.textContent = t(state.connected(connection) ? "companion-verified" : "companion-verify-help");
    const manage = document.createElement("button");
    manage.textContent = t("companion-manage");
    manage.dataset.section = connection.section;
    content.append(note, verification, manage);
    for (const event of (state.activity?.recentEvents ?? []).filter((event) => event.apiKeyId === connection.apiKeyId).slice(-3).reverse()) {
      const outcome = document.createElement("p");
      outcome.className = "connection-note";
      const time = document.createElement("time");
      time.dateTime = new Date(event.timestamp).toISOString();
      time.textContent = new Date(event.timestamp).toLocaleTimeString();
      const label = document.createElement("span");
      label.textContent = t(event.status === "stopped" ? "companion-interrupted" : "activity-finished");
      outcome.append(time, document.createTextNode(" · "), label);
      content.append(outcome);
    }
    row.append(summary, content);
    list.append(row);
    if (focused === connection.id) (focusWasSwitch ? control : focusWasButton ? manage : summary).focus({ preventScroll: true });
  }
  paint();
}

async function refresh(): Promise<void> {
  if (busy) { refreshPending = true; return; }
  busy = true;
  const before = state.activity?.generation;
  try {
    const data = await invoke<CompanionData>("companion_data");
    if (before !== state.activity?.generation && data.activity.generation !== state.activity?.generation) refreshPending = true;
    else { state.update(data); streamSeen = Date.now(); }
  } catch {
    const boot = await invoke<{ state: string }>("companion_boot").catch(() => null);
    state.starting = boot?.state === "starting";
    state.disconnect(Date.now());
  }
  finally {
    busy = false;
    panel();
    if (refreshPending) { refreshPending = false; void refresh(); }
  }
}

type StreamMessage = { kind: string; data?: ClientActivitySnapshot | ClientRequestEvent };
async function start(): Promise<void> {
  await listen<string>("companion:gateway", ({ payload }) => {
    if (payload === "ready") { void refresh(); return; }
    state.starting = payload === "starting";
    state.disconnect(Date.now());
    if (state.starting) state.reaction = null;
    panel();
  });
  await listen<StreamMessage>("companion:stream", ({ payload }) => {
    streamSeen = Date.now();
    if (payload.kind === "activity.snapshot") state.snapshot(payload.data as ClientActivitySnapshot);
    else if (payload.kind === "activity.request") {
      if (!state.request(payload.data as ClientRequestEvent, Date.now())) void refresh();
    } else if (payload.kind === "unavailable") state.disconnect(Date.now());
    else if (payload.kind === "refresh") void refresh();
    panel();
  });
  const boot = await invoke<{ state: string; locale: string }>("companion_boot");
  state.starting = boot.state === "starting";
  updateLocale(boot.locale);
  await listen<string>("companion:locale", ({ payload }) => {
    updateLocale(payload);
  });
  applyI18n();
  element("hint").textContent = t("companion-hint");
  await refresh();
  setInterval(() => void refresh(), 5000);
}

if (!isPanel) {
  void createRenderer(element<HTMLCanvasElement>("art")).then((renderer) => { renderArt = renderer; paint(); }).catch(() => {
    element("pet-status").textContent = t("companion-art-error");
  });
}
setInterval(() => {
  if (Date.now() - streamSeen > 30000) state.disconnect(Date.now());
  if (!reduced.matches && !document.hidden) draw();
}, 1000 / 24);
setInterval(paint, 500);
reduced.addEventListener("change", paint);
void start().catch(() => { state.starting = false; state.disconnect(Date.now()); applyI18n(); panel(); });
