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
	): Promise<Rig> {
		const rig = new Rig(page, info);
		await page.goto(`/app?sample=gantt-manipulation&mode=${mode}&hooks=edits,gantt`);
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

	async zoom(level: 'day' | 'week' | 'month'): Promise<void> {
		await this.page.getByLabel('Zoom').selectOption(level);
		await expect(this.page.getByTestId('gantt')).toHaveAttribute('data-zoom', level);
		await this.page.waitForTimeout(400);
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
		await this.page.waitForTimeout(250);
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

	async #session(): Promise<CDPSession> {
		this.#cdp ??= await this.page.context().newCDPSession(this.page);
		return this.#cdp;
	}

	async #touch(type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Point): Promise<void> {
		if (this.dispatched) await this.#pointer(type, p);
		else await this.touches(type, p ? [p] : []);
	}

	/**
	 * One finger as a dispatched touch pointer: the press goes to the element under the point, and
	 * the moves and the release go to the same element (what pointer capture gives a real finger).
	 */
	async #pointer(type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Point): Promise<void> {
		await this.page.evaluate(
			({ type, p }) => {
				const w = window as unknown as { __finger?: { el: Element; x: number; y: number } };
				if (type === 'touchStart' && p) {
					w.__finger = { el: document.elementFromPoint(p.x, p.y) ?? document.body, x: p.x, y: p.y };
				}
				const f = w.__finger;
				if (!f) throw new Error('no finger is down');
				if (p) {
					f.x = p.x;
					f.y = p.y;
				}
				const name = { touchStart: 'pointerdown', touchMove: 'pointermove', touchEnd: 'pointerup' }[
					type
				];
				f.el.dispatchEvent(
					new PointerEvent(name, {
						pointerId: 41,
						pointerType: 'touch',
						isPrimary: true,
						clientX: f.x,
						clientY: f.y,
						buttons: type === 'touchEnd' ? 0 : 1,
						width: 1,
						height: 1,
						bubbles: true,
						cancelable: true,
						composed: true,
					}),
				);
				if (type === 'touchEnd') delete w.__finger;
			},
			{ type, p },
		);
	}

	/** Raw touch points (one to two fingers), for the specs that need a gesture of their own. */
	async touches(type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]): Promise<void> {
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
		await this.page.waitForTimeout(150);
	}

	/**
	 * A drag from one point to another in steps. A mouse presses and moves; a finger touches,
	 * holds for `hold` ms (a long-press, 450 ms; 0 for a selected bar's handle), and moves. `via`
	 * are points to pass on the way; `pause` runs at the last point before the release.
	 */
	async drag(
		from: Point,
		to: Point,
		o: { hold?: number; steps?: number; via?: Point[]; pause?: () => Promise<void> } = {},
	): Promise<void> {
		const steps = o.steps ?? 10;
		const path = [...(o.via ?? []), to];
		const walk = async (move: (p: Point) => Promise<void>): Promise<void> => {
			let at = from;
			for (const next of path) {
				for (let i = 1; i <= steps; i++) {
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
			await this.page.waitForTimeout(o.hold ?? 0);
			await walk((p) => this.#touch('touchMove', p));
			await this.page.waitForTimeout(120);
			await o.pause?.();
			await this.#touch('touchEnd');
		} else {
			await this.page.mouse.move(from.x, from.y);
			await this.page.mouse.down();
			await walk(async (p) => void (await this.page.mouse.move(p.x, p.y)));
			await this.page.waitForTimeout(120);
			await o.pause?.();
			await this.page.mouse.up();
		}
	}

	/** A long-press hold for the touch rule: the gesture's own 350 ms, plus a margin. */
	get hold(): number {
		return this.touch ? 450 : 0;
	}

	/** Selects a task by tapping its bar, and waits for the row to say so. */
	async select(task: string, key = `task:${task}`): Promise<BarPoints> {
		const b = await this.bar(task);
		await this.tap(b.body);
		await expect(this.row(key)).toHaveAttribute('aria-selected', 'true');
		// Re-read the bar: selecting shows its handles.
		await this.page.waitForTimeout(400);
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
		// The sheet moves the chart (the selected row is scrolled above it).
		await this.page.waitForTimeout(400);
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
