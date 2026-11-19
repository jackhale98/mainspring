// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A rig for the gesture specs (tests/e2e/gantt-manipulation.spec.ts): opens the gantt-manipulation
 * sample with the hooks, finds where things are on the screen, and performs real input: a mouse
 * on desktop, and on the Pixel 7 emulation a finger through the DevTools protocol (a long-press is
 * a touch held down for 450 ms). It reads the text, the schedule's revision and the Gantt's
 * geometry through the test hooks (`?hooks=edits,gantt`); every change in the text comes from the
 * input it performs.
 */
import { expect, type CDPSession, type Locator, type Page, type TestInfo } from '@playwright/test';
import { animationsDone, frames, settledValue } from './settle';

export const READY_TIMEOUT_MS = 120_000;

export interface Point {
	x: number;
	y: number;
}
export interface BarPoints {
	row: number;
	box: { x: number; y: number; w: number; h: number };
	body: Point;
	startEdge: Point;
	endEdge: Point;
	dot: Point;
	knob: Point;
}

interface EditsHook {
	text(path?: string): string | null;
	end(task: string): number | null;
	revision(): number | null;
}
interface GanttHook {
	bar(task: string): BarPoints | null;
	x(minute: number): number;
	reveal(task: string): void;
	scroller(): { left: number; top: number; right: number; bottom: number } | null;
}
type Win = { __mainspringEdits: EditsHook; __mainspringGantt: GanttHook };

/** The project starts Monday 2026-03-02 00:00; working days are Monday to Friday, 09:00 to 17:00. */
const START = Date.UTC(2026, 2, 2);
export const minute = (date: string, hour: number): number =>
	(Date.parse(`${date}T00:00:00Z`) - START) / 60_000 + hour * 60;

export const isIphone = (info: TestInfo): boolean => info.project.name === 'iphone-14';
/** A finger: the Pixel 7 (real touch events through CDP) and the iPhone 14 (dispatched events). */
export const isTouch = (info: TestInfo): boolean =>
	info.project.name === 'pixel-7' || isIphone(info);
/** The name a device has in picture file names. */
export const deviceName = (info: TestInfo): string =>
	isIphone(info) ? 'iphone-14' : isTouch(info) ? 'pixel-7' : 'desktop';

export class Rig {
	readonly touch: boolean;
	/**
	 * Whether a finger's drag is made of dispatched pointer events instead of CDP touch events:
	 * Playwright cannot drive a touch drag in WebKit (phase-2.md 18.14), so the iPhone 14 does. The
	 * variable GANTT_DISPATCHED=1 makes Chromium do the same, to run that path where WebKit is not
	 * installed.
	 */
	readonly dispatched: boolean;
	#cdp: CDPSession | null = null;

	constructor(
		readonly page: Page,
		readonly info: TestInfo,
	) {
		this.touch = isTouch(info);
		this.dispatched = this.touch && (isIphone(info) || process.env['GANTT_DISPATCHED'] === '1');
	}

