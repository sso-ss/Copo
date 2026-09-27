import type { Pose } from "./state";

interface Motion {
  id: string;
  pose: Pose;
  start: number;
  duration: number;
  loop?: number;
}

/** Gesture offsets use the same timeline as the live companion renderer. */
export const previewMotions: readonly Motion[] = [
  { id: "idle", pose: "idle", start: 0, duration: 10 },
  { id: "working", pose: "focus", start: .7, duration: 6 },
  { id: "blink", pose: "idle", start: 5.55, duration: 1.2, loop: 5.7 },
  { id: "look", pose: "idle", start: 1.8, duration: 6.2, loop: 11 },
  { id: "ears", pose: "idle", start: 17.8, duration: 2, loop: 29 },
  { id: "scratch", pose: "focus", start: 11.8, duration: 3, loop: 21 },
  { id: "hearts", pose: "hover", start: 0, duration: 6 },
  { id: "happy", pose: "success", start: 0, duration: 5 },
  { id: "surprised", pose: "failure", start: 0, duration: 5 },
  { id: "sleep", pose: "sleep", start: 0, duration: 7 },
];

/** Puff uses the six original clips rather than the cat's small gestures. */
export const puffMotions: readonly Motion[] = [
  { id: "puff-idle", pose: "idle", start: 0, duration: 6 },
  { id: "puff-working", pose: "focus", start: 0, duration: 12 },
  { id: "puff-sleep", pose: "sleep", start: 0, duration: 7 },
  { id: "puff-hover", pose: "hover", start: 0, duration: 6 },
  { id: "puff-failure", pose: "failure", start: 0, duration: 6 },
  { id: "approval", pose: "approval", start: 0, duration: 7 },
];

/** A local playback clock; never reads or changes live tool/companion state. */
export class MotionPreview {
  private index = 0;
  private elapsed = 0;
  playing = false;
  touring = false;
  reduced = false;
  finished = false;

  readonly motions: readonly Motion[];

  constructor(motions: readonly Motion[] = previewMotions) { this.motions = motions; }

  get motion(): Motion { return this.motions[this.index]; }

  select(id: string): void {
    const index = this.motions.findIndex((motion) => motion.id === id);
    if (index < 0) return;
    this.index = index;
    this.elapsed = 0;
    this.touring = false;
    this.finished = false;
    this.playing = !this.reduced;
  }

  playAll(): void {
    if (this.reduced) return;
    this.select(this.motions[0].id);
    this.touring = true;
  }

  pause(): void { this.playing = false; }
  resume(): void {
    if (this.reduced) return;
    this.finished = false;
    this.playing = true;
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced) {
      this.pause();
      this.touring = false;
    }
  }

  advance(seconds: number): void {
    if (!this.playing || !Number.isFinite(seconds) || seconds <= 0) return;
    this.elapsed += seconds;
    while (this.touring && this.elapsed >= this.motion.duration) {
      if (this.index === this.motions.length - 1) {
        this.elapsed = this.motion.duration;
        this.touring = false;
        this.playing = false;
        this.finished = true;
      } else {
        this.elapsed -= this.motion.duration;
        this.index++;
      }
    }
  }

  frame(): { pose: Pose; phase: number; animated: boolean } {
    const motion = this.motion;
    // Loop each small gesture at its original timeline position. Successive
    // ear-fold cycles alternate sides, exactly as they do on the live pet.
    const elapsed = motion.loop
      ? this.elapsed % motion.duration + Math.floor(this.elapsed / motion.duration) * motion.loop
      : this.elapsed;
    return { pose: motion.pose, phase: motion.start + elapsed, animated: !this.reduced };
  }
}
