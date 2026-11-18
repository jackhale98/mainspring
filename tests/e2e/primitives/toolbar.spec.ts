// SPDX-License-Identifier: GPL-2.0-or-later
// The Toolbar primitive's contract (ADR-0016 #3; src/lib/ui/toolbar-tiers.ts, src/styles/toolbar.css),
// on /dev/primitives without the engine, on desktop, Pixel 7 and iPhone 14:
// - from 360 to 1600 px wide, every control of the Gantt's chips and of the Workload and Lanes bar is
//   on one row, the Calendar's bar is one row from 1024 px (it wraps by design under that, see
//   `calendarRows`), and no control is cut off by its toolbar's edge;
// - in a narrow container on a wide screen (Split beside the editor), the same;
// - every control has declared its narrow form (`data-narrow`), so that a new control cannot forget it.
// Consumers whose specs run on every change here: gantt-add-task, gantt-phone-polish, gantt-a11y,
// workload, lanes, calendar, modes-layout.
import { expect, test, type Page } from '@playwright/test';
import { NARROW_FORMS } from '../../../src/lib/ui/toolbar-tiers';
import { openPrimitives } from '../lib/primitives-rig';

const WIDTHS = [360, 375, 390, 412, 480, 599, 600, 700, 768, 899, 900, 1024, 1280, 1366, 1600];
/**
 * How many rows a toolbar may take at a width. The Gantt's chips and the Workload and Lanes bar are one
 * row everywhere. The Calendar's bar has five groups (the months, Today, the person, the mode, the
 * type) that cannot share 360 px, so it wraps by design (CalendarBar.svelte: two rows on a phone,
 * from 360 px to 599 px, and from about 600 to 1000 px) and is one row from 1024 px; it is never cut
 * off.
 */
const oneRow = (): number => 1;
// 600 px: not a phone, but the demo host is 598 px wide, so the bar is in the narrow-pane layout of a
// Split Calendar (three rows, as before).
const calendarRows = (w: number): number => (w <= 599 ? 2 : w === 600 ? 3 : w <= 1000 ? 2 : 1);
const TOOLBARS = [
	{ id: 'toolbar-gantt', name: 'the Gantt chips', rows: oneRow },
	{ id: 'toolbar-workload', name: 'the Workload bar', rows: oneRow },
	{ id: 'toolbar-lanes', name: 'the Lanes bar', rows: oneRow },
	{ id: 'toolbar-calendar', name: 'the Calendar bar', rows: calendarRows },
] as const;

interface Measured {
	rows: number;
	clipped: string[];
	undeclared: string[];
	badForm: string[];
	controls: number;
}

/** The controls of a toolbar's row: its visible children that are or hold a button, select or field. */
function measure(page: Page, id: string, forms: readonly string[]): Promise<Measured> {
	return page.evaluate(
		([testid, known]) => {
			const host = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
			const row = host?.querySelector<HTMLElement>('[data-toolbar]');
			if (!host || !row) throw new Error(`no toolbar ${testid}`);
			const visible = (el: Element): boolean => {
				const r = el.getBoundingClientRect();
				return r.width > 0 && r.height > 0 && !el.classList.contains('sr-only');
			};
			const isControl = (el: Element): boolean =>
				el.matches('button, select, input') || el.querySelector('button, select, input') !== null;
			const controls = [...row.children].filter((c) => visible(c) && isControl(c));
			const hostBox = host.getBoundingClientRect();
			const name = (c: Element): string =>
				c.getAttribute('data-testid') ?? c.getAttribute('aria-label') ?? c.className.toString();
			const tops: number[] = [];
			const clipped: string[] = [];
			for (const c of controls) {
				const r = c.getBoundingClientRect();
				const mid = r.top + r.height / 2;
				// One row: centres within 10 px of one another (the controls differ in height by a few px).
				if (!tops.some((t) => Math.abs(t - mid) < 10)) tops.push(mid);
				if (r.right > hostBox.right + 1 || r.left < hostBox.left - 1) clipped.push(name(c));
			}
			if (row.scrollWidth > row.clientWidth + 1) clipped.push('(the row scrolls)');
			const declared = (c: Element): string | null =>
				(c.matches('[data-narrow]') ? c : c.querySelector('[data-narrow]'))?.getAttribute(
					'data-narrow',
				) ?? null;
			return {
				rows: tops.length,
				clipped,
				undeclared: controls.filter((c) => declared(c) === null).map(name),
				badForm: controls
					.filter((c) => declared(c) !== null && !known.includes(declared(c) as string))
					.map(name),
				controls: controls.length,
			};
		},
		[id, forms] as const,
	);
}

test.describe('toolbars: one row from 360 to 1600 px', () => {
	for (const t of TOOLBARS) {
		test(`${t.name}`, async ({ page }) => {
			await openPrimitives(page);
			const problems: string[] = [];
			for (const w of WIDTHS) {
				await page.setViewportSize({ width: w, height: 800 });
				// A phone has no people picker (a finger books people in the details sheet).
				await page.evaluate(
					(narrow) =>
						(
							window as unknown as { __primitives: { picker(on: boolean): void } }
						).__primitives.picker(!narrow),
					w <= 599,
				);
				await page.waitForTimeout(120);
				const m = await measure(page, t.id, NARROW_FORMS);
				expect(m.controls, `${t.name} at ${w} px has controls`).toBeGreaterThan(1);
				if (m.rows > t.rows(w)) problems.push(`${w} px: ${m.rows} rows`);
				if (m.clipped.length > 0) problems.push(`${w} px: cut off: ${m.clipped.join(', ')}`);
			}
			expect(problems, `${t.name}: no more rows than it is allowed, nothing cut off`).toEqual([]);
		});
	}

	test('in a narrow container on a wide screen (Split beside the editor)', async ({ page }) => {
		await openPrimitives(page);
		await page.setViewportSize({ width: 1600, height: 800 });
		const problems: string[] = [];
		for (const w of [640, 700, 760, 899, 1000, 1100]) {
			await page.evaluate(
				(v) =>
					(
						window as unknown as { __primitives: { hostWidth(w: number): void } }
					).__primitives.hostWidth(v),
				w,
			);
			await page.waitForTimeout(120);
			for (const t of TOOLBARS) {
				const m = await measure(page, t.id, NARROW_FORMS);
				if (m.rows > t.rows(w)) problems.push(`${t.name} in ${w} px: ${m.rows} rows`);
				if (m.clipped.length > 0)
					problems.push(`${t.name} in ${w} px: cut off: ${m.clipped.join(', ')}`);
			}
		}
		expect(problems).toEqual([]);
	});
});

test.describe('toolbars: every control declares its narrow form', () => {
	for (const t of TOOLBARS) {
		test(`${t.name}`, async ({ page }) => {
			await openPrimitives(page);
			for (const w of [360, 900, 1600]) {
				await page.setViewportSize({ width: w, height: 800 });
				await page.waitForTimeout(100);
				const m = await measure(page, t.id, NARROW_FORMS);
				expect(m.undeclared, `${t.name} at ${w} px: controls with no data-narrow`).toEqual([]);
				expect(m.badForm, `${t.name} at ${w} px: unknown forms`).toEqual([]);
			}
		});
	}
});
