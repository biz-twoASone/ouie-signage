#!/usr/bin/env python3
# android-tv/app/build-tools/generate-assets.py
# Plan 5 Phase 2 Task 11.
# One-shot — regenerates Leanback banner + adaptive icon foreground + legacy
# launcher PNGs from the source logos. Re-run if the brand assets change.
# Requires: pillow (pip3 install pillow).
#
# Source files:
#   ~/Downloads/ouie logo.png         — wide wordmark, 3668x1152, transparent
#   ~/Downloads/ouie circle logo.png  — circle disc + white wordmark, 2202x1952
#
# Output: writes into android-tv/app/src/main/res/{drawable-*,mipmap-*}.

from pathlib import Path
from PIL import Image, ImageOps

REPO = Path(__file__).resolve().parents[3]
RES = REPO / "android-tv" / "app" / "src" / "main" / "res"

WORDMARK_SRC = Path.home() / "Downloads" / "ouie logo.png"
CIRCLE_SRC = Path.home() / "Downloads" / "ouie circle logo.png"

BRAND_GREEN = (0, 128, 88, 255)  # #008058 — verified by pixel-cluster analysis

# Leanback banner sizes (16:9). Skipping mdpi/hdpi as F&B TVs are 1080p+.
BANNER_DENSITIES = {
    "drawable-xhdpi":   (640, 360),
    "drawable-xxhdpi":  (960, 540),
    "drawable-xxxhdpi": (1280, 720),
}

# Legacy ic_launcher (square). API 26+ uses adaptive but legacy launchers fall
# back to these PNGs.
LAUNCHER_DENSITIES = {
    "mipmap-mdpi":    48,
    "mipmap-hdpi":    72,
    "mipmap-xhdpi":   96,
    "mipmap-xxhdpi":  144,
    "mipmap-xxxhdpi": 192,
}

# Adaptive icon foreground — 108dp canvas. Safe zone for the visible content
# is the inner 66dp circle. Foreground PNGs are the full 108dp canvas; the
# foreground graphic must sit inside the inner 66dp diameter.
FOREGROUND_DENSITIES = {
    "mipmap-mdpi":    108,
    "mipmap-hdpi":    162,
    "mipmap-xhdpi":   216,
    "mipmap-xxhdpi":  324,
    "mipmap-xxxhdpi": 432,
}


def wordmark_to_white_on_transparent(img: Image.Image) -> Image.Image:
    """Convert a green-wordmark-on-white source into a white-wordmark-on-transparent.
    The source PNG's alpha channel is unreliable (fully opaque despite a visibly
    transparent background in viewers), so we key by luma: bright pixels become
    transparent, dark pixels become white with proportional alpha. Preserves
    anti-aliasing at letter edges."""
    img = img.convert("RGBA")
    out = Image.new("RGBA", img.size, (255, 255, 255, 0))
    px_in = img.load()
    px_out = out.load()
    # Bimodal threshold: pixels brighter than `bg_cutoff` are background (alpha=0);
    # pixels darker than `fg_cutoff` are wordmark body (alpha=255); pixels in the
    # 150..235 anti-aliased ramp get a linear alpha so letter edges stay smooth.
    bg_cutoff = 235
    fg_cutoff = 150
    span = bg_cutoff - fg_cutoff
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, _ = px_in[x, y]
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            if luma >= bg_cutoff:
                alpha = 0
            elif luma <= fg_cutoff:
                alpha = 255
            else:
                alpha = int(255 * (bg_cutoff - luma) / span)
            px_out[x, y] = (255, 255, 255, alpha)
    return out


def make_banner(out: Path, target_w: int, target_h: int) -> None:
    """Banner = brand-green canvas with white wordmark centered, ~80% width."""
    bg = Image.new("RGBA", (target_w, target_h), BRAND_GREEN)
    src = Image.open(WORDMARK_SRC).convert("RGBA")
    src = wordmark_to_white_on_transparent(src)
    margin_w = int(target_w * 0.10)
    inner_w = target_w - 2 * margin_w
    aspect = src.width / src.height
    inner_h_max = int(target_h * 0.70)
    if inner_w / aspect <= inner_h_max:
        new_w, new_h = inner_w, int(inner_w / aspect)
    else:
        new_h, new_w = inner_h_max, int(inner_h_max * aspect)
    src = src.resize((new_w, new_h), Image.LANCZOS)
    pos = ((target_w - new_w) // 2, (target_h - new_h) // 2)
    bg.alpha_composite(src, pos)
    out.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(out, "PNG", optimize=True)
    print(f"banner -> {out.relative_to(REPO)} ({target_w}x{target_h})")


def make_legacy_launcher(out: Path, size: int) -> None:
    """Legacy ic_launcher.png — circle logo scaled to size, transparent margin."""
    src = Image.open(CIRCLE_SRC).convert("RGBA")
    # Square-pad to source's max dim so resize doesn't distort.
    side = max(src.width, src.height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(src, ((side - src.width) // 2, (side - src.height) // 2))
    icon = canvas.resize((size, size), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    icon.save(out, "PNG", optimize=True)
    print(f"launcher -> {out.relative_to(REPO)} ({size}x{size})")


def make_adaptive_foreground(out: Path, size: int) -> None:
    """Adaptive icon foreground — 108dp canvas, content inside inner ~66dp circle.
    We use the circle logo as the foreground, scaled to fit the safe zone,
    centered on a transparent canvas."""
    src = Image.open(CIRCLE_SRC).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # Safe zone: inner 66dp of 108dp = 61% diameter. Scale source to that.
    safe = int(size * 0.61)
    aspect = src.width / src.height
    if aspect > 1:
        new_w, new_h = safe, int(safe / aspect)
    else:
        new_h, new_w = safe, int(safe * aspect)
    src = src.resize((new_w, new_h), Image.LANCZOS)
    pos = ((size - new_w) // 2, (size - new_h) // 2)
    canvas.alpha_composite(src, pos)
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, "PNG", optimize=True)
    print(f"foreground -> {out.relative_to(REPO)} ({size}x{size})")


def main() -> None:
    if not WORDMARK_SRC.exists():
        raise SystemExit(f"missing source: {WORDMARK_SRC}")
    if not CIRCLE_SRC.exists():
        raise SystemExit(f"missing source: {CIRCLE_SRC}")

    for density, (w, h) in BANNER_DENSITIES.items():
        make_banner(RES / density / "banner.png", w, h)
    for density, size in LAUNCHER_DENSITIES.items():
        make_legacy_launcher(RES / density / "ic_launcher.png", size)
        make_legacy_launcher(RES / density / "ic_launcher_round.png", size)
    for density, size in FOREGROUND_DENSITIES.items():
        make_adaptive_foreground(RES / density / "ic_launcher_foreground.png", size)


if __name__ == "__main__":
    main()
