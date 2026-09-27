import type { Pose } from "./state";

import { puffFrame, type Clip } from "./puff-timing";

/** Prepared transparent atlases preserve the supplied animations and timing. */
export async function createPuffRenderer(canvas: HTMLCanvasElement, artworkBase: string): Promise<(pose: Pose, phase: number, animated: boolean) => void> {
  const url = (name: string) => new URL(`puff/${name}`, new URL(artworkBase, document.baseURI)).href;
  const response = await fetch(url("manifest.json"));
  if (!response.ok) throw new Error("Puff artwork unavailable");
  const clips = await response.json() as Record<Pose, Clip>;
  const images = new Map<Pose, HTMLImageElement>();
  await Promise.all((Object.keys(clips) as Pose[]).map(async (pose) => {
    const image = new Image();
    image.src = url(`${pose}.png`);
    await image.decode();
    images.set(pose, image);
  }));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  let previous: Pose | null = null;
  let started = 0;
  return (pose, phase, animated) => {
    if (pose !== previous) { previous = pose; started = phase; }
    const image = images.get(pose);
    if (!image) return;
    const frame = puffFrame(clips[pose], phase - started, animated);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    const size = Math.min(canvas.width, canvas.height);
    context.drawImage(image, (frame % 8) * 256, Math.floor(frame / 8) * 256, 256, 256,
      (canvas.width - size) / 2, canvas.height - size, size, size);
  };
}
