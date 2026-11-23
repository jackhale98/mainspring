// SPDX-License-Identifier: GPL-2.0-or-later
// Export (phase-4.md 18.20, T18): "Copy Gantt as image" and "Export tasks as CSV" in the Gantt
// toolbar's "More actions" menu, on the small plan ui-basic.
// - The menu has both entries with no task selected, and passes axe with them (light and dark).
// - The CSV is the exact bytes the plan's schedule gives: a byte order mark, CRLF records, RFC 4180
//   quoting, the dates in the plan's zone. Expected here from the result the page draws, through the
//   hook, in code of its own (the effort is the plan's own words, from the fixture).
// - The picture is a PNG of the right size, in the theme shown, with the names, the bars and the
//   dates drawn. Chromium's clipboard is real (it grants permissions); everywhere the download is
//   checked with `ClipboardItem` taken away, and the share sheet with stubs, so WebKit tests the
//   path it takes and nothing is skipped.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { ScheduleResult } from '../../src/engine/protocol';
import { READY_TIMEOUT_MS } from './lib/gantt-rig';
import {
	bytesOf,
	download,
	geometry,
	lookAt,
	openMenu,
	openPlan,
	pngSize,
	press,
	resultOf,
	withoutClipboardItem,
} from './lib/export-rig';
import { animationsDone } from './lib/settle';

test.setTimeout(READY_TIMEOUT_MS * 2);

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The plan's own `effort` statements (tests/fixtures/ui/basic); the macro-made task has none the index can see. */
const EFFORT: Readonly<Record<string, string>> = {
	'design.research': '4d',
	'design.docs': '2d',
	'build.code': '6d',
	'build.tests': '3d',
	'build.lint': '1d',
	'support.hotfix': '1d',
	'support.triage': '3d',
};

const field = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The CSV the result calls for, in the plan's zone (none: UTC) and without `Intl`, so that the oracle is not the code. */
function expectedCsv(result: ScheduleResult): string {
	const project = result.project;
	if (!project || project.timezone !== null) throw new Error('the plan has a zone: format it here');
	const date = (m: number): string =>
		new Date(Date.parse(project.start) + m * 60_000).toISOString().slice(0, 16).replace('T', ' ');
	const names = new Map(result.resources.map((r) => [r.id, r.name]));
	const rows = [['id', 'name', 'start', 'end', 'effort', 'people', 'complete']];
	for (const t of result.tasks) {
		const s = t.scenarios['plan'];
		if (!s) throw new Error(`no plan scenario for ${t.id}`);
		const dated = s.scheduled && s.start !== null && s.end !== null;
		rows.push([
			t.id,
			t.name,
			dated ? date(s.start as number) : '',
			dated ? date(s.end as number) : '',
			EFFORT[t.id] ?? '',
			s.allocated.map((id) => names.get(id) ?? id).join('; '),
			s.complete === null ? '' : String(s.complete),
		]);
	}
	return rows.map((r) => `${r.map(field).join(',')}\r\n`).join('');
}

