# Draws the made-up cafe receipt used to show photo search, and its search note (OCR lines + labels).
# Usage: run from a work folder that has a samples/ subfolder: python3 make_receipt.py  -> samples/receipt.jpg, receipt_note.json
import json, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont
random.seed(3)
W=H=1200
# wood table
im=Image.new('RGB',(W,H),(120,80,50)); d=ImageDraw.Draw(im)
for y in range(0,H,3):
    c=random.randint(-18,18); d.line([(0,y),(W,y+random.randint(-4,4))],fill=(118+c,78+c//2,48+c//3),width=3)
im=im.filter(ImageFilter.GaussianBlur(2))
# coffee cup hint
d=ImageDraw.Draw(im)
d.ellipse([820,90,1160,430],fill=(235,232,226)); d.ellipse([860,130,1120,390],fill=(92,58,34)); d.ellipse([900,170,1080,350],fill=(150,105,70))
mono=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',30)
bold=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',40)
rx,ry,rw,rh=260,140,520,960
sh=Image.new('L',(W,H),0); ImageDraw.Draw(sh).rectangle([rx+14,ry+18,rx+rw+14,ry+rh+18],fill=120)
sh=sh.filter(ImageFilter.GaussianBlur(18)); im.paste((40,25,15),(0,0),sh)
d=ImageDraw.Draw(im); d.rectangle([rx,ry,rx+rw,ry+rh],fill=(250,248,242))
lines=[('BLUE HARBOR CAFE',bold,'c'),('12 Harbor Lane, Seaview',mono,'c'),('',mono,'l'),
 ('Flat white        5.25',mono,'l'),('Almond croissant  4.75',mono,'l'),('Sparkling water   3.00',mono,'l'),
 ('------------------------',mono,'l'),('TOTAL       13.00',bold,'l'),('',mono,'l'),
 ('Guest Wi-Fi',bold,'c'),('Network: harbor-guest',mono,'c'),('Password: sunrise2026',mono,'c'),('',mono,'l'),('Thank you!',mono,'c')]
y=ry+50; out=[]; text=[]
for s,f,a in lines:
    if s:
        tw=d.textlength(s,font=f); x=rx+(rw-tw)/2 if a=='c' else rx+40
        d.text((x,y),s,font=f,fill=(35,35,40))
        bb=d.textbbox((x,y),s,font=f)
        out.append({'t':s,'b':[round(bb[0]/W,4),round(bb[1]/H,4),round((bb[2]-bb[0])/W,4),round((bb[3]-bb[1])/H,4)]}); text.append(s)
    y+=f.size+26
im=im.filter(ImageFilter.GaussianBlur(0.6))
im.save('samples/receipt.jpg',quality=90)
json.dump({'v':1,'engine':'vision','w':W,'h':H,'text':'\n'.join(text),'lines':out,'labels':['receipt','document','paper','text','table','coffee']},open('receipt_note.json','w'))
print('ok')
