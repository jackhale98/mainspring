// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The layout the window calls for (phase-1.md 8.1): desktop from 1024 px, tablet from 600 px,
 * phone below. The view switches panels, the drawer and the tab bar with this, so that only the
 * controls of the current layout exist for the keyboard and for screen readers. The CSS uses
 * the same breakpoints for sizes and spacing.
 */
export type LayoutKind = 'phone' | 'tablet' | 'desktop';

export const TABLET_MIN = 600;
export const DESKTOP_MIN = 1024;

/** The layout for a viewport width in CSS pixels. */
export function layoutFor(width: number): LayoutKind {
	if (width >= DESKTOP_MIN) return 'desktop';
	return width >= TABLET_MIN ? 'tablet' : 'phone';
}

export class LayoutState {
	kind = $state<LayoutKind>('desktop');
	readonly #queries: MediaQueryList[];
	readonly #update: () => void;

	constructor(win: Pick<Window, 'matchMedia'> = window) {
		const tablet = win.matchMedia(`(min-width: ${TABLET_MIN}px)`);
		const desktop = win.matchMedia(`(min-width: ${DESKTOP_MIN}px)`);
		this.#queries = [tablet, desktop];
		this.#update = () => {
			this.kind = desktop.matches ? 'desktop' : tablet.matches ? 'tablet' : 'phone';
		};
		this.#update();
		for (const q of this.#queries) q.addEventListener('change', this.#update);
	}

	dispose(): void {
		for (const q of this.#queries) q.removeEventListener('change', this.#update);
	}
}
