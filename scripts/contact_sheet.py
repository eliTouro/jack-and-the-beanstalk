"""Builds a side-by-side sheet per test face: photo | cartoon | plant | climb.

    python scripts/contact_sheet.py final         # reads test-results/<face>-storybook-final-*.jpg
Writes test-results/sheets/<tag>-<face>.jpg (full size) and thumbs for TESTING.md.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

tag = sys.argv[1] if len(sys.argv) > 1 else 'final'
root = Path(__file__).resolve().parent.parent
out = root / 'test-results' / 'sheets'
out.mkdir(parents=True, exist_ok=True)
H = 512


def fit(path):
    im = Image.open(path).convert('RGB')
    return im.resize((round(im.width * H / im.height), H))


for n in range(1, 8):
    face = f'face-{n}'
    paths = [
        ('photo', root / 'test-faces' / f'{face}.jpg'),
        ('cartoon', root / 'test-results' / f'{face}-storybook-{tag}-cartoon.jpg'),
        ('plant', root / 'test-results' / f'{face}-storybook-{tag}-plant.jpg'),
        ('climb', root / 'test-results' / f'{face}-storybook-{tag}-climb.jpg'),
    ]
    tiles = [(label, fit(p)) for label, p in paths if p.exists()]
    if len(tiles) < 2:
        continue
    sheet = Image.new('RGB', (sum(t.width for _, t in tiles) + 6 * (len(tiles) - 1), H), 'white')
    x = 0
    for label, t in tiles:
        sheet.paste(t, (x, 0))
        ImageDraw.Draw(sheet).text((x + 8, 8), label, fill='white', stroke_width=2, stroke_fill='black')
        x += t.width + 6
    sheet.save(out / f'{tag}-{face}.jpg', quality=82)
    print('wrote', out / f'{tag}-{face}.jpg', sheet.size)
