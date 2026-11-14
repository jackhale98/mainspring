// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The Gantt's keyboard model beyond moving about the treegrid (phase-2.md 7.1, 10.2): every
 * gesture has a key, as a pure map from a key press to a command, so the keys are tested without a
 * DOM. The treegrid's own keys (arrows, Home and End, Enter, Space, F2) are `grid-nav.ts`; the
 * keys here take over what it leaves free (Alt and Shift combinations, single letters) and work
 * only while the focus is in the treegrid, never in the editor (10.2).
 *
 * | Keys | Command | Row |
 * | --- | --- | --- |
 * | Ctrl+Alt+Right, Left (Cmd or Ctrl) | size by one written unit | R1 |
 * | Alt+Right, Left | move by one working day | R2 |
 * | L, then Up and Down, Enter | link mode: pick the successor | R3 |
 * | Alt+Shift+Up, Down | one place up or down among the siblings | R5 |
 * | Alt+Shift+Right, Left | indent (one level in) or outdent (one level out) | R5 |
 * | P, then Left and Right | progress by 5 %, Enter or Escape to leave | R9 |
 * | T | scroll to today | R10 |
 * | Insert, Ctrl or Cmd+Enter | add a task after | extra |
 * | Delete | delete the task (or the selected link) | extra |
 *
 * The user chose these like MS Project's (2026-11-14); `event.key` arrows are read, so a layout
 * does not change them. Some systems keep chords for themselves: Ctrl+Alt+Left and Right switch
 * workspaces on GNOME, Ctrl+Option is VoiceOver's key on macOS, and Cmd+Option+Left and Right
 * switch tabs in Chrome there. A page cannot take those from the system, so every command is
 * also a button in the row menu (WCAG 2.5.7), and `SHORTCUTS` lists the keys for
 * `aria-keyshortcuts`, the menu and the shortcuts list.
 */
import type { Step } from './reorder';

export type KeyEventLike = Pick<
	KeyboardEvent,
	'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

export type GanttCommand =
	| { readonly type: 'size'; readonly steps: 1 | -1 }
	| { readonly type: 'move'; readonly days: 1 | -1 }
	| { readonly type: 'reorder'; readonly step: Step }
	| { readonly type: 'link' }
	| { readonly type: 'progress' }
	| { readonly type: 'today' }
	| { readonly type: 'add' }
	| { readonly type: 'delete' };

/** The command a key press asks for, or null when it is none of ours. */
export function commandFor(e: KeyEventLike): GanttCommand | null {
	if (e.ctrlKey || e.metaKey) {
		if (e.altKey && !e.shiftKey) {
			if (e.key === 'ArrowRight') return { type: 'size', steps: 1 };
			if (e.key === 'ArrowLeft') return { type: 'size', steps: -1 };
			return null;
		}
		return !e.altKey && !e.shiftKey && e.key === 'Enter' ? { type: 'add' } : null;
	}
	if (e.altKey) {
		if (e.shiftKey) {
			switch (e.key) {
				case 'ArrowRight':
					return { type: 'reorder', step: 'indent' };
				case 'ArrowLeft':
					return { type: 'reorder', step: 'outdent' };
				case 'ArrowUp':
					return { type: 'reorder', step: 'up' };
				case 'ArrowDown':
					return { type: 'reorder', step: 'down' };
			}
			return null;
		}
		if (e.key === 'ArrowRight') return { type: 'move', days: 1 };
		if (e.key === 'ArrowLeft') return { type: 'move', days: -1 };
		return null;
	}
	if (e.shiftKey) return null;
	switch (e.key) {
		case 'l':
		case 'L':
			return { type: 'link' };
		case 'p':
		case 'P':
			return { type: 'progress' };
		case 't':
		case 'T':
			return { type: 'today' };
		case 'Insert':
			return { type: 'add' };
		case 'Delete':
			return { type: 'delete' };
		default:
			return null;
	}
}

/** A shortcut for the menu, the list and `aria-keyshortcuts`. */
export interface Shortcut {
	readonly id:
		| 'size'
		| 'move'
		| 'reorder'
		| 'indent'
		| 'link'
		| 'progress'
		| 'today'
		| 'rename'
		| 'add'
		| 'delete';
	/** `aria-keyshortcuts` forms, one per key of the pair. */
	readonly aria: readonly string[];
	/** The keys as a person reads them. */
	readonly show: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
	{ id: 'size', aria: ['Control+Alt+ArrowRight', 'Control+Alt+ArrowLeft'], show: 'Ctrl+Alt+→ / ←' },
	{ id: 'move', aria: ['Alt+ArrowRight', 'Alt+ArrowLeft'], show: 'Alt+→ / ←' },
	{ id: 'reorder', aria: ['Alt+Shift+ArrowUp', 'Alt+Shift+ArrowDown'], show: 'Alt+Shift+↑ / ↓' },
	{ id: 'indent', aria: ['Alt+Shift+ArrowRight', 'Alt+Shift+ArrowLeft'], show: 'Alt+Shift+→ / ←' },
	{ id: 'link', aria: ['L'], show: 'L' },
	{ id: 'progress', aria: ['P'], show: 'P' },
	{ id: 'today', aria: ['T'], show: 'T' },
	{ id: 'rename', aria: ['F2'], show: 'F2' },
	{ id: 'add', aria: ['Insert', 'Control+Enter'], show: 'Insert, Ctrl+Enter' },
	{ id: 'delete', aria: ['Delete'], show: 'Delete' },
];

/** Every key of every shortcut, for the treegrid's `aria-keyshortcuts`. */
export const ALL_KEYS: string = SHORTCUTS.flatMap((s) => s.aria).join(' ');

/** What a key does in link mode: the arrows pick the successor, Enter links, Escape leaves. */
export type LinkKey = 'previous' | 'next' | 'first' | 'last' | 'confirm' | 'cancel';

export function linkKey(e: KeyEventLike): LinkKey | null {
	if (e.altKey || e.ctrlKey || e.metaKey) return null;
	switch (e.key) {
		case 'ArrowUp':
			return 'previous';
		case 'ArrowDown':
			return 'next';
		case 'Home':
			return 'first';
		case 'End':
			return 'last';
		case 'Enter':
			return 'confirm';
		case 'Escape':
			return 'cancel';
		default:
			return null;
	}
}

/** What a key does in progress mode: the change in percent, or the end of the mode. */
export type ProgressKey =
	{ readonly by: number } | { readonly to: number } | { readonly done: true };

export const PROGRESS_STEP = 5;

export function progressKey(e: KeyEventLike): ProgressKey | null {
	if (e.altKey || e.ctrlKey || e.metaKey) return null;
	switch (e.key) {
		case 'ArrowRight':
		case 'ArrowUp':
			return { by: e.shiftKey ? 4 * PROGRESS_STEP : PROGRESS_STEP };
		case 'ArrowLeft':
		case 'ArrowDown':
			return { by: e.shiftKey ? -4 * PROGRESS_STEP : -PROGRESS_STEP };
		case 'Home':
			return { to: 0 };
		case 'End':
			return { to: 100 };
		case 'Enter':
		case 'Escape':
			return { done: true };
		default:
			return null;
	}
}
