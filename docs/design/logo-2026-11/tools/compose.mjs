// SPDX-License-Identifier: GPL-2.0-or-later
// Logo exploration (docs/design/logo-2026-11): the comparison sheets, the browser-tab mock and the
// phone home-screen mock. Run after build.mjs, shoot.mjs and crop.py.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { FAVICON_DARK, FAVICON_LIGHT, markSvg } from '../../../../src/lib/brand/mark.ts';
import * as M from './marks.mjs';

const root = new URL('../', import.meta.url).pathname;
const repo = new URL('../../../../', import.meta.url).pathname;
const scratch = process.env.LOGO_SCRATCH ?? '/tmp';
mkdirSync(`${root}mockups`, { recursive: true });

const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOptions);

const VARS = [
	{ key: 'current', label: 'Current', sub: 'watch dial, jewel' },
	{ key: 'a-flow', label: 'A  Flow', sub: 'ribbon knot' },
	{ key: 'b-spring', label: 'B  Spring', sub: 'ribbon and coil' },
];
const TH = {
	light: { bg: M.PALETTE.light.paper, ink: '#1C1A17', muted: '#625B4F', line: '#E6E0D2', tile: M.PALETTE.light.tile },
	dark: { bg: M.PALETTE.dark.paper, ink: '#EEE7D7', muted: '#A9A291', line: '#2A3243', tile: M.PALETTE.dark.tile },
};

// ---- baseline (current) assets -------------------------------------------------------------------
const cur = {
	'full-light': markSvg('full', FAVICON_LIGHT),
	'full-dark': markSvg('full', FAVICON_DARK),
	'small-light': markSvg('small', FAVICON_LIGHT),
	'small-dark': markSvg('small', FAVICON_DARK),
};
const rendered = {};
async function raster(svg, size, file) {
	const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: size, height: size } });
	await page.setContent(
		`<!doctype html><style>*{margin:0}html,body{background:transparent}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`,
	);
	writeFileSync(file, await page.screenshot({ type: 'png', omitBackground: true }));
	await page.close();
}
for (const theme of ['light', 'dark']) {
	for (const size of [16, 32]) {
		await raster(cur[`small-${theme}`], size, `${root}png/current-favicon-${size}${theme === 'dark' ? '-dark' : ''}.png`);
	}
}
const rel = (p) => `file://${root}${p}`;
const asset = (key, what, theme) => {
	const sfx = theme === 'dark' ? '-dark' : '';
	switch (what) {
		case 'full':
			return key === 'current'
				? `data:image/svg+xml;base64,${Buffer.from(cur[`full-${theme}`]).toString('base64')}`
				: rel(`svg/${key}-full-${theme}.svg`);
		case 'fav32':
			return rel(`png/${key}-favicon-32${sfx}.png`);
		case 'fav16':
			return rel(`png/${key}-favicon-16${sfx}.png`);
		case 'icon':
			return key === 'current' ? `file://${repo}public/icons/icon-512.png` : rel(`png/${key}-icon-maskable-512${sfx}.png`);
		case 'apple':
			return key === 'current' ? `file://${repo}public/icons/apple-touch-icon.png` : rel(`png/${key}-apple-touch-180${sfx}.png`);
		case 'maskable':
			return key === 'current' ? `file://${repo}public/icons/icon-maskable-512.png` : rel(`png/${key}-icon-maskable-512${sfx}.png`);
		case 'bar':
			return rel(`mockups/raw/${key === 'current' ? 'current' : key[0]}-${theme}-desktop-topbar-left.png`);
	}
}

async function shoot(html, file, w, h, dsf) {
	const page = await browser.newPage({ deviceScaleFactor: dsf, viewport: { width: w, height: h } });
	// a file page, so that file: images load
	const tmp = `${scratch}/compose-${Date.now()}.html`;
	writeFileSync(tmp, html);
	await page.goto(`file://${tmp}`);
	await page.waitForTimeout(300);
	await page.screenshot({ path: file, fullPage: true });
	await page.close();
	console.log('wrote', file);
}

