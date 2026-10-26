"""Side-by-side sheet for one child's book: photo | reference | page 1 | page 2 | page 3.

    python scripts/book_sheet.py child-1 v1        -> test-results/book/sheet-child-1-v1.jpg
Pages are shown with their text zone outlined, to check the zone was kept clear.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

face, tag = sys.argv[1], sys.argv[2]
root = Path(__file__).resolve().parent.parent
book = root / 'test-results' / 'book'
H = 600
ZONES = {'cupboard': 'bottom', 'trade': 'top', 'window': 'bottom'}


def fit(path):
    im = Image.open(path).convert('RGB')
    return im.resize((round(im.width * H / im.height), H))


tiles = [fit(root / 'test-faces' / f'{face}.jpg'), fit(book / f'{face}-{tag}-reference.jpg')]
for page, zone in ZONES.items():
    p = book / f'{face}-{tag}-{page}.jpg'
    if not p.exists():
        continue
    im = fit(p)
    d = ImageDraw.Draw(im)
    y0, y1 = (0, H // 3) if zone == 'top' else (H - H // 3, H - 1)
    d.rectangle([1, y0, im.width - 2, y1], outline=(255, 60, 60), width=3)
    tiles.append(im)

sheet = Image.new('RGB', (sum(t.width for t in tiles) + 8 * (len(tiles) - 1), H), 'white')
x = 0
for t in tiles:
    sheet.paste(t, (x, 0))
    x += t.width + 8
out = book / f'sheet-{face}-{tag}.jpg'
sheet.save(out, quality=82)
print(out, sheet.size)
