# Draws three sample "photos with text" (receipt, sticky note, booking screenshot) for the beta video,
# plus the search notes (text lines with boxes) the demo vault returns for them.
# Usage: python gen_text_samples.py <outDir> <fontDir>
import json, os, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

out, fdir = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
random.seed(3)
def F(w, size):
    return ImageFont.truetype(os.path.join(fdir, f'{w}/Inter_{w}.ttf'), size)
notes = {}

def record(name, im, lines, labels):
    notes[name] = {'v': 1, 'engine': 'demo', 'w': im.width, 'h': im.height,
                   'text': '\n'.join(t for t, _ in lines), 'lines': [{'t': t, 'b': list(b)} for t, b in lines], 'labels': labels}

def put(d, xy, text, font, fill, lines, anchor='la'):
    d.text(xy, text, font=font, fill=fill, anchor=anchor)
    x0, y0, x1, y1 = d.textbbox(xy, text, font=font, anchor=anchor)
    lines.append((text, (x0, y0, x1 - x0, y1 - y0)))

# 1. Receipt on a dark wooden table.
W, H = 1200, 1250
im = Image.new('RGB', (W, H), (58, 42, 32)); d = ImageDraw.Draw(im)
for y in range(0, H, 6):
    c = 52 + int(10 * random.random()); d.line([(0, y), (W, y + random.randint(-3, 3))], fill=(c + 8, c - 6, c - 18), width=6)
im = im.filter(ImageFilter.GaussianBlur(2)); d = ImageDraw.Draw(im)
px0, py0, px1, py1 = 250, 90, 950, 1120
sh = Image.new('L', (W, H), 0); ImageDraw.Draw(sh).rectangle([px0 + 18, py0 + 26, px1 + 18, py1 + 26], fill=150)
im.paste((20, 14, 10), (0, 0), sh.filter(ImageFilter.GaussianBlur(24)))
d = ImageDraw.Draw(im); d.rectangle([px0, py0, px1, py1], fill=(246, 243, 236))
L = []; ink = (40, 38, 36); cx = (px0 + px1) // 2
put(d, (cx, 200), 'CAFÉ LUMEN', F('700Bold', 64), ink, L, 'ma')
put(d, (cx, 290), '14 Harbour Street · Vancouver', F('400Regular', 30), ink, L, 'ma')
put(d, (cx, 335), 'Nov 08 2026  10:42', F('400Regular', 30), ink, L, 'ma')
y = 440
for item, price in [('2 x Flat white coffee', '9.80'), ('Almond croissant', '4.60'), ('Sparkling water', '4.00')]:
    put(d, (px0 + 60, y), item, F('400Regular', 36), ink, L); put(d, (px1 - 60, y), price, F('400Regular', 36), ink, L, 'ra'); y += 70
d.line([(px0 + 60, y + 10), (px1 - 60, y + 10)], fill=(150, 145, 138), width=2); y += 50
put(d, (px0 + 60, y), 'TOTAL', F('700Bold', 44), ink, L); put(d, (px1 - 60, y), '$18.40', F('700Bold', 44), ink, L, 'ra'); y += 110
put(d, (cx, y), 'Paid by card · Thank you!', F('400Regular', 30), ink, L, 'ma')
put(d, (cx, y + 60), 'Wi-Fi: lumen-guest', F('400Regular', 30), ink, L, 'ma')
im.save(f'{out}/IMG_2001.jpg', quality=90)
record('IMG_2001.jpg', im, L, ['receipt', 'paper', 'document', 'table'])

# 2. Sticky note on a desk.
W, H = 1200, 1200
im = Image.new('RGB', (W, H), (205, 200, 190)); d = ImageDraw.Draw(im)
for i in range(4000):
    x, y = random.randint(0, W), random.randint(0, H); c = random.randint(190, 215); d.point((x, y), fill=(c, c - 4, c - 12))
sh = Image.new('L', (W, H), 0); ImageDraw.Draw(sh).rectangle([300, 300, 920, 920], fill=120)
im.paste((120, 110, 90), (0, 0), sh.filter(ImageFilter.GaussianBlur(26)))
d = ImageDraw.Draw(im); d.rectangle([280, 270, 900, 890], fill=(252, 226, 120))
L = []; ink = (40, 50, 90)
put(d, (330, 340), 'Studio Wi-Fi', F('600SemiBold', 58), ink, L)
put(d, (330, 450), 'network: northlight-5G', F('400Regular', 40), ink, L)
put(d, (330, 520), 'password: maple-river-42', F('400Regular', 40), ink, L)
put(d, (330, 650), 'Dentist Tue 3:30 pm', F('400Regular', 40), ink, L)
put(d, (330, 720), 'Call Mina re: lease', F('400Regular', 40), ink, L)
im.save(f'{out}/IMG_2002.jpg', quality=90)
record('IMG_2002.jpg', im, L, ['paper', 'note', 'desk'])

# 3. Phone screenshot of a booking confirmation (PNG, so the Screenshots filter finds it).
W, H = 1179, 2556
im = Image.new('RGB', (W, H), (247, 248, 250)); d = ImageDraw.Draw(im)
d.rectangle([0, 0, W, 360], fill=(32, 76, 160))
L = []
put(d, (80, 200), 'Booking confirmed', F('700Bold', 72), (255, 255, 255), L)
d.rounded_rectangle([60, 430, W - 60, 1180], 40, fill=(255, 255, 255), outline=(225, 228, 235), width=3)
put(d, (120, 500), 'Booking reference', F('400Regular', 40), (110, 115, 125), L)
put(d, (120, 560), 'K7Q2ZP', F('700Bold', 84), (20, 24, 32), L)
put(d, (120, 720), 'Seoul ICN  →  Vancouver YVR', F('600SemiBold', 50), (20, 24, 32), L)
put(d, (120, 800), 'Fri, Dec 18 · 19:40', F('400Regular', 42), (90, 95, 105), L)
put(d, (120, 900), 'Passenger: KIM / MINA', F('400Regular', 42), (90, 95, 105), L)
put(d, (120, 980), 'Seat 32A · Economy', F('400Regular', 42), (90, 95, 105), L)
d.rounded_rectangle([60, 1260, W - 60, 1420], 40, fill=(32, 76, 160))
put(d, (W // 2, 1340), 'Add to Wallet', F('600SemiBold', 48), (255, 255, 255), L, 'mm')
im.save(f'{out}/IMG_2003.png')
record('IMG_2003.png', im, L, ['screen', 'website', 'phone'])

json.dump(notes, open(f'{out}/notes.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok', list(notes))
