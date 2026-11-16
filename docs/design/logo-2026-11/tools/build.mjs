// SPDX-License-Identifier: GPL-2.0-or-later
// Logo exploration (docs/design/logo-2026-11): writes svg/ and the icon and favicon PNGs.
// Run from the repo root with the project's node_modules: node docs/design/logo-2026-11/tools/build.mjs
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { chromium } from '@playwright/test';
import * as M from './marks.mjs';

const root = new URL('../', import.meta.url).pathname;
mkdirSync(`${root}svg`, { recursive: true });
mkdirSync(`${root}png`, { recursive: true });

export const VERSIONS = {
	a: { id: 'a-flow', full: M.markAFull, small: M.markASmall },
	b: { id: 'b-spring', full: M.markBFull, small: M.markBSmall },
};

/** An app icon: the full mark centred on a full-bleed tile. `frac` is the mark's width as a
 * fraction of the tile. 0.60 keeps every point of both marks inside the 80% maskable safe circle. */
export function iconSvg(v, theme, frac) {
	const c = M.PALETTE[theme];
	const inner = v.full(c, {});
	const H = Number(/viewBox="0 0 120 ([\d.]+)"/.exec(inner)[1]);
	const w = 120 * frac;
	const h = H * frac;
	const nested = inner.replace(
		'<svg xmlns="http://www.w3.org/2000/svg" ',
		`<svg x="${(120 - w) / 2}" y="${Math.round(((120 - h) / 2) * 100) / 100}" width="${w}" height="${Math.round(h * 100) / 100}" `,
	);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${c.tile}"/>${nested}</svg>`;
}

/** The favicon: the small form, recoloured by the browser's colour scheme. */
export function faviconSvg(v) {
	const L = M.PALETTE.light;
	const D = M.PALETTE.dark;
	return v
		.small(L, { margin: 3 })
		.replace(` stroke="${L.band}"`, '')
		.replace(
			'<path ',
			`<style>path{stroke:${L.band}}@media (prefers-color-scheme:dark){path{stroke:${D.band}}}</style><path `,
		);
}

const files = {};
for (const v of Object.values(VERSIONS)) {
	for (const theme of ['light', 'dark']) {
		const c = M.PALETTE[theme];
		files[`svg/${v.id}-full-${theme}.svg`] = v.full(c, {});
		files[`svg/${v.id}-small-${theme}.svg`] = v.small(c, { margin: 3 });
		files[`svg/${v.id}-icon-${theme}.svg`] = iconSvg(v, theme, 0.6);
	}
	files[`svg/${v.id}-favicon.svg`] = faviconSvg(v);
}
for (const [name, svg] of Object.entries(files)) writeFileSync(root + name, svg + '\n');

// ---- PNGs ----------------------------------------------------------------------------------------
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg, size, file, transparent = false) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<!doctype html><style>*{margin:0}html,body{background:transparent}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`,
	);
	writeFileSync(root + file, await page.screenshot({ type: 'png', omitBackground: transparent }));
}

for (const v of Object.values(VERSIONS)) {
	for (const theme of ['light', 'dark']) {
		const sfx = theme === 'dark' ? '-dark' : '';
		const c = M.PALETTE[theme];
		await render(iconSvg(v, theme, 0.6), 512, `png/${v.id}-icon-maskable-512${sfx}.png`);
		await render(iconSvg(v, theme, 0.6), 192, `png/${v.id}-icon-maskable-192${sfx}.png`);
		await render(iconSvg(v, theme, 0.72), 180, `png/${v.id}-apple-touch-180${sfx}.png`);
		const small = v.small(c, { margin: 3 });
		await render(small, 32, `png/${v.id}-favicon-32${sfx}.png`, true);
		await render(small, 16, `png/${v.id}-favicon-16${sfx}.png`, true);
	}
}
await browser.close();

for (const name of Object.keys(files)) console.log(name, statSync(root + name).size, 'bytes');
