"""Prepare the seven supplied Puff APNGs: python prepare-puff.py SOURCE_FOLDER.

Requires Pillow and NumPy only; generated assets are bundled at build time.
"""
from pathlib import Path
import json
import sys

import numpy as np
from PIL import Image, ImageDraw


SOURCE = Path(sys.argv[1])
OUTPUT = Path(__file__).resolve().parents[1] / "shell/ui/companion/artwork/puff"
CLIPS = {
    "idle": "puff-hello-face-ears-tail",
    "focus": "puff-typing-with-question",
    "sleep": "puff-sleepy-blanket",
    "hover": "puff-heart-butt-wiggle",
    "success": "puff-catlike-motion",  # 28-frame wave into cheer from the original preview.
    "failure": "puff-angry-ears-tail",
    "approval": "puff-desk-sleep",
}


def transparent_frame(image):
    pixels = np.array(image.convert("RGB"))
    border = np.concatenate([pixels[0], pixels[-1], pixels[:, 0], pixels[:, -1]])
    background = np.median(border, axis=0)
    candidate = np.max(abs(pixels.astype(float) - background), axis=2) < 10
    # Remove only the cream background connected to the outside. Bright white
    # fur is not background, even where an outline has a small opening.
    mask = Image.fromarray(np.pad(np.where(candidate, 0, 255).astype("uint8"), 1)).copy()
    ImageDraw.floodfill(mask, (0, 0), 128)
    alpha = (np.array(mask)[1:-1, 1:-1] != 128).astype("uint8") * 255
    # Discard isolated extraction specks while keeping separate hearts and
    # expression marks. Their components are larger than these tiny flecks.
    components = Image.fromarray(alpha).copy()
    remaining = np.array(components) == 255
    while remaining.any():
        y, x = np.argwhere(remaining)[0]
        ImageDraw.floodfill(components, (int(x), int(y)), 128)
        after = np.array(components) == 255
        region = remaining & ~after
        if region.sum() < 20:
            alpha[region] = 0
        remaining = after
    rgba = Image.fromarray(np.dstack([pixels, alpha]))
    rgba.thumbnail((256, 240), Image.Resampling.NEAREST)
    frame = Image.new("RGBA", (256, 256))
    frame.alpha_composite(rgba, ((256 - rgba.width) // 2, 256 - rgba.height))
    return frame


OUTPUT.mkdir(parents=True, exist_ok=True)
manifest = {}
for pose, filename in CLIPS.items():
    source = Image.open(SOURCE / (filename + ".png"))
    frames, durations = [], []
    for index in range(source.n_frames):
        source.seek(index)
        frames.append(transparent_frame(source))
        durations.append(source.info.get("duration", 100))
    atlas = Image.new("RGBA", (2048, 256 * ((len(frames) + 7) // 8)))
    for index, frame in enumerate(frames):
        atlas.alpha_composite(frame, ((index % 8) * 256, (index // 8) * 256))
    atlas.save(OUTPUT / (pose + ".png"))
    frames[0].save(OUTPUT / (pose + "-still.png"))
    manifest[pose] = {"durations": durations, "total": sum(durations)}
(OUTPUT / "manifest.json").write_text(json.dumps(manifest) + "\n")
