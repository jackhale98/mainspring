// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The reschedule tween (phase-2.md 8.1, ADR-0009 "Motion"): when a new model arrives, a bar that
 * is on screen in both the old and the new one glides from where it was to where it now is, in
 * 150 to 200 ms, keyed by task id. It is turned off by `prefers-reduced-motion`.
 *
 * The tween is done in minutes and rows, not pixels: a bar's start, end and row are interpolated
 * and placed by the layout of the frame, so a zoom or a change of the first date (which moves
 * every pixel and no minute) does not animate, and a zoom in the middle of a tween is harmless.
 * A bar that was not scheduled before (the first schedule, a new task) appears at once.
 *
 * It costs nothing at rest: `layoutFor` returns the layout it was given until a model change
 * starts a tween. While one runs, the bars painter repaints the bars layer on each animation frame
 * (only that layer: the grid and the overlay are not touched) and stops when it ends, so there are
 * no repaints beyond the animation's own frames. A new model during a tween starts from what is
 * on screen at that moment.
 */
import { placeBar, type GanttLayout, type MutableRect } from '../layout';
import type { GanttModel, GanttRow } from '../model';

/** Where one bar stands, in the model's own units. */
interface Snap {
	readonly start: number;
	readonly end: number;
	readonly row: number;
}

interface Move {
	readonly kind: GanttRow['kind'];
	readonly index: number;
	readonly from: Snap;
	readonly to: Snap;
}

export interface MotionOptions {
	/** The clock in ms; `performance.now` by default. */
	now?: () => number;
	/** Whether the person asked for reduced motion; read from the media query by default. */
	reduced?: () => boolean;
	/** Calls back on the next animation frame; `requestAnimationFrame` by default, none without it. */
	schedule?: (callback: () => void) => number;
	cancel?: (handle: number) => void;
	durationMs?: number;
}

export const MOTION_MS = 180;

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function defaultReduced(): boolean {
	try {
		return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
	} catch {
		return false;
	}
}

export class BarMotion {
	private readonly now: () => number;
	private readonly reduced: () => boolean;
	private readonly schedule: ((callback: () => void) => number) | null;
	private readonly cancel: (handle: number) => void;
	private readonly duration: number;

	private model: GanttModel | null = null;
	private stands = new Map<string, Snap>();
	private moves = new Map<string, Move>();
	private began = 0;
	private pending = 0;
	private scratch: { x: Float64Array; y: Float64Array; w: Float64Array; h: Float64Array } | null =
		null;
	private readonly rect: MutableRect = { x: 0, y: 0, w: 0, h: 0 };

	constructor(o: MotionOptions = {}) {
		this.now = o.now ?? (() => performance.now());
		this.reduced = o.reduced ?? defaultReduced;
		this.schedule =
			o.schedule ??
			(typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : null);
		this.cancel = o.cancel ?? ((h) => cancelAnimationFrame(h));
		this.duration = o.durationMs ?? MOTION_MS;
	}

	/** Whether a tween is running, as of now. */
	get animating(): boolean {
		return this.moves.size > 0 && this.now() < this.began + this.duration;
	}

	/** Where a bar is on screen now, by id: mid-tween, or at rest. */
	private shown(id: string, at: number): Snap | undefined {
		const move = this.moves.get(id);
		if (!move) return this.stands.get(id);
		const t = easeOut(Math.min(1, Math.max(0, (at - this.began) / this.duration)));
		return {
			start: lerp(move.from.start, move.to.start, t),
			end: lerp(move.from.end, move.to.end, t),
			row: lerp(move.from.row, move.to.row, t),
		};
	}

	/** Takes in a new model: finds the bars that moved and starts their tween. */
	private sync(model: GanttModel, at: number): void {
		const stands = new Map<string, Snap>();
		const moves = new Map<string, Move>();
		const animate = !this.reduced() && this.model !== null;
		model.rows.forEach((r, index) => {
			if (r.id === null || r.start === null || r.end === null) return;
			const to: Snap = { start: r.start, end: r.end, row: index };
			stands.set(r.id, to);
			const from = animate ? this.shown(r.id, at) : undefined;
			if (
				from &&
				(Math.abs(from.start - to.start) >= 1 ||
					Math.abs(from.end - to.end) >= 1 ||
					Math.abs(from.row - to.row) >= 0.01)
			) {
				moves.set(r.id, { kind: r.kind, index, from, to });
			}
		});
		this.model = model;
		this.stands = stands;
		this.moves = moves;
		this.began = at;
	}

	/**
	 * The layout to paint a frame with: the one given, or with the bars that are moving put where
	 * the tween has them. The model is compared by identity, so a new one is a reschedule.
	 */
	layoutFor(model: GanttModel, layout: GanttLayout): GanttLayout {
		const at = this.now();
		if (model !== this.model) this.sync(model, at);
		if (this.moves.size === 0) return layout;
		if (at >= this.began + this.duration) {
			this.moves = new Map();
			return layout;
		}
		const base = layout.bars;
		const n = base.x.length;
		let s = this.scratch;
		if (!s || s.x.length !== n) {
			s = {
				x: new Float64Array(n),
				y: new Float64Array(n),
				w: new Float64Array(n),
				h: new Float64Array(n),
			};
			this.scratch = s;
		}
		s.x.set(base.x);
		s.y.set(base.y);
		s.w.set(base.w);
		s.h.set(base.h);
		const t = easeOut((at - this.began) / this.duration);
		const { metrics, scale } = layout;
		for (const m of this.moves.values()) {
			if (m.index >= n) continue;
			placeBar(
				this.rect,
				m.kind,
				lerp(m.from.start, m.to.start, t),
				lerp(m.from.end, m.to.end, t),
				lerp(m.from.row, m.to.row, t) * metrics.rowHeight,
				scale,
				metrics,
			);
			s.x[m.index] = this.rect.x;
			s.y[m.index] = this.rect.y;
			s.w[m.index] = this.rect.w;
			s.h[m.index] = this.rect.h;
		}
		return layout.withBars(s);
	}

	/**
	 * Asks for `repaint` on the next animation frame while a tween runs. A later call replaces an
	 * earlier one, so a frame the app paints itself supersedes this one.
	 */
	continueWith(repaint: () => void): void {
		if (this.pending !== 0) this.cancel(this.pending);
		this.pending = 0;
		if (!this.animating || !this.schedule) return;
		this.pending = this.schedule(() => {
			this.pending = 0;
			repaint();
		});
	}
}

const byContext = new WeakMap<object, BarMotion>();

/** The motion of a bars canvas: one per context, made on first use. */
export function motionFor(ctx: CanvasRenderingContext2D): BarMotion {
	let m = byContext.get(ctx);
	if (!m) {
		m = new BarMotion();
		byContext.set(ctx, m);
	}
	return m;
}