async function axe(page: Page, state: string): Promise<void> {
	await animationsDone(page, 3);
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	expect
		.soft(
			r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
			state,
		)
		.toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
	test(`the menu has both exports with nothing selected, and passes axe (${scheme})`, async ({
		page,
	}, info) => {
		await page.emulateMedia({ colorScheme: scheme });
		await openPlan(page, info);
		const menu = await openMenu(page, info);
		for (const name of ['Copy Gantt as image', 'Export tasks as CSV']) {
			const item = menu.getByRole('menuitem', { name });
			await expect(item).toBeVisible();
			await expect(item).toBeEnabled();
			await expect(item).not.toHaveAttribute('aria-disabled', 'true');
		}
		// The row actions are in the menu and off: there is no task to act on.
		await expect(menu.getByRole('menuitem', { name: 'Indent' })).toBeDisabled();
		await expect(menu.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeEnabled();
		await axe(page, `the menu with the exports (${scheme})`);
		await page.keyboard.press('Escape');
		await expect(menu).not.toBeVisible();
		await expect(page.getByTestId('row-menu')).toBeFocused();
	});
}

test('the CSV is the exact bytes of the plan’s schedule, named for the plan', async ({
	page,
}, info) => {
	await openPlan(page, info);
	const file = await download(page, info, 'Export tasks as CSV');
	expect(file.suggestedFilename()).toBe('UI-basic-tasks.csv');
	const bytes = await bytesOf(file);
	const result = await resultOf(page);
	const expected = Buffer.concat([
		Buffer.from([0xef, 0xbb, 0xbf]),
		Buffer.from(expectedCsv(result), 'utf8'),
	]);
	expect(bytes.equals(expected), bytes.toString('utf8')).toBe(true);
	// The plan's shape is in it: a row for every task, with a quoted-free header and the macro-made task.
	const lines = bytes.toString('utf8').slice(1).split('\r\n');
	expect(lines[0]).toBe('id,name,start,end,effort,people,complete');
	expect(lines.length).toBe(result.tasks.length + 2);
	expect(result.tasks.map((t) => t.id)).toContain('build.check_unit');
	// The toast says where it went.
	await expect(
		page.getByTestId('toast').filter({ hasText: 'Downloaded UI-basic-tasks.csv.' }),
	).toBeVisible();
});

test('the picture is downloaded as a PNG of the visible range when the clipboard cannot take it', async ({
	page,
}, info) => {
	await withoutClipboardItem(page);
	await openPlan(page, info);
	const g = await geometry(page);
	const file = await download(page, info, 'Copy Gantt as image');
	expect(file.suggestedFilename()).toBe('UI-basic-gantt.png');
	const png = await bytesOf(file);
	expect(png.length).toBeGreaterThan(1000);
	const size = pngSize(png);
	// The names beside the plot, the header over both, at the screen's ratio (a fraction of a pixel of slack in the plot's width).
	expect(Math.abs(size.width - Math.round(g.width * g.dpr))).toBeLessThanOrEqual(2);
	expect(Math.abs(size.height - Math.round(g.height * g.dpr))).toBeLessThanOrEqual(1);
	await expect(
		page.getByTestId('toast').filter({ hasText: 'Downloaded UI-basic-gantt.png.' }),
	).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
	test(`the picture is drawn in the theme shown, with names, bars and dates (${scheme})`, async ({
		page,
	}, info) => {
		await page.emulateMedia({ colorScheme: scheme });
		await withoutClipboardItem(page);
		await openPlan(page, info);
		const g = await geometry(page);
		const png = await bytesOf(await download(page, info, 'Copy Gantt as image'));
		const look = await lookAt(page, png, g);
		// The surface is the page's: pale in light, dark in dark.
		if (scheme === 'light') {
			expect(look.plot).toBeGreaterThan(0.85);
			expect(look.corner).toBeGreaterThan(0.85);
		} else {
			expect(look.plot).toBeLessThan(0.25);
			expect(look.corner).toBeLessThan(0.25);
		}
		// Something is drawn in each part: the task names, the bars and links, the dates.
		expect(look.namesInk).toBeGreaterThan(0.004);
		expect(look.plotInk).toBeGreaterThan(0.004);
		expect(look.headerInk).toBeGreaterThan(0.004);
	});
}

test('the picture goes to the clipboard as image/png where the browser takes it', async ({
	page,
	context,
}, info) => {
	// Clipboard permissions can be granted in Chromium only; WebKit is asked the same and may copy or
	// may refuse and download: either is an outcome, and a failure message is not.
	const chromium = info.project.name !== 'iphone-14';
	if (chromium) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await openPlan(page, info);
	const g = await geometry(page);
	await openMenu(page, info);
	await press(page.getByRole('menuitem', { name: 'Copy Gantt as image' }), info);
	const toast = page.getByTestId('toast');
	if (!chromium) {
		await expect(
			toast.filter({
				hasText: /Copied the Gantt as an image\.|Downloaded UI-basic-gantt\.png\./,
			}),
		).toBeVisible();
		await expect(toast.filter({ hasText: 'could not be made' })).toHaveCount(0);
		return;
	}
	await expect(toast.filter({ hasText: 'Copied the Gantt as an image.' })).toBeVisible();
	const copied = await page.evaluate(async () => {
		const [item] = await navigator.clipboard.read();
		const blob = await item?.getType('image/png');
		return blob ? { type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] } : null;
	});
	expect(copied?.type).toBe('image/png');
	const size = pngSize(Uint8Array.from(copied?.bytes ?? []));
	expect(Math.abs(size.width - Math.round(g.width * g.dpr))).toBeLessThanOrEqual(2);
	expect(Math.abs(size.height - Math.round(g.height * g.dpr))).toBeLessThanOrEqual(1);
});

test('a finger is offered the share sheet when the clipboard cannot take the picture', async ({
	page,
}, info) => {
	await withoutClipboardItem(page);
	await page.addInitScript(() => {
		const shared: Array<{ name: string; type: string; size: number }> = [];
		(window as unknown as { __shared: typeof shared }).__shared = shared;
		Object.defineProperty(navigator, 'canShare', {
			configurable: true,
			value: (data: { files?: File[] }) => (data.files?.length ?? 0) > 0,
		});
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: async (data: { files?: File[] }) => {
				for (const f of data.files ?? []) shared.push({ name: f.name, type: f.type, size: f.size });
			},
		});
	});
	await openPlan(page, info);
	const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
	// The Pixel 7 emulation has a finger: the branch below must be the one that runs there.
	if (info.project.name === 'pixel-7') expect(coarse).toBe(true);
	if (info.project.name === 'desktop') expect(coarse).toBe(false);
	await openMenu(page, info);
	const downloading = coarse ? null : page.waitForEvent('download');
	await press(page.getByRole('menuitem', { name: 'Copy Gantt as image' }), info);
	if (coarse) {
		await expect
			.poll(() =>
				page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length),
			)
			.toBe(1);
		const [sent] = await page.evaluate(
			() =>
				(window as unknown as { __shared: Array<{ name: string; type: string; size: number }> })
					.__shared,
		);
		expect(sent).toMatchObject({ name: 'UI-basic-gantt.png', type: 'image/png' });
		expect(sent?.size).toBeGreaterThan(1000);
	} else {
		// A mouse has no share sheet in this app: the picture is a download.
		expect((await downloading)?.suggestedFilename()).toBe('UI-basic-gantt.png');
		expect(
			await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length),
		).toBe(0);
	}
});
