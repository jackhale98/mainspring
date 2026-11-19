// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A rig for the lanes specs (phase-3.md 13.2, T15): opens a plan in the Resources lanes (the
 * desktop's view switcher, or the phone's People tab and its Lanes segment), finds bars, lanes and
 * periods on the screen through the read-only hook (`?hooks=edits,lanes`), performs real input
 * (a mouse on desktop; a finger through the DevTools protocol on the Pixel 7, a long-press being a
 * touch held for 450 ms: the Gantt rig's `drag`), reads canvas pixels, and holds the oracles that
 * read a result's bookings and leave with nothing of the view or of src/lib/lanes.
 */
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { EngineLeaveType, ScheduleResult } from '../../../src/engine/protocol';
import { READY_TIMEOUT_MS, Rig, isTouch, type Point } from './gantt-rig';
import { frames, settledValue } from './settle';

export interface BarInfo {
	task: string;
	from: number;
	to: number;
	minutes: number;
	movable: boolean;
	textOnly: boolean;
}

type Hook = {
	bars(person: string): BarInfo[];
	leaves(
		person: string,
	): Array<{ type: EngineLeaveType; runs: Array<{ from: number; to: number }> }>;
	bands(person: string): string[];
	leaveTypes(): EngineLeaveType[];
	barPoint(person: string, task: string, nth?: number, inset?: number): Point | null;
	revealMinute(person: string, minute: number): Point | null;
	revealBar(person: string, task: string, nth?: number): boolean;
	lanePoint(person: string, x: number): Point | null;
	cell(person: string, col: number): Point | null;
	revealPerson(person: string): boolean;
	result(): ScheduleResult | null;
	shape(): {
		rows: string[];
		cols: number;
		zoom: string;
		viewport: { left: number; top: number; right: number; bottom: number } | null;
		plot: { left: number; top: number };
		cell: { w: number; h: number };
		bounds: number[];
	} | null;
};
type Win = { __mainspringLanes: Hook };

export class LanesRig extends Rig {
	/** Opens the lanes, ready and scheduled, with the move preference set to "start" (no question). */
	static async openLanes(
		page: Page,
		info: TestInfo,
		sample = 'gantt-manipulation',
		scheme?: 'light' | 'dark',
	): Promise<LanesRig> {
		const rig = new LanesRig(page, info);
		if (scheme) await page.emulateMedia({ colorScheme: scheme });
		// ADR-0008 #2: a move asks once how to move; a spec that pins a patch has answered already.
		await page.addInitScript(() => {
			try {
				localStorage.setItem('mainspring.gantt.move', 'start');
			} catch {
				// Storage blocked: the dialog comes, and the spec that needs it answers it.
			}
		});
		page.on('dialog', (d) => void d.accept());
		const phone = isTouch(info);
		await page.goto(
			phone
				? `/app?sample=${sample}&hooks=edits,lanes`
				: `/app?sample=${sample}&mode=visual&view=resources&hooks=edits,lanes`,
		);
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		if (phone) {
			await page
				.getByRole('tablist', { name: 'Panels' })
				.getByRole('tab', { name: 'People' })
				.tap();
			await page
				.getByRole('tablist', { name: 'People views' })
				.getByRole('tab', { name: 'Lanes' })
				.tap();
		}
		await expect(page.getByTestId('lane-cell').first()).toBeAttached({ timeout: 60_000 });
		await expect(page.getByTestId('lanes')).toBeVisible();
		return rig;
	}

	get root() {
		return this.page.getByTestId('lanes');
	}

	shape() {
		return this.page.evaluate(() => (window as unknown as Win).__mainspringLanes.shape());
	}
	result() {
		return this.page.evaluate(() => (window as unknown as Win).__mainspringLanes.result());
	}
	bars(person: string) {
		return this.page.evaluate((p) => (window as unknown as Win).__mainspringLanes.bars(p), person);
	}
	leaves(person: string) {
		return this.page.evaluate(
			(p) => (window as unknown as Win).__mainspringLanes.leaves(p),
			person,
		);
	}
	bands(person: string) {
		return this.page.evaluate((p) => (window as unknown as Win).__mainspringLanes.bands(p), person);
	}
	leaveTypes() {
		return this.page.evaluate(() => (window as unknown as Win).__mainspringLanes.leaveTypes());
	}
	revealPerson(person: string) {
		return this.page.evaluate(
			(p) => (window as unknown as Win).__mainspringLanes.revealPerson(p),
			person,
		);
	}
	/** A person's period (the centre of its cell), viewport px. */
	cell(person: string, col: number) {
		return this.page.evaluate(
			([p, c]) => (window as unknown as Win).__mainspringLanes.cell(p as string, c as number),
			[person, col] as const,
		);
	}

	/** Scrolls a minute of a person's lane near the plot's left; where it is, viewport px. */
	async minutePoint(person: string, minute: number): Promise<Point> {
		const first = await this.page.evaluate(
			([p, m]) =>
				(window as unknown as Win).__mainspringLanes.revealMinute(p as string, m as number),
			[person, minute] as const,
		);
		if (!first) throw new Error(`no lane for ${person}`);
		// The scroll moves the plot: ask again (it is the same scroll, so it converges) until the
		// minute is at the same place on the frames in a row.
		const at = await settledValue(
			this.page,
			([p, m]) =>
				(window as unknown as Win).__mainspringLanes.revealMinute(p as string, m as number),
			4,
			[person, minute] as const,
		);
		// The canvas is drawn for the scroll a frame or two after it (a pixel read follows).
		await frames(this.page, 3);
		return at ?? first;
	}

	/** Scrolls a bar's start near the plot's left and returns where to press it (viewport px). */
	async barPoint(person: string, task: string, nth = 0, inset?: number): Promise<Point> {
		await this.page.evaluate(
			([p, t, n]) =>
				(window as unknown as Win).__mainspringLanes.revealBar(
					p as string,
					t as string,
					n as number,
				),
			[person, task, nth] as const,
		);
		// The reveal scrolls: the bar is where to press once it holds still.
		const at = await settledValue(
			this.page,
			([p, t, n, i]) =>
				(window as unknown as Win).__mainspringLanes.barPoint(
					p as string,
					t as string,
					n as number,
					i === null ? undefined : (i as number),
				),
			4,
			[person, task, nth, inset ?? null] as const,
		);
		if (!at) throw new Error(`the bar of ${task} on ${person} is not on the screen`);
		return at;
	}

	/**
	 * The lanes' gestures listen on the overlay canvas: until it is sized and painted under `at`, a
	 * press lands on its container and is lost (seen on a slow runner: the first tap of a pair
	 * never reached the gestures). Waits for that before a press.
	 */
	async overlayUnder(at: Point): Promise<void> {
		await expect
			.poll(
				() =>
					this.page.evaluate(
						({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-testid') ?? null,
						at,
					),
				{ message: 'the lanes overlay is under the press' },
			)
			.toBe('lane-overlay');
	}

	override async tap(p: Point): Promise<void> {
		await this.overlayUnder(p);
		return super.tap(p);
	}

	override async drag(from: Point, to: Point, o: Parameters<Rig['drag']>[2] = {}): Promise<void> {
		await this.overlayUnder(from);
		return super.drag(from, to, o);
	}

	/** The app's selection (the `edits` hook): what a tap on a bar has made it. */
	selection(): Promise<unknown> {
		return this.page.evaluate(() =>
			(
				window as unknown as { __mainspringEdits: { selection(): unknown } }
			).__mainspringEdits.selection(),
		);
	}

	/** The point of a lane at a viewport x (the same x as a bar, to drop it on another person). */
	async lane(person: string, x: number): Promise<Point> {
		await this.revealPerson(person);
		const at = await settledValue(
			this.page,
			(p) => (window as unknown as Win).__mainspringLanes.lanePoint(p, 0),
			4,
			person,
		);
		if (!at) throw new Error(`no lane for ${person}`);
		return { x, y: at.y };
	}

	/** The colour of one pixel of a lanes canvas at a viewport point (CSS rgb), after it settled. */
	pixel(p: Point, layer: 'cells' | 'overlay' = 'cells'): Promise<[number, number, number, number]> {
		return this.page.evaluate(
			([pt, id]) => {
				const c = document.querySelector<HTMLCanvasElement>(`[data-testid="lane-${id}"]`);
				const ctx = c?.getContext('2d');
				if (!c || !ctx) throw new Error('no lane canvas');
				const r = c.getBoundingClientRect();
				const x = Math.round(((pt.x - r.left) * c.width) / r.width);
				const y = Math.round(((pt.y - r.top) * c.height) / r.height);
				const d = ctx.getImageData(x, y, 1, 1).data;
				return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0] as [number, number, number, number];
			},
			[p, layer] as const,
		);
	}

	/** Many pixels at once: [r, g, b] of each viewport point. */
	pixels(
		points: Point[],
		layer: 'cells' | 'overlay' = 'cells',
	): Promise<Array<[number, number, number]>> {
		return this.page.evaluate(
			([pts, id]) => {
				const c = document.querySelector<HTMLCanvasElement>(`[data-testid="lane-${id}"]`);
				const ctx = c?.getContext('2d');
				if (!c || !ctx) throw new Error('no lane canvas');
				const r = c.getBoundingClientRect();
				return pts.map((pt) => {
					const x = Math.round(((pt.x - r.left) * c.width) / r.width);
					const y = Math.round(((pt.y - r.top) * c.height) / r.height);
					const d = ctx.getImageData(x, y, 1, 1).data;
					return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0] as [number, number, number];
				});
			},
			[points, layer] as const,
		);
	}

	/** A CSS token's colour as the canvas reads it (rgb), from the lanes' own element. */
	token(name: string): Promise<[number, number, number]> {
		return this.page.evaluate((n) => {
			const el = document.querySelector('[data-testid="lanes"]');
			if (!el) throw new Error('no lanes');
			const v = getComputedStyle(el).getPropertyValue(n).trim();
			const c = document.createElement('canvas').getContext('2d');
			if (!c) throw new Error('no canvas');
			c.fillStyle = v;
			c.fillRect(0, 0, 1, 1);
			const d = c.getImageData(0, 0, 1, 1).data;
			return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0] as [number, number, number];
		}, name);
	}

	/** The toast texts now on screen (a phone shows refusals only). */
	toasts(): Promise<string[]> {
		return this.page.getByTestId('toast').allTextContents();
	}
}

/** Booked minutes per person and task, and the intervals, from a result (the oracle's input). */
export function bookedOf(r: ScheduleResult): Map<string, Map<string, Array<[number, number]>>> {
	const scenario = r.project?.scenarios.find((s) => s.active)?.id;
	const out = new Map<string, Map<string, Array<[number, number]>>>();
	for (const b of r.bookings) {
		if (b.scenario !== scenario) continue;
		let tasks = out.get(b.resource);
		if (!tasks) out.set(b.resource, (tasks = new Map()));
		tasks.set(b.task, [...(tasks.get(b.task) ?? []), ...b.intervals]);
	}
	return out;
}

/** Whether a colour is within `tol` per channel of another. */
export const near = (a: readonly number[], b: readonly number[], tol = 3): boolean =>
	[0, 1, 2].every((i) => Math.abs((a[i] ?? 0) - (b[i] ?? 0)) <= tol);
