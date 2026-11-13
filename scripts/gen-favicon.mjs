// SPDX-License-Identifier: GPL-2.0-or-later
// npm run gen:favicon: writes public/favicon.svg, the small form of the brand mark with the light
// and dark theme colours (src/lib/brand/mark.ts). src/lib/brand/mark.test.ts checks it is current.
import { writeFileSync } from 'node:fs';
import { FAVICON_DARK, FAVICON_LIGHT, markSvg } from '../src/lib/brand/mark.ts';

writeFileSync(
	new URL('../public/favicon.svg', import.meta.url),
	markSvg('small', FAVICON_LIGHT, FAVICON_DARK),
);
console.log('wrote public/favicon.svg');
