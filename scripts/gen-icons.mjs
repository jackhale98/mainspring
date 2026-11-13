// SPDX-License-Identifier: GPL-2.0-or-later
// npm run gen:icons: renders the web manifest's PNG icons from the brand mark, in its bold small
// form (the full form's hairline hairspring is lost at home-screen size),
// (src/lib/brand/mark.ts) in headless Chromium and writes them to public/icons/. Run it after a
// change to the mark; the PNGs are committed. src/lib/brand/manifest.test.ts checks their sizes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { APP_ICON, APP_ICON_MASKABLE, FAVICON_LIGHT, markSvg } from '../src/lib/brand/mark.ts';

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });

const icons = [
	{ file: 'icon-192.png', size: 192, tile: APP_ICON },
	{ file: 'icon-512.png', size: 512, tile: APP_ICON },
	{ file: 'icon-maskable-512.png', size: 512, tile: APP_ICON_MASKABLE },
	{ file: 'apple-touch-icon.png', size: 180, tile: APP_ICON },
];

const launchOptions = process.env.CHROMIUM_PATH
	? { executablePath: process.env.CHROMIUM_PATH }
	: {};
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { file, size, tile } of icons) {
	await page.setViewportSize({ width: size, height: size });
	const svg = markSvg('small', FAVICON_LIGHT, undefined, tile).replace(
		'<svg ',
		`<svg width="${size}" height="${size}" `,
	);
	await page.setContent(`<!doctype html><style>*{margin:0}</style>${svg}`);
	writeFileSync(new URL(file, out), await page.screenshot({ type: 'png' }));
	console.log(`wrote public/icons/${file}`);
}
await browser.close();
