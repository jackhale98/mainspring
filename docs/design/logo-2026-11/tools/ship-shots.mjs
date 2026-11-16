// SPDX-License-Identifier: GPL-2.0-or-later
// Evidence for the shipped Spring mark: screenshots of the real build (top bar, landing page, desktop
// at 2x, Pixel 7 and a 360 px phone), a favicon tab mock and a home-screen mock made from the files
// in public/. Usage: serve the built dist/ (python3 -m http.server 4412 -d dist) and run
//   node docs/design/logo-2026-11/tools/ship-shots.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const repo = new URL('../../../../', import.meta.url).pathname;
const out = `${repo}docs/phases/screenshots/phase-3/`;
const base = process.env.SHOT_BASE ?? 'http://127.0.0.1:4412/';
const scratch = process.env.LOGO_SCRATCH ?? '/tmp';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
	process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

const setups = {
	desktop: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, bar: 65 },
	pixel7: { ...devices['Pixel 7'], bar: 82 },
	phone360: {
		...devices['Pixel 7'],
		viewport: { width: 360, height: 780 },
		screen: { width: 360, height: 780 },
		deviceScaleFactor: 3,
		bar: 82,
	},
};

for (const [name, { bar, ...opts }] of Object.entries(setups)) {
	for (const theme of ['light', 'dark']) {
		if (name === 'phone360' && theme === 'dark') continue;
		const ctx = await browser.newContext({ ...opts, colorScheme: theme, reducedMotion: 'reduce' });
		const page = await ctx.newPage();
		const file = (what) => `${out}logo-b-${name}-${theme}-${what}.png`;
		if (name !== 'phone360') {
			await page.goto(base, { waitUntil: 'networkidle' });
			await page.evaluate(() => document.fonts.ready);
			await page.waitForTimeout(500);
			await page.screenshot({ path: file('landing') });
		}
		await page.goto(`${base}app/`, { waitUntil: 'load' });
		await page.waitForSelector('.topbar', { state: 'attached' });
		await page.waitForTimeout(4000);
		const w = page.viewportSize().width;
		await page.screenshot({ path: file('topbar'), clip: { x: 0, y: 0, width: w, height: bar } });
		await ctx.close();
		console.log('shot', name, theme);
	}
}

// ---- the shipped icon files, rendered as a tab and a launcher would ------------------------------
// the svg's own size is its viewBox; wrap it in a page so it renders at 16 and 32 px
const favPng = async (theme, size) => {
	const ctx = await browser.newContext({ colorScheme: theme, viewport: { width: size, height: size } });
	const page = await ctx.newPage();
	writeFileSync(
		`${scratch}/fav-wrap.html`,
		`<!doctype html><style>*{margin:0}html,body{background:transparent}</style><img src="file://${repo}public/favicon.svg" width="${size}" height="${size}">`,
	);
	await page.goto(`file://${scratch}/fav-wrap.html`);
	await page.waitForTimeout(200);
	const file = `${scratch}/fav-${theme}-${size}.png`;
	writeFileSync(file, await page.screenshot({ omitBackground: true }));
	await ctx.close();
	return `file://${file}`;
};

async function shoot(html, file, w, h, dsf) {
	const tmp = `${scratch}/ship-${Date.now()}.html`;
	writeFileSync(tmp, html);
	const page = await browser.newPage({ deviceScaleFactor: dsf, viewport: { width: w, height: h } });
	await page.goto(`file://${tmp}`);
	await page.waitForTimeout(300);
	await page.screenshot({ path: file, fullPage: true });
	await page.close();
	console.log('wrote', file);
}

