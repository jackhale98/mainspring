// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Dates in text the index does not type (opaque statements such as `journalentry` or `booking`,
 * and macro bodies) against a narrowed project frame (project.ts `setProjectHeader`; phase-1.md
 * 15.22). TaskJuggler rejects many of them outside the frame (date_in_range), and the value
 * re-check (revalidate.ts) only sees typed values. A written date that may lie in the part of the
 * frame the edit removes is `invalid-value` at the date. The check is conservative: every
 * `YYYY-MM-DD[-hh:mm[:ss]]` token counts, read as UTC with a day of margin either way for the
 * zone, and only the sides of the frame that shrink are checked.
 */
import type { SourceRange } from '../index';
import { refused, type EditContext, type Refused } from './types';

const DAY = 86400;
const DATE = /(?<![\w.-])(\d{4})-(\d{2})-(\d{2})(?:-(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?![\w:])/g;

/** Seconds since the epoch of a date token read as UTC. */
function seconds(m: RegExpExecArray): number {
	const n = (i: number): number => Number(m[i] ?? 0);
	return Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6)) / 1000;
}

/**
 * `invalid-value` at untyped dates that may fall out of the frame when it changes from `before`
 * to `after` (each `[start, end]` in seconds), or null.
 */
export function checkUntypedDates(
	ctx: EditContext,
	before: readonly [number, number],
	after: readonly [number, number],
): Refused | null {
	const [s0, e0] = before;
	const [s1, e1] = after;
	const lost = (d: number): boolean =>
		(s1 > s0 && d >= s0 - DAY && d < s1 + DAY) || (e1 < e0 && d > e1 - DAY && d <= e0 + DAY);
	if (s1 <= s0 && e1 >= e0) return null;
	const at = new Map<string, SourceRange>();
	for (const [path, file] of ctx.ws.files) {
		for (const t of ctx.index.textOnly(path)) {
			if (t.reason !== 'opaque' && t.reason !== 'macro-body') continue;
			const text = file.text.sliceString(t.at.from, t.at.to);
			DATE.lastIndex = 0;
			for (let m = DATE.exec(text); m; m = DATE.exec(text)) {
				if (!lost(seconds(m))) continue;
				const from = t.at.from + m.index;
				at.set(`${path}\0${from}`, { file: path, from, to: from + m[0].length });
			}
		}
	}
	return at.size > 0 ? refused('invalid-value', [...at.values()]) : null;
}
