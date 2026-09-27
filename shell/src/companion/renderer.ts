import { createPuffRenderer } from "./puff-renderer";
import { companionArtwork } from "../ui/styles/theme";
import { artwork } from "./artwork";
import type { Pose } from "./state";

type Region = { x: number; y: number; width: number; height: number };

/** Port of Companion/Sources/BuddyArt.swift. Frames keep their calibrated
 * 1024 × 1040 canvas; body pixels are never stretched pose by pose. */
async function createCatRenderer(canvas: HTMLCanvasElement, artworkBase = "./artwork/"): Promise<(pose: Pose, phase: number, animated: boolean) => void> {
  const assetUrl = (name: string) => new URL(name, new URL(artworkBase, document.baseURI));
  const frames = new Map<string, HTMLImageElement>();
  await Promise.all(artwork.map(async (name) => {
    const image = new Image();
    image.src = assetUrl(`cat-${name}.png`).href;
    await image.decode();
    frames.set(name, image);
  }));
  const regions = await fetch(assetUrl("cat-tail-regions.json")).then((r) => {
    if (!r.ok) throw new Error("Artwork unavailable");
    return r.json();
  }) as Record<string, Region[]>;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  const cg = context;
  cg.imageSmoothingEnabled = false;
  return (pose, phase, animated) => {
    if (pose === "approval") pose = "idle";
    const working = pose === "focus";
    const hovered = pose === "hover";
    const gestureTime = phase % 21;
    const scratch = working && animated && gestureTime >= 12 && gestureTime < 14.5;
    let body = scratch ? "focus-ear" : pose;
    const overlays: string[] = [];
    if (scratch && gestureTime >= 12.25 && gestureTime < 14.15)
      body = `focus-ear-scratch-${Math.floor((gestureTime - 12.25) / .14) % 2 === 0 ? "up" : "down"}`;
    if (pose === "sleep" && animated) {
      const offset = Math.round(1 - Math.cos(phase * 2 * Math.PI / 4.8)) * 4;
      if (offset) body = `sleep-head-${offset}`;
    }
    if (hovered && animated) {
      const offset = Math.round(2 * Math.sin(phase * 2 * Math.PI / 1.8)) * 4;
      if (offset) body = `hover-paws-${offset}`;
    } else if (pose === "success" && animated) {
      const wave = Math.sin(phase * 2 * Math.PI / 1.1);
      if (Math.abs(wave) > .35) body = `success-${wave > 0 ? "up" : "down"}`;
    } else if (pose === "failure" && animated) {
      const mouth = phase % 1.8;
      if (mouth < .4 || mouth >= 1.05) overlays.push("failure-mouth-closed");
      else if (mouth < .55 || mouth >= .85) overlays.push("failure-mouth-small");
    }
    if (animated && !scratch && (pose === "idle" || working)) {
      const fold = phase % 29;
      if (fold >= 18 && fold < 19.3)
        body = `${pose}-${fold < 18.22 || fold >= 19.08 ? "half" : "fold"}-${Math.floor(phase / 29) % 2 === 0 ? "left" : "right"}`;
      if (!working) {
        const offset = Math.round(3 * Math.sin(phase * 2 * Math.PI / 3.6)) * 4;
        if (offset) body += `-arms-${offset}`;
      }
      const glance = phase % 11;
      let gaze = working ? (glance >= 8 && glance < 10 ? "down" : "left")
        : glance >= 2 && glance < 3.5 ? "left" : glance >= 6 && glance < 7.5 ? "right" : null;
      if (phase % 5.7 < .16) gaze = "blink";
      if (gaze) overlays.push(`${pose}-eyes-${gaze}`);
      if (working && phase % 6 >= .7 && phase % 6 < 4.5)
        overlays.push(`focus-typing-${Math.floor(phase / .18) % 2 === 0 ? "left" : "right"}`);
    }
    const frame = frames.get(body) ?? frames.get(pose);
    if (!frame) return;
    cg.clearRect(0, 0, 1024, 1040);
    const tailPose = scratch ? "focus-ear" : pose;
    const parts = regions[tailPose];
    if (animated && parts) {
      cg.save();
      cg.beginPath();
      cg.rect(0, 0, 1024, 1040);
      for (const r of parts) cg.rect(r.x, r.y, r.width, r.height);
      cg.clip("evenodd");
      cg.drawImage(frame, 0, 0);
      cg.restore();
      const root = Math.min(...parts.map((r) => hovered ? r.y : r.x));
      const end = Math.max(...parts.map((r) => hovered ? r.y + r.height : r.x + r.width));
      const wave = Math.sin(phase * 2 * Math.PI / (hovered ? 2.8 : pose === "sleep" ? 6.2 : pose === "failure" ? 2 : 4.4))
        * (pose === "sleep" || pose === "failure" ? 8 : 12);
      const tail = (image: HTMLImageElement) => {
        for (const r of parts) {
          for (let p = hovered ? r.y : r.x; p < (hovered ? r.y + r.height : r.x + r.width); p += 4) {
            const w = hovered ? r.width : Math.min(4, r.x + r.width - p);
            const h = hovered ? Math.min(4, r.y + r.height - p) : r.height;
            const x = hovered ? r.x : p;
            const y = hovered ? p : r.y;
            const progress = Math.min(1, Math.max(0, (p + 2 - root) / (end - root)));
            const t = pose === "sleep" ? 1 - progress : progress;
            const offset = Math.round(wave * t * t * (3 - 2 * t));
            cg.drawImage(image, x, y, w, h, x + (hovered ? offset : 0), y - (hovered ? 0 : offset), w, h);
          }
        }
      };
      tail(frames.get(tailPose) ?? frame);
      if (pose === "failure") {
        const stage = [0, 1, 2, 2, 1, 0][Math.min(5, Math.floor((phase % 1.2) / .2))];
        const spikes = frames.get(`failure-spikes-${stage}`);
        if (spikes) tail(spikes);
      }
    } else cg.drawImage(frame, 0, 0);
    for (const name of overlays) {
      const overlay = frames.get(name);
      if (overlay) cg.drawImage(overlay, 0, 0);
    }
    if (hovered) {
      const heart = [".oo.oo.", "ooooooo", "ooooooo", ".ooooo.", "..ooo..", "...o..."];
      [[610, 270], [805, 345]].forEach(([x, y], index) => {
        const beat = animated ? (phase / 2.4 + index * .5) % 1 : .5;
        const lift = animated ? 28 * Math.sin(beat * Math.PI) : 0;
        cg.fillStyle = companionArtwork.heart;
        cg.globalAlpha = .7 + .3 * Math.sin(beat * Math.PI);
        heart.forEach((line, row) => [...line].forEach((pixel, column) => {
          if (pixel === "o") cg.fillRect(x + column * 11, y - lift + row * 11, 11, 11);
        }));
      });
      cg.globalAlpha = 1;
    }
    if (pose === "success") {
      cg.fillStyle = companionArtwork.spark;
      for (const x of [120, 904]) {
        cg.fillRect(x, 146, 14, 42);
        cg.fillRect(x - 14, 160, 42, 14);
      }
    }
  };
}

/** Decode only the selected character. A broken alternate never hides the cat. */
export function createRenderer(canvas: HTMLCanvasElement, artworkBase = "./artwork/", character: "cat" | "puff" = "cat"): Promise<(pose: Pose, phase: number, animated: boolean) => void> {
  return character === "puff" ? createPuffRenderer(canvas, artworkBase) : createCatRenderer(canvas, artworkBase);
}
