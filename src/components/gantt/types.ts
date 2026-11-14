// SPDX-License-Identifier: GPL-2.0-or-later
/** Types the Gantt's components share with its non-component modules (a `.ts` cannot import a type from a `.svelte` file). */

/** A person in the palette. */
export interface Person {
	readonly id: string;
	readonly name: string;
	/** The person's place in the plan's resource list: picks the avatar colour. */
	readonly index: number;
}

/** A row-menu item: the key that does the same is `aria` (`aria-keyshortcuts`) and `show`. */
export interface RowAction {
	readonly id: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly aria?: string;
	readonly show?: string;
}
