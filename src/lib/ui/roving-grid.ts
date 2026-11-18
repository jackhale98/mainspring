// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The keyboard focus of a grid that is rebuilt under the person's hands (ADR-0016 #3, "Grid focus").
 * Owner: ui-builder. Used by the heatmap and the lanes (HeatGrid), the Gantt's outline (OutlineGrid)
 * and the Calendar's month; the contract spec is tests/e2e/primitives/grid-focus.spec.ts (on the dev
 * page /dev/primitives) and each consumer's own specs run on every change here.
 *
 * Two rules, both learned the hard way:
 *
 * 1. Roving tab stop, keyed by cell. Exactly one cell of the grid is in the tab order: the cell the
 *    focus is on (the "focus key"), if it is in the window the grid draws, else the first cell of
 *    the window (`tabStop`). A key, not an element: the elements are replaced when the grid rebuilds.
 * 2. Focus kept across a rebuild. A rebuild (a zoom, the demand arriving, a resize, a month change)
 *    removes the focused cell's element, and the browser drops the focus to the body. The grid
 *    remembers that it held the focus (`holding`) and, once the rebuild is in the DOM, `restore`s it
 *    to the cell with the focus key, unless the person moved it elsewhere on purpose. Told apart by
 *    what `focusout` says: a related target outside the grid, or a blur whose element is still in
 *    the page (a click on nothing), lets go; a blur whose element has been removed is held.
 *
 * It holds no DOM of its own: the owner says how to find a cell by key (`find`) and which key an
 * event's target is in (`keyOf`), and calls `focusin`, `focusout` from the grid's events and
 * `restore` after each rebuild (in a `tick`, once the new cells are mounted).
 */

export interface RovingOptions<K> {
	/** The grid's element (it may not be mounted yet). */
	root: () => HTMLElement | null | undefined;
	/** The key of the cell that an event's target is in, or null (the target is not a cell). */
	keyOf: (target: EventTarget | null) => K | null;
	/** The element of the cell with this key, if it is mounted. */
	find: (root: HTMLElement, key: K) => HTMLElement | null;
	/** Defers the "was it only a click on nothing" check (a task later); the test passes its own. */
	later?: (fn: () => void) => void;
}

/** The cell with the tab stop: the focus key when the window holds it, else the window's first. */
export function tabStop<K>(
	focus: K | null,
	inWindow: (key: K) => boolean,
	first: K | null,
): K | null {
	return focus !== null && inWindow(focus) ? focus : first;
}

export class RovingGrid<K> {
	/** The grid has the keyboard focus, or had it when a rebuild took its element away. */
	holding = false;
	/** The key of the cell the focus was last on. */
	last: K | null = null;
	readonly #o: RovingOptions<K>;

	constructor(options: RovingOptions<K>) {
		this.#o = options;
	}

	/** From the grid's `focusin`: the focus is in the grid, on this cell. Returns the cell's key. */
	focusin(e: FocusEvent): K | null {
		this.holding = true;
		const key = this.#o.keyOf(e.target);
		if (key !== null) this.last = key;
		return key;
	}

	/**
	 * From the grid's `focusout`. Returns true when the focus has left the grid (to tell the owner),
	 * false when it moved to another cell of it. A focus that went to another element, or that a click
	 * on nothing dropped (its element is still in the page), is let go; one lost because a rebuild
	 * removed its element stays held for `restore`.
	 */
	focusout(e: FocusEvent): boolean {
		const root = this.#o.root();
		const to = e.relatedTarget;
		if (to instanceof Node && root?.contains(to)) return false;
		const from = e.target;
		if (to instanceof Node) this.holding = false;
		else {
			const later = this.#o.later ?? ((fn: () => void) => void setTimeout(fn, 0));
			later(() => {
				if (from instanceof Node && from.isConnected) this.holding = false;
			});
		}
		return true;
	}

	/**
	 * After a rebuild is in the DOM: puts the focus back on the cell with `key` (default: the last
	 * one) if the grid was holding it and the browser dropped it to the body. Returns whether it did.
	 */
	restore(key: K | null = this.last): boolean {
		const root = this.#o.root();
		if (!this.holding || !root || key === null) return false;
		const active = document.activeElement;
		if (active && active !== document.body) return false;
		const el = this.#o.find(root, key);
		if (!el) return false;
		el.focus({ preventScroll: true });
		return true;
	}

	/** Moves the focus to the cell with `key`, if it is mounted. */
	focusCell(key: K): boolean {
		const root = this.#o.root();
		const el = root ? this.#o.find(root, key) : null;
		if (!el) return false;
		el.focus({ preventScroll: true });
		return true;
	}
}