	/** Opens the sample in Visual mode (the phone's Gantt tab), ready and scheduled. */
	static async open(
		page: Page,
		info: TestInfo,
		zoom?: 'day' | 'week' | 'month',
		mode: 'visual' | 'split' = 'visual',
		sample = 'gantt-manipulation',
	): Promise<Rig> {
		const rig = new Rig(page, info);
		await page.goto(`/app?sample=${sample}&mode=${mode}&hooks=edits,gantt`);
		await expect(page.getByTestId('engine-status')).toHaveText('Engine: Ready', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByRole('group', { name: 'Plan status' })).toContainText('Scheduled', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(page.getByTestId('gantt-overlay')).toBeVisible();
		await rig.zoom(zoom ?? (rig.touch ? 'week' : 'day'));
		return rig;
	}

	async zoom(level: 'day' | 'week' | 'month' | 'quarter'): Promise<void> {
		await this.page.getByLabel('Zoom').selectOption(level);
		await expect(this.page.getByTestId('gantt')).toHaveAttribute('data-zoom', level);
		await this.layoutSettled();
	}

	/**
	 * The chart holds still: where a minute and the scroll position are on the screen is the same for
	 * a few frames (a zoom, a reveal, a sheet that moves the chart, first paint and fonts).
	 */
	async layoutSettled(): Promise<void> {
		await settledValue(this.page, () => {
			const g = (window as unknown as Win).__mainspringGantt;
			const sc = document.querySelector('[data-testid="gantt"] .scroller');
			return [g.x(0), g.x(1440), JSON.stringify(g.scroller()), sc?.scrollLeft, sc?.scrollTop].join(
				'|',
			);
		});
	}

	text(path?: string): Promise<string> {
		return this.page.evaluate(
			(p) => (window as unknown as Win).__mainspringEdits.text(p) ?? '',
			path,
		);
	}
	end(task: string): Promise<number | null> {
		return this.page.evaluate((t) => (window as unknown as Win).__mainspringEdits.end(t), task);
	}
	revision(): Promise<number> {
		return this.page.evaluate(() => (window as unknown as Win).__mainspringEdits.revision() ?? 0);
	}

	/** Scrolls a task into view and says where its bar and handles are. */
	async bar(task: string): Promise<BarPoints> {
		await this.page.evaluate((t) => (window as unknown as Win).__mainspringGantt.reveal(t), task);
		await this.layoutSettled();
		return this.peek(task);
	}

	/** Where a task's bar and handles are now, without scrolling to it. */
	async peek(task: string): Promise<BarPoints> {
		const b = await this.page.evaluate(
			(t) => (window as unknown as Win).__mainspringGantt.bar(t),
			task,
		);
		if (!b) throw new Error(`no bar for ${task}`);
		return b;
	}

	/** The viewport x of a minute, after the chart has been scrolled to the task. */
	x(m: number): Promise<number> {
		return this.page.evaluate((v) => (window as unknown as Win).__mainspringGantt.x(v), m);
	}

	row(key: string): Locator {
		return this.page.locator(`[role="row"][data-key="${key}"]`);
	}

	/** Detaches the DevTools session a real-touch drag opened (the Pixel 7); a no-op otherwise. */
	async detach(): Promise<void> {
		const cdp = this.#cdp;
		this.#cdp = null;
		await cdp?.detach().catch(() => undefined);
	}

	async #session(): Promise<CDPSession> {
		this.#cdp ??= await this.page.context().newCDPSession(this.page);
		return this.#cdp;
	}

