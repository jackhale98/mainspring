// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The minimal view switch for the first Gantt slice (phase-2.md 9.1). It is deliberately small
 * and isolated: task T14 replaces it with the real modes, shortcuts, per-workspace persistence
 * and dividers. Until then:
 * - Text is Phase 1's layout, Split puts the editor and the Gantt together, Visual shows the
 *   Gantt alone. The editor stays mounted in every mode, so its state and
 *   cursor survive a switch.
 * - The defaults follow the spec (18.5): Split on desktop, Visual on tablet and phone. Phones
 *   have no Split; they use the tab bar instead.
 * - `?mode=text|split|visual` picks a mode for a link or a test. Nothing is stored.
 */
import type { LayoutKind } from './layout.svelte';

export type ViewMode = 'text' | 'split' | 'visual';
export const VIEW_MODES: readonly ViewMode[] = ['text', 'split', 'visual'];

/** `gantt` is accepted for `visual`: links written before the mode was renamed keep working. */
export function modeFromParam(value: string | null): ViewMode | null {
	if (value === 'gantt') return 'visual';
	return VIEW_MODES.find((m) => m === value) ?? null;
}

export function defaultMode(layout: LayoutKind): ViewMode {
	return layout === 'desktop' ? 'split' : 'visual';
}

/** The mode that applies: the choice, or the layout's default; Split becomes Gantt on a phone. */
export function effectiveMode(choice: ViewMode | null, layout: LayoutKind): ViewMode {
	const mode = choice ?? defaultMode(layout);
	return layout === 'phone' && mode === 'split' ? 'visual' : mode;
}

/** The phone tab a mode starts on. */
export function phoneTabFor(mode: ViewMode | null): 'gantt' | 'text' {
	return mode === 'text' ? 'text' : 'gantt';
}
