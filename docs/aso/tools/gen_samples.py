# Draws simple landscape pictures for store screenshots (no real photos). Usage: python3 gen_samples.py <outDir>
import sys, random, math
from PIL import Image, ImageDraw, ImageFilter
out=sys.argv[1]; random.seed(7)
pal=[((246,160,90),(250,220,150),(150,90,110),(90,50,100)),((110,160,220),(230,240,250),(60,100,70),(40,80,55)),
((40,40,80),(120,110,150),(20,40,40),(10,25,30)),((60,130,140),(200,230,220),(50,100,110),(30,70,80)),
((220,170,90),(250,230,160),(150,110,70),(90,70,50)),((230,140,120),(60,40,90),(200,110,100),(40,30,70)),
((170,190,210),(250,245,235),(140,150,160),(90,100,110)),((150,150,200),(250,200,190),(80,70,110),(40,40,70))]
def grad(d,W,H,top,bot):
  for y in range(H):
    t=y/H; d.line([(0,y),(W,y)],fill=tuple(int(top[i]*(1-t)+bot[i]*t) for i in range(3)))
for k in range(22):
  W=H=1200; im=Image.new('RGB',(W,H)); d=ImageDraw.Draw(im)
  top,glow,m1,m2=pal[k%len(pal)]; grad(d,W,H,top,glow)
  sx,sy=random.randint(250,950),random.randint(250,600); r=random.randint(70,130)
  sun=Image.new('RGBA',(W,H),(0,0,0,0)); sd=ImageDraw.Draw(sun)
  for g in range(6,0,-1): sd.ellipse([sx-r*g*0.6,sy-r*g*0.6,sx+r*g*0.6,sy+r*g*0.6],fill=(255,245,220,18))
  sd.ellipse([sx-r,sy-r,sx+r,sy+r],fill=(255,240,200,255)); im.paste(sun,(0,0),sun)
  kind=k%4
  for layer,col in enumerate((m1,m2)):
    base=650+layer*170; pts=[(0,H)]
    amp=random.randint(80,220); f=random.uniform(1.5,3.5); ph=random.random()*6
    for x in range(0,W+20,20):
      yy=base-amp*abs(math.sin(x/W*f*math.pi+ph)) if kind!=1 else base+20*math.sin(x/90+ph)
      pts.append((x,yy))
    pts.append((W,H)); d.polygon(pts,fill=col)
  if kind==2:
    for i in range(14):
      x=i*90+random.randint(-10,10); h=random.randint(250,560); d.rectangle([x,1000-h,x+70,1000],fill=(55,60,75))
      for wy in range(1000-h+20,990,40):
        for wx in (x+12,x+40):
          if random.random()<0.4: d.rectangle([wx,wy,wx+14,wy+18],fill=(240,210,120))
  if kind==3:
    for i in range(40):
      x=random.randint(0,W); h=random.randint(150,320); d.polygon([(x-30,1200),(x,1200-h),(x+30,1200)],fill=(20,35,35))
  if k in (5,): im=im.filter(ImageFilter.GaussianBlur(60))
  im.save(f'{out}/IMG_{1000+k}.jpg',quality=88)
