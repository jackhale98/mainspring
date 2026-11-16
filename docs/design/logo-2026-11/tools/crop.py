# SPDX-License-Identifier: GPL-2.0-or-later
# Logo exploration: crops the raw app screenshots into the named mockups (run after shoot.mjs).
import os
from PIL import Image

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'mockups')
raw = os.path.join(root, 'raw')

for v in ['current', 'a', 'b']:
    for theme in ['light', 'dark']:
        d = Image.open(f'{raw}/{v}-{theme}-desktop-app.png')  # 2880 x 1800
        d.crop((0, 0, 2880, 130)).save(f'{root}/{v}-{theme}-desktop-topbar.png', optimize=True)
        d.crop((0, 0, 700, 130)).save(f'{raw}/{v}-{theme}-desktop-topbar-left.png', optimize=True)
        p = Image.open(f'{raw}/{v}-{theme}-phone-app.png')
        p.crop((0, 0, p.width, 215)).save(f'{root}/{v}-{theme}-phone-topbar.png', optimize=True)
        Image.open(f'{raw}/{v}-{theme}-desktop-landing.png').save(
            f'{root}/{v}-{theme}-desktop-landing.png', optimize=True)
        Image.open(f'{raw}/{v}-{theme}-phone-landing.png').save(
            f'{root}/{v}-{theme}-phone-landing.png', optimize=True)
print('ok')
