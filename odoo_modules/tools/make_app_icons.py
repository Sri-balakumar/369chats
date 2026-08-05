"""Generate the Apps-grid icons for app_server_config and app_login_369.

WHY A SCRIPT AND NOT TWO PNGs

A binary dropped in a repo is a dead end: nobody can tell what it was made from,
so the next change means starting over in an image editor and the two icons drift
apart. This is the source. Re-run it and both are rebuilt identically.

    "C:\\Program Files\\Odoo 19.0.20260119\\python\\python.exe" \\
        odoo_modules/tools/make_app_icons.py

WHY NOT THE 369Chats MARK

These are not the chat app. App Servers points phones at a server; App Login says
who may sign in. Reusing the product mark for both would make three tiles in the
Apps grid that look identical and mean different things — the grid is scanned by
shape, so each needs its own.

DESIGN RULES, so they read at 32px in the sidebar as well as 140px in the grid:
  * one flat colour, one white glyph — no gradients, no drop shadows
  * strokes no thinner than ~22px at 512, i.e. ~1.4px at 32
  * distinct SILHOUETTES, not just distinct colours; a colourblind user or a
    greyscale screenshot still has to tell them apart
"""

import os

from PIL import Image, ImageDraw

SIZE = 512                     # matches chats_369 and kra_kpi_module
RADIUS = 112                   # iOS-ish squircle corner
WHITE = (255, 255, 255, 255)

HERE = os.path.dirname(os.path.abspath(__file__))
MODULES = os.path.dirname(HERE)


def _canvas(bg):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=bg)
    return img, d


def app_servers():
    """A server stack broadcasting upward.

    Reads as "the machine that tells things where to go" — which is the whole
    job: one row in Odoo, every phone follows it.
    """
    img, d = _canvas((46, 111, 224, 255))          # the app's blue

    # Three stacked server bars, bottom-weighted so the arcs have room.
    top, h, gap = 250, 58, 22
    for i in range(3):
        y = top + i * (h + gap)
        d.rounded_rectangle([120, y, 392, y + h], radius=16, outline=WHITE, width=16)
        # status light, on the left of each bar
        d.ellipse([152, y + h // 2 - 9, 170, y + h // 2 + 9], fill=WHITE)

    # Broadcast arcs above it. Drawn as arcs rather than a wifi fan so they stay
    # legible when the whole icon is 32px wide.
    for r, w in ((70, 20), (124, 20), (178, 20)):
        d.arc([256 - r, 196 - r, 256 + r, 196 + r], start=210, end=330, fill=WHITE, width=w)

    return img


def app_login():
    """A phone with a keyhole.

    A phone because signing in happens on one, and a keyhole because this screen
    is the thing that decides who gets through. Deliberately NOT a padlock: every
    security module in every Apps grid is a padlock.
    """
    img, d = _canvas((13, 148, 136, 255))          # teal — nothing else here is

    # Phone body.
    d.rounded_rectangle([148, 88, 364, 424], radius=34, outline=WHITE, width=18)
    # Earpiece.
    d.rounded_rectangle([228, 124, 284, 136], radius=6, fill=WHITE)
    # Home line.
    d.rounded_rectangle([224, 388, 288, 398], radius=5, fill=WHITE)

    # Keyhole: a circle over a tapered slot.
    cx, cy = 256, 238
    d.ellipse([cx - 44, cy - 44, cx + 44, cy + 44], outline=WHITE, width=18)
    d.polygon([(cx - 20, cy + 34), (cx + 20, cy + 34), (cx + 12, cy + 108),
               (cx - 12, cy + 108)], fill=WHITE)

    return img


def write(img, module):
    out_dir = os.path.join(MODULES, module, "static", "description")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "icon.png")
    img.save(path, "PNG")
    print("  %-22s -> %s (%dx%d)" % (module, path, img.width, img.height))


if __name__ == "__main__":
    print("Writing app icons:")
    write(app_servers(), "app_server_config")
    write(app_login(), "app_login_369")