// ---- comparison sheets (one per theme) ----------------------------------------------------------
for (const theme of ['light', 'dark']) {
	const t = TH[theme];
	const cell = (inner, w) => `<td style="width:${w}px">${inner}</td>`;
	const rows = VARS.map((v) => {
		const k = v.key;
		const zoom = (what, px) =>
			`<img src="${asset(k, what, theme)}" style="width:${px * 4}px;height:${px * 4}px;image-rendering:pixelated;outline:1px dashed ${t.line}">`;
		const actual = (what, px) => `<img src="${asset(k, what, theme)}" width="${px}" height="${px}">`;
		return `<tr>
		<th><b>${v.label}</b><br><span>${v.sub}</span></th>
		${cell(`<img src="${asset(k, 'full', theme)}" style="width:230px;height:230px;object-fit:contain">`, 250)}
		${cell(`<div class="pair">${actual('fav32', 32)}${zoom('fav32', 32)}</div>`, 190)}
		${cell(`<div class="pair">${actual('fav16', 16)}${zoom('fav16', 16)}</div>`, 130)}
		${cell(`<img src="${asset(k, 'icon', theme)}" style="width:150px;height:150px;border-radius:33px">`, 170)}
		${cell(`<img src="${asset(k, 'bar', theme)}" style="width:350px;image-rendering:auto;border:1px solid ${t.line};border-radius:12px">`, 370)}
		</tr>`;
	}).join('');
	const html = `<!doctype html><meta charset="utf-8"><style>
		body{margin:0;padding:28px;background:${t.bg};color:${t.ink};font:14px Inter,system-ui,sans-serif}
		h1{font:600 18px Inter,system-ui,sans-serif;margin:0 0 4px} p{margin:0 0 18px;color:${t.muted}}
		table{border-collapse:collapse} td,th{padding:14px 18px;vertical-align:middle;border-top:1px solid ${t.line};text-align:center}
		th{text-align:left;width:110px;font-weight:400} th span{color:${t.muted};font-size:12px}
		thead th{border-top:0;color:${t.muted};font-size:12px;text-transform:uppercase;letter-spacing:.06em;text-align:center;padding-bottom:8px}
		.pair{display:flex;gap:18px;align-items:center;justify-content:center}
	</style>
	<h1>Mainspring logo exploration, ${theme} theme</h1>
	<p>Actual size, and the same pixels at 4x, for the 32 px and 16 px marks. The app icon is the maskable tile.</p>
	<table><thead><tr><th></th><th>Full mark</th><th>32 px</th><th>16 px</th><th>App icon</th><th>Top bar (26 px slot)</th></tr></thead>${rows}</table>`;
	await shoot(html, `${root}mockups/comparison-${theme}.png`, 1420, 900, 2);
}

