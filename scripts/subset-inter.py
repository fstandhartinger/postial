"""Regenerate bundled Latin Inter with fonttools[woff] (no runtime downloads).

Install into a temporary venv and run from the repository root:
python -m pip install 'fonttools[woff]'
python scripts/subset-inter.py
The original InterVariable.woff2 and its OFL remain under public/fonts.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

for weight in (400, 500, 600, 700):
    font = TTFont('public/fonts/InterVariable.woff2')
    font = instantiateVariableFont(font, {'wght': weight, 'opsz': 14}, inplace=True)
    options = subset.Options()
    options.flavor = 'woff2'
    options.hinting = False
    options.layout_features = ['kern', 'liga']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=list(range(0x20, 0x100)) + list(range(0x2000, 0x2070))
                       + [0x20ac, 0x2122, 0x2190, 0x2192])
    subsetter.subset(font)
    path = Path(f'public/fonts/Inter-latin-{weight}.woff2')
    font.save(path)
    print(f'{path.name}: {path.stat().st_size} bytes')
