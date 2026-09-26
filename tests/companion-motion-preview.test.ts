import { describe, expect, test } from "bun:test"

import {
  MotionPreview,
  previewMotions,
} from "../shell/src/companion/motion-preview"

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
})
