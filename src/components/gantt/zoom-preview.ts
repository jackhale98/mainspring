// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Zoom that shows at once and paints later. A zoom change first stretches the header and the plot
 * with a CSS transform about a point (`--zoom-ratio` and `--zoom-origin` on the grid element: a
 * compositor-side change that costs one frame), and the real zoom, which repaints the canvases,
 * follows when the target has been still for a moment. A burst of wheel events is added up and
 * applied once per frame, so only the last scale is ever painted.
 *
 * The host owns the scale and the scroll offset; this class owns the timing and the transform.
 * After the host has applied a zoom it calls `settled()`, and the stretch comes off in the frame
 * that shows the repaint, never before it.
 */
export interface ZoomPreviewHost {
	/** The element that carries the zoom variables. */
	space(): HTMLElement | undefined;
	/** The zoom the canvases are painted at, in pixels per day. */
	zoom(): number;
	/** The minute at an x offset from the left of the viewport. */
	minuteAt(x: number): number;
	/** The content x at an x offset from the left of the viewport. */
	contentX(x: number): number;
	clamp(zoom: number): number;
	/** Applies the zoom for good: scale and scroll together, one paint. */
	commit(target: number, anchorMin: number, anchorX: number): void;
}

interface Active {
	target: number;
	anchorMin: number;
	anchorX: number;
	originX: number;
	timer: ReturnType<typeof setTimeout> | null;
}

export const WHEEL_IDLE_MS = 120;
export const STEP_IDLE_MS = 80;

export class ZoomPreview {
	readonly #host: ZoomPreviewHost;
	#active: Active | null = null;
	#factor = 1;
	#anchorX = 0;
	#frame = 0;

	constructor(host: ZoomPreviewHost) {
		this.#host = host;
	}

	/** The scale being shown, while a preview is in progress. */
	get target(): number | null {
		return this.#active?.target ?? null;
	}

	/** Shows a zoom step (the zoom chip, + and -) and commits it shortly after. */
	step(target: number, anchorX: number): void {
		this.#to(target, anchorX, STEP_IDLE_MS);
	}

	/** Adds a wheel event: `deltaY` (already in pixels) scales the zoom about `anchorX`. */
	wheel(deltaY: number, anchorX: number): void {
		this.#factor *= Math.exp(-deltaY * 0.002);
		this.#anchorX = anchorX;
		if (this.#frame === 0) this.#frame = requestAnimationFrame(() => this.#applyWheel());
	}

	/** The host applied the zoom: the stretch comes off in the next frame, unless a new one began. */
	settled(): void {
		const a = this.#active;
		this.#active = null;
		if (a?.timer) clearTimeout(a.timer);
		requestAnimationFrame(() => {
			if (this.#active !== null) return;
			const space = this.#host.space();
			space?.style.removeProperty('--zoom-ratio');
			space?.style.removeProperty('--zoom-origin');
		});
	}

	dispose(): void {
		if (this.#frame !== 0) cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		if (this.#active?.timer) clearTimeout(this.#active.timer);
		this.#active = null;
	}

	#applyWheel(): void {
		this.#frame = 0;
		const factor = this.#factor;
		this.#factor = 1;
		this.#to((this.#active?.target ?? this.#host.zoom()) * factor, this.#anchorX, WHEEL_IDLE_MS);
	}

	#to(target: number, anchorX: number, idleMs: number): void {
		const space = this.#host.space();
		if (!space) return;
		// A preview in progress keeps its anchor: the date under the pointer when it began.
		this.#active ??= {
			target: this.#host.zoom(),
			anchorMin: this.#host.minuteAt(anchorX),
			anchorX,
			originX: this.#host.contentX(anchorX),
			timer: null,
		};
		const a = this.#active;
		a.target = this.#host.clamp(target);
		space.style.setProperty('--zoom-ratio', String(a.target / this.#host.zoom()));
		space.style.setProperty('--zoom-origin', `${a.originX}px`);
		if (a.timer !== null) clearTimeout(a.timer);
		a.timer = setTimeout(() => {
			if (this.#active === a) this.#host.commit(a.target, a.anchorMin, a.anchorX);
		}, idleMs);
	}
}
