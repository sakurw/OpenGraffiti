"""Build a local source-selection diagnostic, never a registration or evidence mask."""
import argparse, json, pathlib
from PIL import Image, ImageOps, ImageDraw

root = pathlib.Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--ids', nargs='*')
p.add_argument('--output', default='data/texture-city/commons/contact-sheet.jpg')
p.add_argument('--crop', nargs=4, type=int, help='Crop in 900px-wide annotation coordinates; one source only')
p.add_argument('--reference-width',type=int,default=900)
a = p.parse_args()
folder = root / 'data/texture-city/photos/commons'
photos = [folder / f'{i}.jpg' for i in a.ids] if a.ids else sorted(folder.glob('*.jpg'))
if a.crop:
    assert len(photos) == 1
    photo = Image.open(photos[0]).convert('RGB')
    photo = photo.resize((a.reference_width, round(photo.height*a.reference_width/photo.width)))
    left, top, width, height = a.crop
    sheet = photo.crop((left,top,left+width,top+height)).resize((width*2,height*2))
    draw = ImageDraw.Draw(sheet)
    for x in range((left//50+1)*50,left+width,50):
        draw.line(((x-left)*2,0,(x-left)*2,height*2),fill=(70,120,180),width=1)
        draw.text(((x-left)*2+2,3),str(x),fill='red')
    for y in range((top//50+1)*50,top+height,50):
        draw.line((0,(y-top)*2,width*2,(y-top)*2),fill=(70,120,180),width=1)
        draw.text((2,(y-top)*2+2),str(y),fill='red')
    out = root/a.output
    out.parent.mkdir(parents=True,exist_ok=True)
    sheet.save(out)
    print(out)
    raise SystemExit(0)
w, h, cols = 400, 550, 4
sheet = Image.new('RGB', (w * cols, h * ((len(photos) + cols - 1) // cols)), 'white')
draw = ImageDraw.Draw(sheet)
for i, path in enumerate(photos):
    meta = json.loads(path.with_suffix('.json').read_text(encoding='utf8'))
    photo = ImageOps.contain(Image.open(path).convert('RGB'), (w-8, h-64))
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(photo, (x + (w-photo.width)//2, y+55))
    draw.text((x+6,y+5), path.stem + ' / ' + str(meta.get('captureDate',''))[:10], fill='black')
    draw.text((x+6,y+22), meta.get('title','')[:50], fill='black')
    draw.text((x+6,y+38), str(meta.get('candidateLocation')), fill='black')
out = root / a.output
out.parent.mkdir(parents=True, exist_ok=True)
sheet.save(out)
print(out)
