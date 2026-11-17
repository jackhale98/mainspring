// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the details of the selected days list (phase-3.md 9.5, 7.1 W5): the leaves and holidays on
 * them, each once however many of the days it covers, the leaves that no text item names (shift or
 * macro: text only), the milestones, and how many of the days are working days. Read from the
 * per-day facts (facts.ts); nothing here reads the engine or the text.
 */
import type { DayFacts, LeaveEntry, MilestoneEntry } from './facts';

export interface SelectionDetails {
	readonly lo: number;
	readonly hi: number;
	readonly days: number;
	/** Days with working time (or working time lost to leave). */
	readonly working: number;
	/** The global leaves, each once. */
	readonly holidays: readonly LeaveEntry[];
	/** The scope's own leaves with a text item (the ones the details can edit), each once. */
	readonly own: readonly LeaveEntry[];
	/** Leaves inherited from a parent group, each once. */
	readonly groups: readonly LeaveEntry[];
	/** Leaves with no text item: the engine's, from a shift or a macro. One per type. */
	readonly textOnly: readonly LeaveEntry[];
	readonly milestones: readonly MilestoneEntry[];
}

const keyOf = (e: LeaveEntry): string =>
	e.item ? `${e.item.range.file}:${e.item.range.from}-${e.item.range.to}` : `~${e.from}:${e.type}`;

/** The details of days `lo` to `hi` inclusive. */
export function detailsOf(
	facts: (day: number) => DayFacts,
	lo: number,
	hi: number,
): SelectionDetails {
	const seen = new Set<string>();
	const holidays: LeaveEntry[] = [];
	const own: LeaveEntry[] = [];
	const groups: LeaveEntry[] = [];
	const textOnly: LeaveEntry[] = [];
	const milestones = new Map<string, MilestoneEntry>();
	let working = 0;
	for (let i = lo; i <= hi; i++) {
		const f = facts(i);
		if (f.working) working++;
		for (const e of [...f.holidays, ...f.leaves]) {
			const k = keyOf(e);
			if (seen.has(k)) continue;
			seen.add(k);
			if (e.item === null) textOnly.push(e);
			else if (e.from === 'global') holidays.push(e);
			else if (e.from === 'group') groups.push(e);
			else own.push(e);
		}
		for (const m of f.milestones) milestones.set(m.task, m);
	}
	return {
		lo,
		hi,
		days: hi - lo + 1,
		working,
		holidays,
		own,
		groups,
		textOnly,
		milestones: [...milestones.values()],
	};
}
