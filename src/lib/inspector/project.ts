// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the project sheet shows (phase-2.md 9.3 "Project sheet"): the plan's name, the frame's
 * start and end, the status date and the time zone, read from the symbol index and the text the
 * header is written in, so each field says what the text says. Phase 3 adds the rest of the
 * frame (phase-2.md 19.9, phase-3.md 9.6): the working day, the first day of the week, the time
 * format and the currency. The working hours are lib/resources/hours.ts (shared with a person).
 *
 * The frame's end is written either as a date (`- 2026-06-30`) or as a duration (`+17w`); the
 * field shows it as written, and the edit API keeps the style. Dates are read from the header in
 * UTC before any `timezone` applies, so they are shown as written, not converted.
 */
import type { SymbolIndex } from '../tjp/index';
import { printDate, printDuration, parseInterval } from '../tjp/values';
import type { Workspace } from '../workspace/workspace';
import { currentRange } from './range';
import { siteState, type FieldState } from './field';

export interface ProjectDetails {
	readonly name: string | null;
	/** The frame as written: `2026-03-02`; null when it cannot be read. */
	readonly start: string | null;
	/** `2026-06-30`, or `+17w` when the header gives a duration. */
	readonly end: string | null;
	readonly frameAt: FieldState;
	readonly now: FieldState;
	readonly timezone: FieldState;
	/** `dailyworkinghours`, as written. */
	readonly dailyHours: FieldState;
	readonly timeformat: FieldState;
	readonly currency: FieldState;
	/**
	 * The week's first day is Monday unless the last of `weekstartsmonday` and `weekstartssunday` is
	 * the Sunday one (the edit API rewrites that statement through `weekstartsmonday`).
	 */
	readonly weekStartsMonday: boolean;
}

const NOT_THERE: FieldState = { kind: 'unset' };

function frameOf(
	index: SymbolIndex,
	ws: Workspace | null,
	indexVersion: number | undefined,
): { start: string | null; end: string | null } {
	const iv = index.project?.interval;
	// The index may be older than the text: the interval is mapped to where it is now.
	const at = iv && ws ? currentRange(ws, indexVersion, iv) : null;
	const text =
		at && ws ? ws.snapshot().files.get(at.file)?.text.sliceString(at.from, at.to) : undefined;
	if (text === undefined) return { start: null, end: null };
	const p = parseInterval(text);
	if (!p.ok) return { start: null, end: null };
	const start = printDate(p.value.start);
	let end: string | null = null;
	if (p.value.end?.kind === 'date') {
		const d = printDate(p.value.end.date);
		end = d.ok ? d.value : null;
	} else if (p.value.end?.kind === 'duration') {
		const d = printDuration(p.value.end.duration);
		end = d.ok ? `+${d.value}` : null;
	}
	return { start: start.ok ? start.value : null, end };
}

/** The project's details, or null when the plan has no `project` header. */
export function projectDetails(
	index: SymbolIndex,
	ws: Workspace | null,
	indexVersion?: number,
): ProjectDetails | null {
	const p = index.project;
	if (!p) return null;
	const site = (keyword: string): FieldState => {
		// The last statement is the one TaskJuggler keeps and an edit rewrites.
		const s = p.attrs.findLast((a) => a.keyword === keyword && a.scenario === null);
		return s ? siteState(s) : NOT_THERE;
	};
	const frame = frameOf(index, ws, indexVersion);
	return {
		name: p.name,
		...frame,
		frameAt: p.interval ? { kind: 'own', text: '', at: p.interval } : NOT_THERE,
		now: site('now'),
		timezone: site('timezone'),
		dailyHours: site('dailyworkinghours'),
		timeformat: site('timeformat'),
		currency: site('currency'),
		weekStartsMonday:
			p.attrs.findLast(
				(a) =>
					(a.keyword === 'weekstartsmonday' || a.keyword === 'weekstartssunday') &&
					a.scenario === null,
			)?.keyword !== 'weekstartssunday',
	};
}