{
	const row = async (theme) => {
		const dark = theme === 'dark';
		const chrome = dark ? '#202124' : '#DEE1E6';
		const tab = dark ? '#35363A' : '#FFFFFF';
		const txt = dark ? '#E8EAED' : '#202124';
		const sub = dark ? '#9AA0A6' : '#5F6368';
		const f16 = await favPng(theme, 16);
		const f32 = await favPng(theme, 32);
		return `<div class="row" style="background:${chrome}">
			<div class="tab" style="background:${tab};color:${txt}"><img src="${f16}" width="16" height="16"><span>Mainspring</span><i style="color:${sub}">&#215;</i></div>
			<div class="tab off" style="color:${sub}"><span>New tab</span></div>
			<div class="pin" style="background:${dark ? '#303134' : '#fff'}"><img src="${f32}" width="32" height="32"></div>
			<div class="note" style="color:${sub}">${theme} browser: 16 px tab, 32 px shortcut tile (public/favicon.svg)</div></div>`;
	};
	const html = `<!doctype html><meta charset="utf-8"><style>
		body{margin:0;font:13px system-ui,sans-serif;width:760px}
		.row{display:flex;align-items:flex-end;gap:8px;padding:10px 12px 0;height:64px;box-sizing:border-box}
		.tab{display:flex;align-items:center;gap:8px;width:200px;height:34px;padding:0 12px;border-radius:9px 9px 0 0;box-sizing:border-box}
		.tab span{flex:1} .tab.off{width:110px;background:transparent} .tab i{font-style:normal;font-size:16px}
		.pin{align-self:center;margin-left:20px;width:56px;height:56px;border-radius:50%;display:grid;place-items:center;box-shadow:0 1px 3px #0003}
		.note{align-self:center;margin-left:12px;font-size:12px}
	</style>${await row('light')}${await row('dark')}`;
	await shoot(html, `${out}logo-b-favicon-tabs.png`, 760, 130, 1);
}

{
	const apple = `file://${repo}public/icons/apple-touch-icon.png`;
	const mask = `file://${repo}public/icons/icon-maskable-192.png`;
	const colours = [['#7FA37F', 'Notes'], ['#C98C6B', 'Maps'], ['#6F8FB8', 'Mail'], ['#B8A06F', 'Clock'], ['#9A7FB8', 'Photos'], ['#6FB8AE', 'Music']];
	const sq = ([c, n]) => `<div class="app"><div class="ic" style="background:${c}"></div><span>${n}</span></div>`;
	const ours = (src, radius) => `<div class="app"><img class="ic" src="${src}" style="border-radius:${radius}"><span>Mainspring</span></div>`;
	const phone = (wall, label) => `<div class="phone" style="background:${wall}"><div class="cap"><b>${label}</b><br>iOS tile (apple-touch-icon), Android circle (maskable 192)</div><div class="grid">${[sq(colours[0]), sq(colours[1]), ours(apple, '14px'), sq(colours[2]), sq(colours[3]), ours(mask, '50%'), sq(colours[4]), sq(colours[5])].join('')}</div></div>`;
	const html = `<!doctype html><meta charset="utf-8"><style>
		body{margin:0;padding:18px;background:#777;display:grid;grid-template-columns:repeat(2,300px);gap:16px;font:11px system-ui,sans-serif}
		.phone{border-radius:28px;height:300px;padding:16px;box-sizing:border-box}
		.cap{color:#fff;font-size:11px;line-height:1.35;text-shadow:0 1px 2px #0006;margin-bottom:18px} .cap b{font-size:13px}
		.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px 6px}
		.app{display:flex;flex-direction:column;align-items:center;gap:5px;color:#fff;text-shadow:0 1px 2px #0007;font-size:10px}
		.ic{width:56px;height:56px;border-radius:14px;box-shadow:0 1px 4px #0004;display:block}
	</style>${phone('linear-gradient(160deg,#f3c9a7,#e9a6b5 55%,#a9b8e8)', 'Light wallpaper')}${phone('linear-gradient(160deg,#10223f,#1b1335 60%,#0a0f1c)', 'Dark wallpaper')}`;
	await shoot(html, `${out}logo-b-homescreen.png`, 640, 340, 2);
}
await browser.close();
