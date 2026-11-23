// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A rig for the plan health specs (phase-3.md 9.7, 13.2; T18) on `fedora-res`: opens the plan in
 * Visual mode (the phone's Gantt tab), opens the Health panel the way the layout does (a desktop's
 * Health button and right panel, a phone's status card row and full-height sheet), finds findings
 * by check and task, and reads and compares the plan's text. The oracle for counts is
 * `checkPlan` over the committed golden (src/lib/health), which the live result equals on this plan
 * (the golden parity job proves that; here it is the number the panel must show).
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { checkPlan } from '../../../src/lib/health/report';
import { goldenInput } from '../../../src/lib/health/testing';
import type { CheckId, HealthSettings } from '../../../src/lib/health/types';
import { REPO } from '../../golden/corpus';
import { READY_TIMEOUT_MS, Rig, isTouch } from './gantt-rig';
import { modKey } from './keys';
import { resultAfter, resultRevision } from './settle';

export const PLAN = 'fedora-res';
export const SETTINGS_KEY = `mainspring.health.${PLAN}`;
/**
 * The small plan the specs use where the size of the plan is not the point (ADR-0016 change 4): 16
 * tasks, nine findings in four checks (no predecessor, no successor, hard constraint, held by
 * people). What the panel must show for it is `smallReport` (lib/small-plan.ts).
 */
export const SMALL = 'ui-basic';
export const SMALL_SETTINGS_KEY = `mainspring.health.${SMALL}`;
export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export const phoneOf = isTouch;

/** The report the panel must show, from the golden input with the settings. */
export const expected = (settings?: HealthSettings) => checkPlan(goldenInput(PLAN, settings));

type Hooks = { __mainspringEdits: { text(p?: string): string | null; selection(): unknown } };

/** The entry file and the generated people file, where the plan's allocations are written. */
export const textOf = (page: Page): Promise<string> =>
	page.evaluate(() => {
		const e = (window as unknown as Hooks).__mainspringEdits;
		return `${e.text() ?? ''}\n--\n${e.text('mainspring-load.tji') ?? ''}`;
	});

export const selectionOf = (page: Page): Promise<{ kind: string; id?: string } | null> =>
	page.evaluate(
		() =>
			(window as unknown as Hooks).__mainspringEdits.selection() as {
				kind: string;
				id?: string;
			} | null,
	);

/** Opens the plan on the Gantt, ready and scheduled. */
export async function openPlan(
	page: Page,
	info: TestInfo,
	scheme?: 'light' | 'dark',
): Promise<Rig> {
	if (scheme) await page.emulateMedia({ colorScheme: scheme });
	return Rig.open(page, info, undefined, 'visual', PLAN);
}

/** Opens the small plan on the Gantt, ready and scheduled. */
export async function openSmall(
	page: Page,
	info: TestInfo,
	scheme?: 'light' | 'dark',
): Promise<Rig> {
	if (scheme) await page.emulateMedia({ colorScheme: scheme });
	return Rig.open(page, info, undefined, 'visual', SMALL);
}

/** Opens a sample on the Gantt, ready and scheduled (the small plans of tests/fixtures/ui). */
export async function openSample(
	page: Page,
	info: TestInfo,
	sample: string,
	scheme?: 'light' | 'dark',
): Promise<Rig> {
	if (scheme) await page.emulateMedia({ colorScheme: scheme });
	return Rig.open(page, info, undefined, 'visual', sample);
}

/** The health panel: the right panel on a desktop, the sheet on a phone. */
export const panelOf = (page: Page, info: TestInfo): Locator =>
	isTouch(info)
		? page.getByRole('dialog', { name: 'Plan health' })
		: page.getByRole('complementary', { name: 'Plan health' });

/** Opens the panel as the layout does and waits for the report. */
export async function openHealth(page: Page, info: TestInfo): Promise<Locator> {
	if (isTouch(info)) {
		await page.getByTestId('status-button').tap();
		await page.getByTestId('open-health').tap();
	} else {
		await page.getByTestId('health-button').click();
	}
	const panel = panelOf(page, info);
	await expect(panel).toBeVisible();
	await expect(panel.getByTestId('health-summary')).toContainText('problem', {
		timeout: READY_TIMEOUT_MS,
	});
	return panel;
}

/** The findings of a check, or the one for a task. */
export const findings = (panel: Locator, check: CheckId, task?: string): Locator =>
	panel.locator(
		`[data-testid="finding"][data-check="${check}"]${task === undefined ? '' : `[data-task="${task}"]`}`,
	);

/** A check's heading with its count: "No predecessor, 26". */
export const heading = (panel: Locator, text: string | RegExp): Locator =>
	panel.getByRole('heading', { level: 3, name: text });

/** The stored settings of the plan, or null. */
export const storedSettings = (page: Page, key = SETTINGS_KEY): Promise<string | null> =>
	page.evaluate((k) => localStorage.getItem(k), key);

/** The panel says how many problems there are, and the Health button's name says it too. */
export async function expectTotal(page: Page, info: TestInfo, panel: Locator, n: number) {
	await expect(panel.getByTestId('health-summary')).toContainText(`${n} problem`, {
		timeout: 60_000,
	});
	if (!isTouch(info)) {
		await expect(page.getByTestId('health-button')).toHaveAttribute(
			'aria-label',
			`Plan health: ${n} ${n === 1 ? 'problem' : 'problems'}`,
		);
	}
}

/** Lines of `after` that differ from `before` (same number of lines), as [was, now] pairs. */
export function changedLines(before: string, after: string): Array<[string, string]> {
	const a = before.split('\n');
	const b = after.split('\n');
	if (a.length !== b.length) throw new Error(`line counts differ: ${a.length} and ${b.length}`);
	return a.flatMap((line, i) =>
		line === b[i] ? [] : [[line, b[i] as string] as [string, string]],
	);
}

/** Waits for the newest edit's toast to settle, as the plan's text and its schedule agree. */
export async function settled(page: Page): Promise<void> {
	const toast = page.locator('[data-testid="toast"], [data-testid="toast-quiet"]').last();
	await expect(toast).toHaveAttribute('data-status', 'scheduled', { timeout: READY_TIMEOUT_MS });
}

/** Undo of the newest edit: the toast's button, or the top bar's on a phone. */
export async function undo(page: Page, info: TestInfo): Promise<void> {
	if (isTouch(info)) await page.getByTestId('undo').tap();
	else await page.getByTestId('toast').last().getByRole('button', { name: 'Undo' }).click();
}

/** Two frames: what a scroll showed is laid out and the windowed list has mounted its rows. */
const frames = (page: Page): Promise<unknown> =>
	page.evaluate(
		() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
	);

/**
 * A finding's row, scrolled to until it is mounted: the lists are windowed (FindingGroup), so a row
 * far down its check is not in the page until the panel has been scrolled to it. The list holds still
 * while it is measured on every engine (lib/health/anchor.ts), so the row Playwright scrolls to is
 * the row that is there when it gets to it. Each step waits for the frames the window needs to mount
 * the next rows, not for a time.
 */
export async function rowOf(panel: Locator, check: CheckId, task: string): Promise<Locator> {
	const row = findings(panel, check, task);
	const head = panel.locator(`[data-group="${check}"] h3`);
	await head.scrollIntoViewIfNeeded();
	for (let i = 0; i < 160; i++) {
		if ((await row.count()) > 0) {
			await row.first().scrollIntoViewIfNeeded();
			return row;
		}
		await head.evaluate((h) => {
			let p = h.parentElement;
			while (p && !['auto', 'scroll'].includes(getComputedStyle(p).overflowY)) p = p.parentElement;
			(p ?? document.scrollingElement)?.scrollBy(0, 400);
		});
		await frames(panel.page());
	}
	throw new Error(`no row for ${task} in ${check}`);
}

/** Frames the list has to hold still for before `driveList` hands it back. */
const STILL_FRAMES = 12;
/**
 * How long after its last scroll the script waits before it calls the list still, in ms: more than
 * the list's own idle time (150 ms, FindingGroup), so a hold that is given back when the scrolling
 * stops has happened by then.
 */
const QUIET_MS = 500;
/** Frames `driveList` waits for the list to hold still before it says it never did. */
const STILL_WITHIN_FRAMES = 600;

export interface Drive {
	/** The first row about a task fully in view when the list held still, and its distance from the scroller's top. */
	key: string;
	top: number;
	/** `scrollTop` writes the app made while the script was scrolling, and after it, until the list held still. */
	writesDuring: number;
	writesAfter: number;
}

/**
 * Scrolls the panel's list the way a finger does (a script on the scroller, `by` px a frame for
 * `frames` frames, no waiting between) and waits for it to hold still, checking every frame what the
 * app promises on every engine (lib/health/anchor.ts: the list is measured as it is scrolled and keeps
 * what is shown where it is). Fails, with the row and the frame, if:
 * - a row in view in two frames in a row moved by anything but what the script scrolled, over 2 px;
 * - the first row in view or the scroller's `scrollHeight` does not hold for STILL_FRAMES frames within
 *   STILL_WITHIN_FRAMES (the old bug on WebKit: the end of the list never settled).
 * A finger is down for the frames (a `touchstart` and a `touchend` on the scroller), and the app is
 * not to write `scrollTop` then. Counts the app's own `scrollTop` writes (the script's are not counted): an iPhone stops a fling
 * when one is made, so they are only allowed once the scrolling has stopped.
 */
export function driveList(panel: Locator, by: number, frames = 1): Promise<Drive> {
	return panel.evaluate(
		(root, args) =>
			new Promise<Drive>((done, fail) => {
				type Writes = { n: number; ours: boolean };
				const w = window as unknown as { __scrollWrites?: Writes };
				if (!w.__scrollWrites) {
					const writes: Writes = { n: 0, ours: false };
					w.__scrollWrites = writes;
					const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
					if (d?.get && d.set) {
						const { get, set } = d;
						Object.defineProperty(Element.prototype, 'scrollTop', {
							configurable: true,
							get() {
								return get.call(this);
							},
							set(v: number) {
								if (!writes.ours) writes.n++;
								set.call(this, v);
							},
						});
					}
				}
				const writes = w.__scrollWrites;
				const scroller = ((): HTMLElement => {
					for (let p = root.querySelector<HTMLElement>('[data-group] h3'); p; p = p.parentElement) {
						if (['auto', 'scroll'].includes(getComputedStyle(p).overflowY)) return p;
					}
					return document.scrollingElement as HTMLElement;
				})();
				const snap = () => {
					const at = scroller.getBoundingClientRect().top;
					const rows = new Map<string, { top: number; height: number }>();
					let first = { key: '', top: 0 };
					for (const li of scroller.querySelectorAll<HTMLElement>('li[data-testid="finding"]')) {
						const r = li.getBoundingClientRect();
						const key = `${li.dataset['check']}|${li.dataset['key']}`;
						rows.set(key, { top: r.top - at, height: r.height });
						if (first.key === '' && r.top >= at && li.querySelector('button.task'))
							first = { key: li.dataset['key'] ?? '', top: r.top - at };
					}
					return { rows, first, height: scroller.scrollHeight, st: scroller.scrollTop };
				};
				const check = (
					a: ReturnType<typeof snap>,
					b: ReturnType<typeof snap>,
					moved: number,
					at: number,
				): string | null => {
					const view = scroller.clientHeight;
					for (const [key, now] of b.rows) {
						const was = a.rows.get(key);
						if (!was) continue;
						const inView = (t: number, h: number): boolean => t + h > 0 && t < view;
						// A row that was not in view is not what a finger saw move.
						if (!inView(was.top, was.height)) continue;
						const off = now.top - (was.top - moved);
						if (Math.abs(off) > 2)
							return `${key.slice(-60)} moved ${off.toFixed(1)} px beyond the scroll (frame ${at}, scrolled ${moved}; top ${was.top.toFixed(1)} to ${now.top.toFixed(1)}, height ${was.height} to ${now.height}; scrollTop ${a.st.toFixed(1)} to ${b.st.toFixed(1)}, app writes ${writes.n})`;
					}
					return null;
				};
				const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
				void (async () => {
					const start = writes.n;
					let prev = snap();
					// A finger is down for the swipe: the list does not write scrollTop while it is.
					scroller.dispatchEvent(new Event('touchstart', { bubbles: true }));
					for (let f = 0; f < args.frames; f++) {
						const was = scroller.scrollTop;
						writes.ours = true;
						scroller.scrollTop += args.by;
						writes.ours = false;
						const moved = scroller.scrollTop - was;
						await frame();
						const now = snap();
						const bad = check(prev, now, moved, f);
						if (bad) return fail(new Error(bad));
						prev = now;
					}
					scroller.dispatchEvent(new Event('touchend', { bubbles: true }));
					const during = writes.n - start;
					const quietFrom = performance.now();
					let same = 0;
					for (let f = 0; same < args.still || performance.now() - quietFrom < args.quiet; f++) {
						if (f > args.within)
							return fail(
								new Error(
									`the list did not hold still in ${args.within} frames: first row ${prev.first.key.slice(-40)} at ${prev.first.top.toFixed(1)}, scrollHeight ${prev.height}`,
								),
							);
						await frame();
						const now = snap();
						const bad = check(prev, now, 0, args.frames + f);
						if (bad) return fail(new Error(bad));
						const still =
							now.first.key === prev.first.key &&
							Math.abs(now.first.top - prev.first.top) < 0.5 &&
							now.height === prev.height;
						same = still ? same + 1 : 0;
						prev = now;
					}
					done({ ...prev.first, writesDuring: during, writesAfter: writes.n - start - during });
				})();
			}),
		{ by, frames, still: STILL_FRAMES, within: STILL_WITHIN_FRAMES, quiet: QUIET_MS },
	);
}

/**
 * Waits until the panel's list has stopped scrolling by itself (a "jump to a check" scrolls its
 * heading to the top, and a scroll in flight is not what `driveList` checks): `scrollTop` is the same
 * for 30 frames and for QUIET_MS. Fails after STILL_WITHIN_FRAMES frames.
 */
export function scrollStops(panel: Locator): Promise<void> {
	return panel.evaluate(
		(root, args) =>
			new Promise<void>((done, fail) => {
				let scroller: HTMLElement | null = null;
				for (let p = root.querySelector<HTMLElement>('[data-group] h3'); p; p = p.parentElement) {
					if (['auto', 'scroll'].includes(getComputedStyle(p).overflowY)) {
						scroller = p;
						break;
					}
				}
				const el = scroller ?? (document.scrollingElement as HTMLElement);
				let at = el.scrollTop;
				let since = performance.now();
				let same = 0;
				let f = 0;
				const look = (): void => {
					if (el.scrollTop === at) same++;
					else {
						at = el.scrollTop;
						same = 0;
						since = performance.now();
					}
					if (same >= 30 && performance.now() - since >= args.quiet) return done();
					if (++f > args.within) return fail(new Error('the list kept scrolling'));
					requestAnimationFrame(look);
				};
				requestAnimationFrame(look);
			}),
		{ quiet: QUIET_MS, within: STILL_WITHIN_FRAMES },
	);
}

/** One swipe: `by` px in one step, then until the list holds still. */
export const scrollList = (panel: Locator, by: number): Promise<Drive> => driveList(panel, by, 1);

/** The size each check's list says it has (aria-setsize of its first mounted row), by check. */
export async function sizes(panel: Locator): Promise<Record<string, number>> {
	return panel
		.locator('[data-group]')
		.evaluateAll((els) =>
			Object.fromEntries(
				els.map((el) => [
					el.getAttribute('data-group') ?? '',
					Number(el.querySelector('li[aria-setsize]')?.getAttribute('aria-setsize') ?? 0),
				]),
			),
		);
}

/** The text of a health fixture (tests/fixtures/health/<dir>/<side>/plan.tjp). */
export const fixtureText = (dir: string, side: 'pass' | 'fail'): string =>
	fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'health', dir, side, 'plan.tjp'), 'utf8');

