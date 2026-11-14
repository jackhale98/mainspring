// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The lines of the History sheet (HistorySheet.svelte): how an undo step reads, and how long ago it
 * was. `Intl` is for display only, as everywhere in the views; dates in the plan stay minutes.
 */
import { historyStrings } from '../strings';
import type { HistoryItem } from '../workspace/history';

const S = historyStrings.sheet;

/** The step as a person reads it: "Effort of Research: 3d to 4d", "Typing in plan.tjp". */
export function lineLabel(item: Pick<HistoryItem, 'kind' | 'label' | 'files'>): string {
	if (item.kind === 'typing') return historyStrings.typingIn(item.files[0] ?? '');
	// Labels from the intents are lower case ("set effort"); the dispatcher's start with a capital.
	return item.label.charAt(0).toUpperCase() + item.label.slice(1);
}

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
	['day', 86_400],
	['hour', 3_600],
	['minute', 60],
];

/** "just now", "2 min. ago", "3 hr. ago", from two times in ms (`then` before `now`). */
export function relativeTime(then: number, now: number, locale = 'en'): string {
	const seconds = Math.max(0, Math.round((now - then) / 1000));
	if (seconds < 45) return S.now;
	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
	for (const [unit, size] of UNITS) {
		if (seconds >= size * 0.9 || unit === 'minute') {
			return rtf.format(-Math.max(1, Math.round(seconds / size)), unit);
		}
	}
	return S.now;
}
