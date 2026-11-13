// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The global keyboard shortcuts (phase-2.md 9.1): Cmd or Ctrl with 1, 2 or 3 picks Text, Split or
 * Visual from anywhere, including the editor. Shift and Alt change the meaning, so they are left
 * alone (a screen reader or the browser may own them). This is pure: the app listens and calls.
 */
import { VIEW_MODES, type ViewMode } from './view-mode';

export interface KeyLike {
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
	readonly isComposing?: boolean;
}

/** The mode a key press asks for, or null when it is not one of the three shortcuts. */
export function modeForKey(e: KeyLike): ViewMode | null {
	if (e.isComposing) return null;
	if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
	if (e.ctrlKey && e.metaKey) return null;
	const n = Number(e.key);
	return Number.isInteger(n) && n >= 1 && n <= VIEW_MODES.length
		? (VIEW_MODES[n - 1] ?? null)
		: null;
}
