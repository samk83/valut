"""Prepares the app screenshots used on the beta page and in the how-to video.

The App Store screenshots show a few lines that should not appear in beta/promo material yet:
  - "Three wrong attempts destroys the vault" (02, 08): the wrong-attempt rule is an open owner decision.
  - "Screenshots blocked" (07): iOS cannot fully block screenshots, so we don't claim it.
  - "No network access" (07): the 1.1 app says "No cloud, no servers" (new-phone transfer uses local Wi-Fi).
This script paints over those lines and redraws the remaining text in Inter.

It also swaps the drawn placeholder pictures in the vault grid, video tab and viewer for real photos
(free Unsplash-licensed photos via picsum.photos; list and credits in PHOTOS below and assets/shots/CREDITS.md).

Usage (repo root):  python website/beta/myvisionvault/tools/prepare_shots.py <iphone-6.9 screenshot folder> <out folder> [photo folder]
The photo folder holds full<ID>.jpg files (download: https://picsum.photos/id/<ID>/1600/1600). Without it, photos are not swapped.
Writes full-size PNGs to <out folder> (for make_video.js) and 660px WebP files to assets/shots/.
Needs Pillow and the Inter font (Inter-Regular.otf / Inter-Medium.otf, e.g. /usr/share/fonts/opentype/inter).
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageOps

SRC, OUT = sys.argv[1], sys.argv[2]
PHOTO_DIR = sys.argv[3] if len(sys.argv) > 3 else None
FONT_DIR = os.environ.get('INTER_DIR', '/usr/share/fonts/opentype/inter')
SHOTS = os.path.join(os.path.dirname(__file__), '..', 'assets', 'shots')
os.makedirs(OUT, exist_ok=True)

def font(weight, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, f'Inter-{weight}.otf'), size)

def edit_02(im):
    d = ImageDraw.Draw(im)
    d.rectangle((110, 1455, 1215, 1625), fill=(26, 20, 16))
    f = font('Regular', 37)
    lines = ['There is no password reset, no admin override and no',
             'cloud backup. Reinstalling the app will not bring your',
             'files back.']
    for i, t in enumerate(lines):
        d.text((124, 1462 + i * 56.5), t, font=f, fill=(212, 196, 181))

def edit_07(im):
    d = ImageDraw.Draw(im)
    d.rectangle((640, 566, 1180, 614), fill=(30, 26, 18))   # "Screenshots blocked"
    d.rectangle((158, 566, 600, 614), fill=(30, 26, 18))    # "No network access"
    d.text((163, 571), 'No cloud, no servers', font=font('Regular', 36), fill=(217, 212, 202))

def edit_08(im):
    d = ImageDraw.Draw(im)
    d.rectangle((60, 2695, 1260, 2742), fill=(11, 13, 18))  # keep "There is no recovery."

# Picsum/Unsplash photo ids placed into each screen (cell boxes measured on the 1320x2868 screenshots).
GRID_X = (12, 447, 885)
CELL = 423
PHOTOS = {
    '03-home-photos': [((GRID_X[0], 843), 64), ((GRID_X[1], 843), 15), ((GRID_X[2], 843), 129),
                       ((GRID_X[0], 1278), 349),
                       ((GRID_X[0], 1863), 10), ((GRID_X[1], 1863), 65), ((GRID_X[2], 1863), 28),
                       ((GRID_X[0], 2298), 184), ((GRID_X[1], 2298), 399), ((GRID_X[2], 2298), 235),
                       ((GRID_X[0], 2733), 177), ((GRID_X[1], 2733), 323), ((GRID_X[2], 2733), 287)],
    '04-home-videos': [((GRID_X[0], 843), 338), ((GRID_X[0], 1425), 381),
                       ((GRID_X[0], 2010), 110), ((GRID_X[1], 2010), 417)],
}
VIEWER = ('06-photo-viewer', (0, 570, 1320, 2331), 327)
DOCK = (66, 2562, 1256, 2778)   # "Import from Photos" bar drawn over the grid

def photo(pid, w, h):
    return ImageOps.fit(Image.open(os.path.join(PHOTO_DIR, f'full{pid}.jpg')).convert('RGB'), (w, h), Image.LANCZOS)

def play_badge(d, x, y):
    d.ellipse((x - 30, y - 30, x + 30, y + 30), fill=(11, 13, 18))
    d.polygon([(x - 9, y - 14), (x - 9, y + 14), (x + 15, y)], fill=(242, 238, 230))

def swap_photos(key, im):
    orig = im.copy()
    if key in PHOTOS:
        for (x, y), pid in PHOTOS[key]:
            h = min(CELL, im.height - y)
            im.paste(photo(pid, CELL, CELL).crop((0, 0, CELL, h)), (x, y))
            if key == '04-home-videos':
                play_badge(ImageDraw.Draw(im), x + CELL - 46, y + CELL - 46)
        mask = Image.new('L', im.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle(DOCK, radius=(DOCK[3] - DOCK[1]) // 2, fill=255)
        im.paste(orig, (0, 0), mask)   # keep the dock bar on top
    if key == VIEWER[0]:
        l, t, r, b = VIEWER[1]
        im.paste(photo(VIEWER[2], r - l, b - t), (l, t))
        d = ImageDraw.Draw(im, 'RGBA')
        for cx, pts in ((88, [(100, 1414), (78, 1444), (100, 1474)]), (1232, [(1220, 1414), (1242, 1444), (1220, 1474)])):
            d.ellipse((cx - 62, 1444 - 62, cx + 62, 1444 + 62), fill=(20, 22, 28, 170))
            d.line(pts, fill=(242, 238, 230, 255), width=7, joint='curve')

EDITS = {'02-create-pin': edit_02, '07-settings': edit_07, '08-unlock': edit_08}

for name in sorted(os.listdir(SRC)):
    if not name.endswith('.png'):
        continue
    key = name[:-4]
    im = Image.open(os.path.join(SRC, name)).convert('RGB')
    if PHOTO_DIR:
        swap_photos(key, im)
    if key in EDITS:
        EDITS[key](im)
    im.save(os.path.join(OUT, name))
    im.resize((660, round(im.height * 660 / im.width)), Image.LANCZOS).save(
        os.path.join(SHOTS, key + '.webp'), 'WEBP', quality=82, method=6)
    print('prepared', key, '(edited)' if key in EDITS else '')
