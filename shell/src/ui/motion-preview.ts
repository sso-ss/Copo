import { createRenderer } from "../companion/renderer";
import { MotionPreview, previewMotions, puffMotions } from "../companion/motion-preview";
import { t } from "../i18n";

/** Optional Settings-only playground. Its clock never reaches the native pet. */
export function startMotionPreview(): void {
  const toggle = document.querySelector<HTMLButtonElement>("#motion-toggle");
  const canvas = document.querySelector<HTMLCanvasElement>("#motion-canvas");
  const still = document.querySelector<HTMLImageElement>(".personalization-preview img");
  const controls = document.getElementById("motion-controls");
  const select = document.querySelector<HTMLSelectElement>("#motion-select");
  const playAll = document.querySelector<HTMLButtonElement>("#motion-play-all");
  const pause = document.querySelector<HTMLButtonElement>("#motion-pause");
  const status = document.getElementById("motion-status");
  const error = document.getElementById("motion-error");
  const reducedNotice = document.getElementById("motion-reduced");
  const section = toggle?.closest<HTMLElement>("[data-section]");
  if (!toggle || !canvas || !still || !controls || !select || !playAll || !pause || !status || !error || !reducedNotice || !section) return;
  if (toggle.dataset.wired) return;
  toggle.dataset.wired = "true";

  let player = new MotionPreview();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  player.setReduced(reduced.matches);
  let draw: Awaited<ReturnType<typeof createRenderer>> | null = null;
  let open = false;
  let loading = false;
  let generation = 0;
  let animation = 0;
  let previous = 0;

  function repaint(): void {
    if (draw) {
      const { pose, phase, animated } = player.frame();
      draw(pose, phase, animated);
    }
  }

  function render(): void {
    toggle!.textContent = t(loading ? "motion-loading" : open ? "motion-done" : "motion-try");
    toggle!.removeAttribute("data-i18n");
    toggle!.setAttribute("aria-expanded", String(open));
    toggle!.setAttribute("aria-busy", String(loading));
    // Closing remains available while artwork loads; a late load cannot reopen it.
    controls!.hidden = !open || loading;
    canvas!.hidden = !open || !draw;
    still!.hidden = open && !!draw;
    pause!.textContent = t(player.playing ? "motion-pause" : "motion-resume");
    pause!.removeAttribute("data-i18n");
    playAll!.disabled = player.reduced;
    pause!.disabled = player.reduced;
    select!.value = player.motion.id;
    reducedNotice!.hidden = !player.reduced;
    const text = !open ? "" : loading ? t("motion-loading") : t(
      player.finished ? "motion-finished" : player.reduced ? "motion-static" : player.playing ? "motion-previewing" : "motion-paused",
      { name: t(`motion-${player.motion.id}`) },
    );
    if (status!.textContent !== text) status!.textContent = text;
    repaint();
  }

  function stopClock(): void {
    cancelAnimationFrame(animation);
    animation = 0;
    previous = 0;
  }

  function runClock(): void {
    if (animation || !open || !draw || !player.playing || document.hidden || section!.hidden) return;
    animation = requestAnimationFrame((now) => {
      animation = 0;
      if (previous && now - previous < 1000 / 24) { runClock(); return; }
      const before = player.motion.id;
      if (previous) player.advance((now - previous) / 1000);
      previous = now;
      if (before !== player.motion.id || !player.playing) render();
      else repaint();
      runClock();
    });
  }

  function close(): void {
    generation++;
    open = false;
    loading = false;
    player.pause();
    stopClock();
    draw = null;
    error!.hidden = true;
    render();
  }

  async function show(): Promise<void> {
    open = true;
    loading = true;
    error!.hidden = true;
    const current = ++generation;
    draw = null;
    render();
    try {
      const renderer = await createRenderer(canvas!, "./motion-artwork/", document.documentElement.dataset.buddyCharacter === "puff" ? "puff" : "cat");
      if (!open || current !== generation) return;
      draw = renderer;
      loading = false;
      player.select(player.motions[0].id);
      render();
      runClock();
    } catch {
      if (current !== generation) return;
      close();
      error!.hidden = false;
    }
  }

  function localize(): void {
    for (const option of select!.options) option.textContent = t(`motion-${option.value}`);
    render();
  }

  function selectCharacter(): void {
    stopClock();
    const motions = document.documentElement.dataset.buddyCharacter === "puff" ? puffMotions : previewMotions;
    player = new MotionPreview(motions);
    player.setReduced(reduced.matches);
    select!.replaceChildren();
    for (const motion of motions) {
      const option = document.createElement("option");
      option.value = motion.id;
      select!.append(option);
    }
    localize();
    if (open) void show();
  }
  selectCharacter();
  window.addEventListener("companion-character-changed", selectCharacter);
  toggle.addEventListener("click", () => { if (open) close(); else void show(); });
  select.addEventListener("change", () => {
    stopClock();
    player.select(select.value);
    render();
    runClock();
  });
  playAll.addEventListener("click", () => {
    stopClock();
    player.playAll();
    render();
    runClock();
  });
  pause.addEventListener("click", () => {
    stopClock();
    if (player.playing) player.pause(); else player.resume();
    render();
    runClock();
  });
  reduced.addEventListener("change", () => {
    stopClock();
    player.setReduced(reduced.matches);
    render();
  });
  document.addEventListener("visibilitychange", () => {
    stopClock();
    if (!document.hidden) runClock();
  });
  // Section visibility is changed by the shared Settings navigation. Closing
  // here releases decoded artwork and prevents off-screen playback.
  new MutationObserver(() => { if (section.hidden) close(); })
    .observe(section, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("pagehide", close);
  window.addEventListener("maximal:locale-changed", localize);
}
