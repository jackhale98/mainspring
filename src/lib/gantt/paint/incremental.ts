// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Repainting a layer canvas when its window moves (phase-2.md 8.1). A layer canvas holds a window of
 * the content and the window moves when the view nears its edge. Repainting the whole window at once
 * on each move, for every layer, was the cost that made scrolling stall: a window is several
 * megapixels, drawn and handed to the compositor every other frame in a fling. What this module
 * does instead, measured in headless Chrome (software canvas) on the 500-task plan:
 *
 * - A layer whose picture does not depend on y (`invariantY`: the grid, whose lines run the full
 *   height) is not painted at all on a vertical move: the canvas moves with the content and only
 *   what the caller calls dirty (the selected row's tint) is painted again.
 * - Any other move clears the canvas and paints the window in pieces, the middle first (the view
 *   is in the middle of a window that has just been put back round it) and outwards, no more than a
 *   budget (8 ms) of painting per animation frame. A piece is painted clipped and cleared, so a
 *   piece that is drawn twice or a frame that is not finished leaves no seam.
 * - A full repaint at once, in one frame, is for a change of what is drawn: a new model, layout
 *   (scale), theme, pixel ratio or window size, which the caller says with `keys`, compared by
 *   identity.
 *
 * Copying the still-valid part of the canvas onto itself with `drawImage` and painting only the
 * exposed strip was tried and measured: on a software canvas the copy costs more than painting the
 * window again (about 50 ms for one 6-megapixel canvas, against 13 ms to clear and fill one), so
 * this module does not do it. A GPU canvas copies cheaply; the numbers are in
 * docs/phases/screenshots/phase-2/frame-times.json.
 *
 * It paints nothing itself: `draw(frame, area)` draws the content that touches `area` (content
 * coordinates), already clipped and cleared by this module, under the transform of the window.
 */
import type { PaintWindow, Rect } from '../layout';
import { begin, toContent, type PaintFrame } from './canvas';

export type DrawArea<F extends PaintFrame = PaintFrame> = (f: F, area: Rect) => void;

export interface LayerOptions {
	/** Most ms of painting per call; at least one piece is always painted. */
	budgetMs?: number;
	/** The clock in ms; `performance.now` by default. */
	now?: () => number;
	/** Calls back on the next animation frame; `requestAnimationFrame` by default, none without. */
	schedule?: (callback: () => void) => number;
	cancel?: (handle: number) => void;
	/** The tallest piece painted at once, in CSS px. */
	chunkH?: number;
}

export const PAINT_BUDGET_MS = 8;

const sameKeys = (a: readonly unknown[], b: readonly unknown[]): boolean =>
	a.length === b.length && a.every((v, i) => v === b[i]);

export class IncrementalLayer<F extends PaintFrame = PaintFrame> {
	private readonly budget: number;
	private readonly now: () => number;
	private readonly schedule: ((callback: () => void) => number) | null;
	private readonly cancel: (handle: number) => void;
	private readonly chunkH: number;

	private keys: readonly unknown[] | null = null;
	private win: PaintWindow | null = null;
	private size = '';
	/** Pieces still to paint, in the order to paint them. */
	private pending: Rect[] = [];
	private handle = 0;
	private frame: F | null = null;

	constructor(
		private readonly draw: DrawArea<F>,
		o: LayerOptions = {},
	) {
		this.budget = o.budgetMs ?? PAINT_BUDGET_MS;
		this.now = o.now ?? (() => performance.now());
		this.schedule =
			o.schedule ??
			(typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : null);
		this.cancel = o.cancel ?? ((h) => cancelAnimationFrame(h));
		this.chunkH = o.chunkH ?? 160;
	}

	/** The window the canvas was last brought to, or null before the first paint. */
	get window(): PaintWindow | null {
		return this.win;
	}

	/** Whether pieces are still waiting to be painted. */
	get busy(): boolean {
		return this.pending.length > 0;
	}

	/**
	 * Brings the canvas to `f`. `keys` (compared by identity), `full`, or a window of another size
	 * paint it all at once. Otherwise a moved window is painted in pieces over frames when `sliced`
	 * (all at once if not), or with `invariantY` not at all on a vertical move; `dirty` areas
	 * (content coordinates) are painted again.
	 */
	paint(
		f: F,
		keys: readonly unknown[],
		o: { full?: boolean; dirty?: readonly Rect[]; invariantY?: boolean; sliced?: boolean } = {},
	): void {
		if (this.handle !== 0) this.cancel(this.handle);
		this.handle = 0;
		this.frame = f;
		const canvas = f.ctx.canvas;
		const size = `${canvas.width}x${canvas.height}@${f.dpr}`;
		const prev = this.win;
		const keep =
			!o.full &&
			prev !== null &&
			this.keys !== null &&
			sameKeys(this.keys, keys) &&
			prev.w === f.win.w &&
			prev.h === f.win.h &&
			this.size === size;
		if (!keep || !prev) {
			this.full(f, keys, size);
			return;
		}
		const moved = prev.x !== f.win.x || prev.y !== f.win.y;
		if (moved && !(o.invariantY && prev.x === f.win.x)) {
			if (!o.sliced) {
				this.full(f, keys, size);
				return;
			}
			// What is on the canvas is for the old window: start again, the middle first.
			this.win = f.win;
			begin(f.ctx, f.win, f.dpr);
			this.pending = this.pieces(f.win);
		} else {
			this.win = f.win;
			// What waits is in content coordinates: drop what left the window, then the dirty areas.
			this.pending = this.pending.flatMap((p) => this.clip(p, f.win));
			for (const d of o.dirty ?? []) this.pending.unshift(...this.clip(d, f.win));
		}
		this.run();
	}

	private full(f: F, keys: readonly unknown[], size: string): void {
		this.pending = [];
		this.keys = keys;
		this.win = f.win;
		this.size = size;
		begin(f.ctx, f.win, f.dpr);
		this.draw(f, f.win);
	}

	/** `r` clipped to the window, as zero or one pieces. */
	private clip(r: Rect, win: Rect): Rect[] {
		const x0 = Math.max(r.x, win.x);
		const y0 = Math.max(r.y, win.y);
		const x1 = Math.min(r.x + r.w, win.x + win.w);
		const y1 = Math.min(r.y + r.h, win.y + win.h);
		return x1 > x0 && y1 > y0 ? [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }] : [];
	}

	/** The window cut into bands of `chunkH`, the one at the middle first and then outwards. */
	private pieces(win: Rect): Rect[] {
		const out: Rect[] = [];
		for (let y = win.y; y < win.y + win.h; y += this.chunkH) {
			out.push({ x: win.x, y, w: win.w, h: Math.min(this.chunkH, win.y + win.h - y) });
		}
		const middle = win.y + win.h / 2;
		return out.sort((a, b) => Math.abs(a.y + a.h / 2 - middle) - Math.abs(b.y + b.h / 2 - middle));
	}

	/** Paints waiting pieces until the budget is spent, and asks for a frame for the rest. */
	private run(): void {
		const f = this.frame;
		const win = this.win;
		if (!f || !win) return;
		const t0 = this.now();
		while (this.pending.length > 0) {
			const piece = this.pending.shift();
			if (!piece) break;
			const { ctx, dpr } = f;
			ctx.save();
			toContent(ctx, win, dpr);
			ctx.beginPath();
			ctx.rect(piece.x, piece.y, piece.w, piece.h);
			ctx.clip();
			ctx.clearRect(piece.x, piece.y, piece.w, piece.h);
			this.draw(f, piece);
			ctx.restore();
			if (this.now() - t0 >= this.budget) break;
		}
		if (this.pending.length > 0 && this.schedule) {
			this.handle = this.schedule(() => {
				this.handle = 0;
				this.run();
			});
		}
	}
}

const layers = new WeakMap<object, Map<string, IncrementalLayer<never>>>();

/** The layer state of a canvas context, by painter name: made on first use. */
export function layerFor<F extends PaintFrame>(
	ctx: CanvasRenderingContext2D,
	name: string,
	draw: DrawArea<F>,
): IncrementalLayer<F> {
	let byName = layers.get(ctx);
	if (!byName) {
		byName = new Map();
		layers.set(ctx, byName);
	}
	let layer = byName.get(name) as IncrementalLayer<F> | undefined;
	if (!layer) {
		layer = new IncrementalLayer<F>(draw);
		byName.set(name, layer as unknown as IncrementalLayer<never>);
	}
	return layer;
}
