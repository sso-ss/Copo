export interface Clip { durations: number[]; total: number }

/** Resolve the original variable frame delays, including puzzled pauses. */
export function puffFrame(clip: Clip, seconds: number, animated: boolean): number {
  let elapsed = animated ? Math.max(0, seconds * 1000) % clip.total : 0;
  let frame = 0;
  while (frame < clip.durations.length - 1 && elapsed >= clip.durations[frame]) {
    elapsed -= clip.durations[frame++];
  }
  return frame;
}