/** Replaces the plan's text in the Text editor and comes back to the Gantt, scheduled. */
export async function setPlan(page: Page, info: TestInfo, source: string): Promise<void> {
	const phone = isTouch(info);
	if (phone) await page.getByRole('tab', { name: 'Text', exact: true }).tap();
	else await page.getByRole('button', { name: 'Text', exact: true }).click();
	const editor = page.getByRole('textbox', { name: /^Editor for / });
	await editor.click();
	const rev = await resultRevision(page);
	await page.keyboard.press(`${await modKey(page)}+A`);
	await page.keyboard.insertText(source);
	await expect
		.poll(() =>
			page.evaluate(() =>
				(
					window as unknown as { __mainspringEdits: { text(): string | null } }
				).__mainspringEdits.text(),
			),
		)
		.toBe(source);
	// "Scheduled" still shows the plan before this one until its run starts.
	await resultAfter(page, rev, READY_TIMEOUT_MS);
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	if (phone) await page.getByRole('tab', { name: 'Gantt', exact: true }).tap();
	else await page.getByRole('button', { name: 'Visual', exact: true }).click();
}

/**
 * Health fixture H8 (fail) with one more task, typed into a small plan: "side" runs without Dev for
 * 24 hours, and "lone" is a task of Ann's that Dev is not on, with nothing before it.
 */
export const H8_LONE_PLAN = `${fixtureText('h8-work-without-people', 'fail')}
task lone "Lone task" {
  effort 1d
  allocate ann
}
`;
