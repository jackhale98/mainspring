// SPDX-License-Identifier: GPL-2.0-or-later
// formatFile (7.3): changes the indentation at the start of lines and the whitespace at their end,
// nothing else, and leaves lines that start inside a string, comment or macro body alone. The
// intent is produced by `formatFile`, so the harness calls that instead of `applyIntent`.
import { lineEndOf, lineStartOf, type Facts, type Sem } from '../gen/facts';
import type { Change, Family } from './types';

const hws = (c: string | undefined): boolean => c === ' ' || c === '\t';

/** Whether a change is whitespace at the start or end of a line and outside the no-touch ranges. */
export function formatAllows(c: Change, f: Facts): boolean {
	const old = f.texts[c.file] ?? '';
	if (!/^[ \t]*$/.test(old.slice(c.from, c.to)) || !/^[ \t]*$/.test(c.insert)) return false;
	for (const r of f.noTouch) {
		if (r.file !== c.file) continue;
		if (c.from < r.to && c.to > r.from) return false;
		if (c.from === c.to && c.from > r.from && c.from < r.to) return false;
	}
	const ls = lineStartOf(old, c.from);
	let first = ls;
	while (hws(old[first])) first++;
	if (c.to <= first) return true;
	const le = lineEndOf(old, c.to);
	let last = le;
	while (last > ls && hws(old[last - 1])) last--;
	return c.from >= last;
}

export const formatFamily: Family = {
	name: 'format',
	types: ['format'],
	draw(_type, f, _sem, rng) {
		return { intent: { type: 'format', file: rng.pick(Object.keys(f.texts)) } };
	},
	region: () => formatAllows,
	expect: (sem): Sem => sem,
};
