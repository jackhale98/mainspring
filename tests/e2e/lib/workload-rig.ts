// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A rig for the heatmap specs (phase-3.md 13.2, 16.1): opens a plan in the Workload view (the
 * desktop's view switcher, or the phone's People tab and its Load segment), reads cells from the
 * ARIA mirror, walks the whole grid through the window the mirror holds, and an oracle that reads
 * hours from a result's `bookings` with `Intl` and nothing of the view or of src/lib/workload.
 */
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { ScheduleResult } from '../../../src/engine/protocol';
import { READY_TIMEOUT_MS, isTouch } from './gantt-rig';

export interface MirrorCell {
	person: string;
	col: number;
	booked: number;
	available: number;
	band: string;
	name: string;
}

type Hook = {
	shape(): { rows: string[]; cols: number; zoom: string } | null;
	scrollTo(person: string, col: number): boolean;
	reveal(person: string, col: number): boolean;
	cell(person: string, col: number): { x: number; y: number } | null;
	result(): ScheduleResult | null;
};
type Win = { __mainspringWorkload: Hook };

export async function openHeatmap(
	page: Page,
	info: TestInfo,
	plan = 'fedora-res',
	query = '',
): Promise<void> {
	const phone = isTouch(info);
	await page.goto(
		phone
			? `/app?sample=${plan}&hooks=edits,workload${query}`
			: `/app?sample=${plan}&mode=visual&view=workload&hooks=edits,workload${query}`,
	);
	await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
		timeout: READY_TIMEOUT_MS,
	});
	if (phone)
		await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name: 'People' }).tap();
	await expect(page.getByTestId('heat-cell').first()).toBeAttached({ timeout: 60_000 });
}

export const shape = (page: Page) =>
	page.evaluate(() => (window as unknown as Win).__mainspringWorkload.shape());

export const resultOf = (page: Page) =>
	page.evaluate(() => (window as unknown as Win).__mainspringWorkload.result());

/** Every cell the mirror holds now. */
export function mirrorCells(page: Page): Promise<MirrorCell[]> {
	return page.$$eval('[data-testid="heat-cell"]', (els) =>
		els.map((e) => {
			const d = (e as HTMLElement).dataset;
			return {
				person: d['person'] ?? '',
				col: Number(d['col']),
				booked: Number(d['booked']),
				available: Number(d['available']),
				band: d['band'] ?? '',
				name: e.textContent ?? '',
			};
		}),
	);
}

/**
 * Reads every cell of the grid through the mirror's window: scrolls the first cell not yet seen to
 * the top left, reads what the mirror holds, and repeats until every person and column was seen.
 */
export async function walkGrid(page: Page): Promise<Map<string, MirrorCell>> {
	const s = await shape(page);
	if (!s) throw new Error('no heatmap');
	const seen = new Map<string, MirrorCell>();
	const key = (p: string, c: number): string => `${p}|${c}`;
	for (let guard = 0; guard < 400; guard++) {
		let next: [string, number] | null = null;
		outer: for (const p of s.rows) {
			for (let c = 0; c < s.cols; c++) {
				if (!seen.has(key(p, c))) {
					next = [p, c];
					break outer;
				}
			}
		}
		if (!next) return seen;
		const [person, col] = next;
		await page.evaluate(
			([p, c]) =>
				(window as unknown as Win).__mainspringWorkload.scrollTo(p as string, c as number),
			[person, col] as const,
		);
		// The mirror follows the scroll: wait for it to hold the cell that was scrolled to.
		let cells: MirrorCell[] = [];
		await expect
			.poll(
				async () => {
					cells = await mirrorCells(page);
					return cells.some((c) => c.person === person && c.col === col);
				},
				{ message: `the mirror holds ${person} column ${col}`, timeout: 20_000 },
			)
			.toBe(true);
		for (const c of cells) seen.set(key(c.person, c.col), c);
	}
	throw new Error('the grid walk did not finish');
}

/**
 * The oracle: booked and available minutes per person and week from a result, slot by slot, with
 * `Intl` for the local week of each slot. Groups are the sums of their leaf members. Weeks are
 * numbered from the one that holds minute 0. Reads `bookings` and `workingTime` of the first active
 * scenario; a person without `workingTime` has the project's.
 */
export function oracle(r: ScheduleResult): {
	weeks: number;
	booked: Map<string, number[]>;
	available: Map<string, number[]>;
} {
	const p = r.project;
	if (!p) throw new Error('no project');
	const scenario = p.scenarios.find((s) => s.active)?.id;
	if (!scenario) throw new Error('no active scenario');
	const res = p.timingResolutionMin;
	const startMs = Date.parse(p.start);
	const end = Math.round((Date.parse(p.end) - startMs) / 60_000);
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone: p.timezone ?? 'UTC',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		weekday: 'short',
	});
	const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const memo = new Map<number, number>();
	const keyOf = (minute: number): number => {
		const known = memo.get(minute);
		if (known !== undefined) return known;
		const parts = Object.fromEntries(
			fmt.formatToParts(new Date(startMs + minute * 60_000)).map((x) => [x.type, x.value]),
		);
		const day =
			Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day'])) /
			86_400_000;
		const wd = WD.indexOf(parts['weekday'] ?? '');
		const key = day - ((wd - (p.weekStartsMonday ? 1 : 0) + 7) % 7);
		memo.set(minute, key);
		return key;
	};
	const first = keyOf(0);
	const weeks = (keyOf(end - 1) - first) / 7 + 1;
	const col = (minute: number): number => (keyOf(minute) - first) / 7;
	const add = (into: number[], pairs: ReadonlyArray<readonly [number, number]>): void => {
		for (const [a, b] of pairs) {
			for (let m = a; m < b; m += res) into[col(m)] = (into[col(m)] ?? 0) + Math.min(res, b - m);
		}
	};
	const zero = (): number[] => new Array<number>(weeks).fill(0);
	const booked = new Map<string, number[]>();
	const available = new Map<string, number[]>();
	const projectHours = zero();
	add(projectHours, p.workingTime);
	for (const res_ of r.resources) {
		if (res_.group) continue;
		const sc = res_.scenarios[scenario];
		const a = zero();
		if (sc?.workingTime) add(a, sc.workingTime);
		else for (let c = 0; c < weeks; c++) a[c] = projectHours[c] as number;
		available.set(res_.id, a);
		booked.set(res_.id, zero());
	}
	for (const b of r.bookings) {
		if (b.scenario !== scenario) continue;
		const into = booked.get(b.resource);
		if (into) add(into, b.intervals);
	}
	// Groups: the sums of the leaves under them.
	const kids = new Map<string, string[]>();
	for (const x of r.resources)
		if (x.parent) kids.set(x.parent, [...(kids.get(x.parent) ?? []), x.id]);
	const leaves = (id: string): string[] => {
		const k = kids.get(id) ?? [];
		return k.length === 0 ? [id] : k.flatMap(leaves);
	};
	for (const x of r.resources) {
		if (!x.group) continue;
		const b = zero();
		const a = zero();
		for (const l of leaves(x.id)) {
			for (let c = 0; c < weeks; c++) {
				b[c] = (b[c] as number) + ((booked.get(l)?.[c] as number | undefined) ?? 0);
				a[c] = (a[c] as number) + ((available.get(l)?.[c] as number | undefined) ?? 0);
			}
		}
		booked.set(x.id, b);
		available.set(x.id, a);
	}
	return { weeks, booked, available };
}