// ---- browser tab mock ----------------------------------------------------------------------------
{
	const strip = (theme) => {
		const dark = theme === 'dark';
		const chrome = dark ? '#202124' : '#DEE1E6';
		const tab = dark ? '#35363A' : '#FFFFFF';
		const txt = dark ? '#E8EAED' : '#202124';
		const sub = dark ? '#9AA0A6' : '#5F6368';
		return VARS.map((v) => `
		<div class="row" style="background:${chrome}">
			<div class="lbl" style="color:${sub}">${v.label}</div>
			<div class="tab" style="background:${tab};color:${txt}"><img src="${asset(v.key, 'fav16', theme)}" width="16" height="16"><span>Mainspring</span><i style="color:${sub}">&#215;</i></div>
			<div class="tab off" style="color:${sub}"><span>New tab</span></div>
			<div class="pin" style="background:${dark ? '#303134' : '#fff'}"><img src="${asset(v.key, 'fav32', theme)}" width="32" height="32"></div>
			<div class="note" style="color:${sub}">16 px tab, 32 px shortcut tile</div>
		</div>`).join('');
	};
	const html = `<!doctype html><meta charset="utf-8"><style>
		body{margin:0;display:flex;flex-direction:column;font:13px system-ui,sans-serif;width:900px}
		.row{display:flex;align-items:flex-end;gap:8px;padding:10px 12px 0;height:64px;box-sizing:border-box;border-bottom:1px solid #8884}
		.lbl{width:74px;align-self:center;font-size:12px}
		.tab{display:flex;align-items:center;gap:8px;width:200px;height:34px;padding:0 12px;border-radius:9px 9px 0 0;box-sizing:border-box}
		.tab span{flex:1} .tab.off{width:130px;background:transparent}
		.tab i{font-style:normal;font-size:16px}
		.pin{align-self:center;margin-left:30px;width:56px;height:56px;border-radius:50%;display:grid;place-items:center;box-shadow:0 1px 3px #0003}
		.note{align-self:center;margin-left:14px;font-size:12px}
		.hd{padding:8px 12px;font-weight:600;background:#fff;color:#000} .hd.d{background:#000;color:#fff}
	</style>
	<div class="hd">Light browser chrome</div>${strip('light')}<div class="hd d">Dark browser chrome</div>${strip('dark')}`;
	await shoot(html, `${root}mockups/tabs-favicon.png`, 900, 500, 1);
}

// ---- phone home-screen mock ----------------------------------------------------------------------
{
	const placeholders = [
		['#7FA37F', 'Notes'], ['#C98C6B', 'Maps'], ['#6F8FB8', 'Mail'], ['#B8A06F', 'Clock'],
		['#9A7FB8', 'Photos'], ['#6FB8AE', 'Music'], ['#B86F7F', 'Files'],
	];
	const phone = (theme, v) => {
		const dark = theme === 'dark';
		const wall = dark ? 'linear-gradient(160deg,#10223f,#1b1335 60%,#0a0f1c)' : 'linear-gradient(160deg,#f3c9a7,#e9a6b5 55%,#a9b8e8)';
		const lab = '#fff';
		const sq = (c, name) => `<div class="app"><div class="ic" style="background:${c}"></div><span>${name}</span></div>`;
		const ours = (what, shape) => `<div class="app"><img class="ic" src="${asset(v.key, what, theme)}" style="border-radius:${shape}"><span>Mainspring</span></div>`;
		const cells = [
			sq(placeholders[0][0], placeholders[0][1]), sq(placeholders[1][0], placeholders[1][1]), ours('apple', '14px'), sq(placeholders[2][0], placeholders[2][1]),
			sq(placeholders[3][0], placeholders[3][1]), ours('maskable', '50%'), sq(placeholders[4][0], placeholders[4][1]), sq(placeholders[5][0], placeholders[5][1]),
		];
		return `<div class="phone" style="background:${wall}">
			<div class="cap" style="color:${lab}"><b>${v.label}</b><br>${dark ? 'dark wallpaper' : 'light wallpaper'}; iOS tile, Android circle</div>
			<div class="grid">${cells.join('')}</div></div>`;
	};
	const html = `<!doctype html><meta charset="utf-8"><style>
		body{margin:0;padding:18px;background:#777;display:grid;grid-template-columns:repeat(3,300px);gap:16px;font:11px system-ui,sans-serif}
		.phone{border-radius:28px;height:330px;padding:16px;box-sizing:border-box;position:relative;overflow:hidden}
		.cap{font-size:11px;line-height:1.35;text-shadow:0 1px 2px #0006;margin-bottom:18px} .cap b{font-size:13px}
		.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px 6px}
		.app{display:flex;flex-direction:column;align-items:center;gap:5px;color:#fff;text-shadow:0 1px 2px #0007;font-size:10px}
		.ic{width:56px;height:56px;border-radius:14px;box-shadow:0 1px 4px #0004;display:block}
	</style>${['light', 'dark'].map((th) => VARS.map((v) => phone(th, v)).join('')).join('')}`;
	await shoot(html, `${root}mockups/homescreen-icons.png`, 960, 740, 2);
}

await browser.close();
void scratch;
void readFileSync;
