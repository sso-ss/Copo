import { describe, expect, test } from "bun:test"

import {
  MotionPreview,
  previewMotions,
  puffMotions,
} from "../shell/src/companion/motion-preview"
import { puffFrame } from "../shell/src/companion/puff-timing"
import clips from "../shell/ui/companion/artwork/puff/manifest.json"

describe("companion motion playground", () => {
  test("play all visits every motion once and stops after the last", () => {
    const player = new MotionPreview()
    player.playAll()
    for (const motion of previewMotions) {
      expect(player.motion.id).toBe(motion.id)
      expect(player.playing).toBe(true)
      player.advance(motion.duration)
    }
    expect(player.playing).toBe(false)
    expect(player.touring).toBe(false)
    expect(player.finished).toBe(true)
    const last = player.frame()
    player.advance(60)
    expect(player.frame()).toEqual(last)
  })

  test("pause freezes the current frame and resume continues its clock", () => {
    const player = new MotionPreview()
    player.select("happy")
    player.advance(1.5)
    const paused = player.frame()
    player.pause()
    player.advance(120)
    expect(player.frame()).toEqual(paused)
    player.resume()
    player.advance(0.5)
    expect(player.frame().phase).toBe(2)
  })

  test("choosing a motion exits the tour and starts that gesture immediately", () => {
    const player = new MotionPreview()
    player.playAll()
    player.advance(8)
    player.select("scratch")
    expect(player.touring).toBe(false)
    expect(player.frame()).toEqual({
      pose: "focus",
      phase: 11.8,
      animated: true,
    })
    player.advance(3)
    expect(player.motion.id).toBe("scratch")
    expect(player.frame().phase % 21).toBeCloseTo(11.8)
  })

  test("ear gestures alternate sides using the live renderer's timeline", () => {
    const player = new MotionPreview()
    player.select("ears")
    expect(Math.floor(player.frame().phase / 29) % 2).toBe(0)
    player.advance(2)
    expect(Math.floor(player.frame().phase / 29) % 2).toBe(1)
    expect(player.frame().phase % 29).toBeCloseTo(17.8)
  })

  test("Reduce Motion stops playback and preserves manual static pose selection", () => {
    const player = new MotionPreview()
    player.playAll()
    player.setReduced(true)
    player.select("hearts")
    player.resume()
    player.playAll()
    player.advance(50)
    expect(player.playing).toBe(false)
    expect(player.touring).toBe(false)
    expect(player.frame()).toEqual({ pose: "hover", phase: 0, animated: false })
    player.setReduced(false)
    expect(player.playing).toBe(false)
    player.resume()
    expect(player.playing).toBe(true)
  })

  test("invalid selections and clock deltas cannot corrupt the preview", () => {
    const player = new MotionPreview()
    player.select("sleep")
    player.select("unknown")
    player.advance(Number.NaN)
    player.advance(-1)
    expect(player.frame()).toEqual({ pose: "sleep", phase: 0, animated: true })
  })

  test("Puff's tour visits all six states and ends on manual approval", () => {
    const player = new MotionPreview(puffMotions)
    player.playAll()
    const poses = []
    for (const motion of puffMotions) {
      poses.push(player.frame().pose)
      player.advance(motion.duration)
    }
    expect(poses).toEqual([
      "idle",
      "focus",
      "sleep",
      "hover",
      "failure",
      "approval",
    ])
    expect(player.finished).toBe(true)
    expect(player.frame().pose).toBe("approval")
  })

  test("Puff retains variable frame delays, loops, and freezes with Reduce Motion", () => {
    const first = clips.focus.durations[0] / 1000
    expect(puffFrame(clips.focus, first - 0.001, true)).toBe(0)
    expect(puffFrame(clips.focus, first, true)).toBe(1)
    expect(puffFrame(clips.focus, clips.focus.total / 1000, true)).toBe(0)
    const player = new MotionPreview(puffMotions)
    player.select("puff-working")
    player.advance(first + 0.01)
    player.pause()
    const frame = player.frame()
    player.advance(10)
    expect(player.frame()).toEqual(frame)
    player.setReduced(true)
    player.select("approval")
    expect(player.frame().pose).toBe("approval")
    expect(puffFrame(clips.approval, 5, player.frame().animated)).toBe(0)
  })
})
