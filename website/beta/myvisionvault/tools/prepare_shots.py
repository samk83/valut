"""Prepares the app screenshots used on the beta page and in the how-to video.

The App Store screenshots show a few lines that should not appear in beta/promo material yet:
  - "Three wrong attempts destroys the vault" (02, 08): the wrong-attempt rule is an open owner decision.
  - "Screenshots blocked" (07): iOS cannot fully block screenshots, so we don't claim it.
  - "No network access" (07): the 1.1 app says "No cloud, no servers" (new-phone transfer uses local Wi-Fi).
This script paints over those lines and redraws the remaining text in Inter.

Usage (repo root):  python website/beta/myvisionvault/tools/prepare_shots.py <iphone-6.9 screenshot folder> <out folder>
Writes full-size PNGs to <out folder> (for make_video.js) and 660px WebP files to assets/shots/.
Needs Pillow and the Inter font (Inter-Regular.otf / Inter-Medium.otf, e.g. /usr/share/fonts/opentype/inter).
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

SRC, OUT = sys.argv[1], sys.argv[2]
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

EDITS = {'02-create-pin': edit_02, '07-settings': edit_07, '08-unlock': edit_08}

for name in sorted(os.listdir(SRC)):
    if not name.endswith('.png'):
        continue
    key = name[:-4]
    im = Image.open(os.path.join(SRC, name)).convert('RGB')
    if key in EDITS:
        EDITS[key](im)
    im.save(os.path.join(OUT, name))
    im.resize((660, round(im.height * 660 / im.width)), Image.LANCZOS).save(
        os.path.join(SHOTS, key + '.webp'), 'WEBP', quality=82, method=6)
    print('prepared', key, '(edited)' if key in EDITS else '')