	async #touch(type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Point): Promise<void> {
		await this.touches(type, p ? [p] : []);
	}

	/**
	 * Fingers as dispatched touch pointers (WebKit, where Playwright has no touch input): a finger
	 * that is new at `touchStart` presses the element under its point, and its moves and its release
	 * go to that same element (what pointer capture gives a real finger). Like the DevTools call it
	 * stands in for, `touchStart` and `touchMove` carry the points of every finger that is down, by
	 * position (finger 1, finger 2), and `touchEnd` lifts them all.
	 */
	async #fingers(type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]): Promise<void> {
		await this.page.evaluate(
			({ type, points }) => {
				type Finger = { el: Element; x: number; y: number };
				const w = window as unknown as {
					__fingers?: Record<number, Finger>;
					__touchmovesPrevented?: number;
					__touchmovesSent?: number;
				};
				const down = (w.__fingers ??= {});
				// A new gesture starts the counts again: they say what the page did with this one.
				if (type === 'touchStart' && Object.keys(down).length === 0) {
					w.__touchmovesPrevented = 0;
					w.__touchmovesSent = 0;
				}
				const send = (id: number, name: string, f: Finger, buttons: number): void => {
					f.el.dispatchEvent(
						new PointerEvent(name, {
							pointerId: 40 + id,
							pointerType: 'touch',
							isPrimary: id === 1,
							clientX: f.x,
							clientY: f.y,
							buttons,
							width: 1,
							height: 1,
							bubbles: true,
							cancelable: true,
							composed: true,
						}),
					);
				};
				if (type === 'touchEnd') {
					for (const [id, f] of Object.entries(down)) send(Number(id), 'pointerup', f, 0);
					w.__fingers = {};
					return;
				}
				points.forEach((p, i) => {
					const id = i + 1;
					const f = down[id];
					if (f) {
						f.x = p.x;
						f.y = p.y;
						send(id, 'pointermove', f, 1);
						// A finger on a phone also sends a cancelable touchmove, which a non-passive listener
						// may cancel to keep the browser from panning: count the ones the page cancels.
						const init = { bubbles: true, cancelable: true };
						const move =
							typeof TouchEvent === 'function'
								? new TouchEvent('touchmove', init)
								: new Event('touchmove', init);
						f.el.dispatchEvent(move);
						w.__touchmovesSent = (w.__touchmovesSent ?? 0) + 1;
						if (move.defaultPrevented) w.__touchmovesPrevented = (w.__touchmovesPrevented ?? 0) + 1;
					} else if (type === 'touchStart') {
						const fresh = { el: document.elementFromPoint(p.x, p.y) ?? document.body, ...p };
						down[id] = fresh;
						send(id, 'pointerdown', fresh, 1);
					} else {
						throw new Error('no finger is down');
					}
				});
			},
			{ type, points },
		);
	}

	/**
	 * How many dispatched `touchmove` events the page cancelled since the last call (a cancelled one
	 * keeps the browser from panning: only a gesture that owns the touch may do it). Dispatched
	 * fingers only; real touch events have no such count.
	 */
	takePreventedTouchmoves(): Promise<number> {
		return this.page.evaluate(() => {
			const w = window as unknown as { __touchmovesPrevented?: number };
			const n = w.__touchmovesPrevented ?? 0;
			w.__touchmovesPrevented = 0;
			return n;
		});
	}

	/**
	 * After a long-press drag with dispatched fingers (the iPhone): the page took the touch, so it
	 * cancelled every touchmove the drag sent after the hold and the browser did not pan or scroll
	 * under the finger. A drag that let one through would scroll the page on a real phone. The
	 * counts are of the last gesture (they restart at its `touchStart`). Real touch events (the
	 * Pixel 7) have no such count and are not checked here.
	 */
	async expectOwnsTouch(): Promise<void> {
		if (!this.dispatched) return;
		const { sent, prevented } = await this.page.evaluate(() => {
			const w = window as unknown as { __touchmovesPrevented?: number; __touchmovesSent?: number };
			return { sent: w.__touchmovesSent ?? 0, prevented: w.__touchmovesPrevented ?? 0 };
		});
		expect(sent, 'the drag sent touchmoves after its hold').toBeGreaterThan(0);
		expect(prevented, 'a long-press drag owns the touch: the page cancels every touchmove').toBe(
			sent,
		);
	}

	/** Raw touch points (one to two fingers), for the specs that need a gesture of their own. */
	async touches(type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]): Promise<void> {
		if (this.dispatched) return this.#fingers(type, points);
		const cdp = await this.#session();
		await cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })),
		});
	}

	/** The chart's scroll position, [left, top]. */
	scrollPos(): Promise<[number, number]> {
		return this.page.evaluate(() => {
			const s = document.querySelector('[data-testid="gantt"] .scroller') as HTMLElement;
			return [Math.round(s.scrollLeft), Math.round(s.scrollTop)] as [number, number];
		});
	}

	/** A tap or a click. */
	async tap(p: Point): Promise<void> {
		if (this.touch) await this.page.touchscreen.tap(p.x, p.y);
		else await this.page.mouse.click(p.x, p.y);
		// What the tap started (a selection, a sheet that slides, a repaint) is drawn.
		await frames(this.page, 3);
		await animationsDone(this.page, 0);
	}

	/**
	 * A drag from one point to another in steps. A mouse presses and moves; a finger touches,
	 * holds for `hold` ms (a long-press, 450 ms; 0 for a selected bar's handle), and moves. `via`
	 * are points to pass on the way; `pause` runs at the last point before the release.
	 */
	async drag(
		from: Point,
		to: Point,
		o: {
			hold?: number;
			steps?: number;
			/** Milliseconds between two moves (a slow drag); 0 sends them as fast as the browser takes them. */
			stepMs?: number;
			via?: Point[];
			pause?: () => Promise<void>;
		} = {},
	): Promise<void> {
		const steps = o.steps ?? 10;
		const path = [...(o.via ?? []), to];
		const walk = async (move: (p: Point) => Promise<void>): Promise<void> => {
			let at = from;
			for (const next of path) {
				for (let i = 1; i <= steps; i++) {
					// The finger's speed is the test's input (the long-press and fling logic read the clock).
					if (o.stepMs) await this.page.waitForTimeout(o.stepMs);
					await move({
						x: at.x + ((next.x - at.x) * i) / steps,
						y: at.y + ((next.y - at.y) * i) / steps,
					});
				}
				at = next;
			}
		};
		if (this.touch) {
			await this.#touch('touchStart', from);
			// A long-press is a time on the clock: the app's timer is the only state, and it shows nothing.
			if (o.hold) await this.page.waitForTimeout(o.hold);
			await walk((p) => this.#touch('touchMove', p));
			await frames(this.page, 3);
			await o.pause?.();
			await this.#touch('touchEnd');
		} else {
			await this.page.mouse.move(from.x, from.y);
			await this.page.mouse.down();
			await walk(async (p) => void (await this.page.mouse.move(p.x, p.y)));
			await frames(this.page, 3);
			await o.pause?.();
			await this.page.mouse.up();
		}
	}

	/** A long-press hold for the touch rule: the gesture's own 350 ms, plus a margin. */
	get hold(): number {
		return this.touch ? 450 : 0;
	}

	/** The people picker's search box (the combobox) and the option of one person. */
	get peopleSearch(): Locator {
		return this.page.getByRole('combobox', { name: 'Find a person by name or id' });
	}
	personOption(id: string): Locator {
		return this.page.locator(`[role="option"][data-person="${id}"]`);
	}

	/** Opens the picker's list from the toolbar's Assign button (a mouse's control). */
	async openPeople(): Promise<void> {
		await this.page.getByTestId('assign-button').click();
		await expect(this.peopleSearch).toBeFocused();
	}

	/** The middle of an option of the open list. */
	async optionPoint(id: string): Promise<Point> {
		const box = await this.personOption(id).boundingBox();
		if (!box) throw new Error(`no option for ${id}`);
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	}

	/** Selects a task by tapping its bar, and waits for the row to say so. */
	async select(task: string, key = `task:${task}`): Promise<BarPoints> {
		const b = await this.bar(task);
		await this.tap(b.body);
		await expect(this.row(key)).toHaveAttribute('aria-selected', 'true');
		// Re-read the bar: selecting shows its handles (`bar` waits for the chart to hold still).
		return this.bar(task);
	}

	/**
	 * Selects a task and has its details on screen. A desktop's docked panel shows them at once; a
	 * phone or a tablet selects on the first tap and opens its sheet on a tap on the selected bar.
	 */
	async openDetails(task: string, key = `task:${task}`): Promise<BarPoints> {
		const b = await this.select(task, key);
		if (!this.touch) return b;
		await this.tap(b.body);
		await expect(this.page.getByRole('dialog', { name: /Task details/ })).toBeVisible();
		// The sheet moves the chart (the selected row is scrolled above it): `bar` waits for it to hold still.
		await animationsDone(this.page, 0);
		return this.bar(task);
	}

	/**
	 * The painted bar of a task ends where the engine's result says it ends (13.2 step 6): the right
	 * edge on the screen is the chart's x of the finish, within rounding.
	 */
	async barOnEngine(task: string): Promise<void> {
		await expect
			.poll(
				async () => {
					const b = await this.bar(task);
					const end = await this.end(task);
					if (end === null) return Infinity;
					return Math.abs(b.box.x + b.box.w - (await this.x(end)));
				},
				{ timeout: 10_000, message: `the bar of ${task} matches the engine's finish` },
			)
			.toBeLessThan(3);
	}

	/** Waits for the engine's result that includes the edit (a newer revision). */
	async rescheduled(after: number): Promise<void> {
		await expect.poll(() => this.revision(), { timeout: READY_TIMEOUT_MS }).toBeGreaterThan(after);
	}

	/** The toasts on screen: every edit's on desktop and tablet, a phone's compact messages only. */
	get toast(): Locator {
		return this.page.getByTestId('toast');
	}

	/**
	 * What the newest edit announced: its toast, or on a phone, where a successful edit shows no
	 * toast, the visually hidden line in the same live region (`toast-quiet`).
	 */
	get edited(): Locator {
		return this.page.locator('[data-testid="toast"], [data-testid="toast-quiet"]');
	}

	#after: string | null = null;

	/** Waits for the text to be exactly the patch (the plan's "Text change"), and remembers it for redo. */
	async patched(expected: string): Promise<void> {
		await expect.poll(() => this.text()).toBe(expected);
		this.#after = expected;
	}

	/**
	 * One undo: the text is back byte for byte. A desktop or tablet uses the toast's own button; a
	 * phone has no toast for an edit, so it uses the top bar's Undo. Then one redo (the keyboard,
	 * the history's own) gives the patch again, when `patched` said what it was.
	 */
	async undoTo(original: string): Promise<void> {
		await this.undoNewest();
		await expect.poll(() => this.text()).toBe(original);
		if (this.#after !== null) await this.redoTo(this.#after);
	}

	/** One undo of the newest edit: the toast's Undo (desktop, tablet) or the top bar's (phone). */
	async undoNewest(): Promise<void> {
		if (this.touch) {
			const undo = this.page.getByTestId('undo');
			await expect(undo).toBeEnabled();
			await undo.click();
		} else {
			await expect(this.toast.last()).toBeVisible();
			await this.toast.last().getByRole('button', { name: 'Undo' }).click();
		}
	}

	/** Redo with the keyboard (the global key, with the focus off any text field). */
	async redoTo(patched: string): Promise<void> {
		await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await this.page.keyboard.press('ControlOrMeta+Shift+z');
		await expect.poll(() => this.text()).toBe(patched);
	}
}
