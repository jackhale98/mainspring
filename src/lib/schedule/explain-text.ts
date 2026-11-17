// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the explainer reads from the plan text, through the symbol index (explain.ts, demand.ts):
 * a task's size criterion, the dates written on it and its ancestors, and the `limits` statements
 * that may hold it. The engine result does not carry these. Display data (ADR-0007): nothing here
 * changes the text or the schedule.
 *
 * Scenarios follow `gantt/grid.ts` `sizingSite`: a statement counts if it names the shown
 * scenario or one of its parents, one with no prefix is the top scenario's, the nearest scenario
 * wins, and within one scenario the last statement wins.
 */
// T10: the rule is restated here instead of importing gantt/grid.ts, so that the People chunk
// (explain and demand load with it, 8.3) does not pull the Gantt grid module in.
import type { Minutes, ProjectInfo } from '../../engine/protocol';
import type { AttrSite, ResourceId, SourceRange, SymbolIndex, TaskId } from '../tjp/index';
import { resolveDate } from '../tjp/values';

export type SizeKind = 'effort' | 'length' | 'duration';

/** The shown scenario and its parents, nearest first. */
export function scenarioChainOf(p: Pick<ProjectInfo, 'scenarios'> | null, shown: string): string[] {
	const chain: string[] = [];
	let id: string | null = shown;
	while (id !== null && !chain.includes(id)) {
		chain.push(id);
		const at: string = id;
		id = p?.scenarios.find((s) => s.id === at)?.parent ?? null;
	}
	return chain;
}

/** The statement TaskJuggler keeps among `keywords` in the shown scenario, or null. */
export function nearestSite(
	attrs: readonly AttrSite[],
	keywords: ReadonlySet<string>,
	chain: readonly string[],
): AttrSite | null {
	const top = Math.max(0, chain.length - 1);
	let best: { rank: number; attr: AttrSite } | null = null;
	for (const a of attrs) {
		if (!keywords.has(a.keyword)) continue;
		const rank = a.scenario === null ? top : chain.indexOf(a.scenario);
		if (rank < 0) continue;
		if (best === null || rank <= best.rank) best = { rank, attr: a };
	}
	return best?.attr ?? null;
}

const SIZING = new Set(['effort', 'length', 'duration']);

/**
 * The size criterion of a task (setDurationAttribute: the last of `effort`, `length` and
 * `duration` wins), or null when the text has none the index can see (a milestone, a start-end
 * task, or a size written by a macro).
 */
export function sizeKindOf(
	index: SymbolIndex,
	id: TaskId,
	chain: readonly string[],
): SizeKind | null {
	const sym = index.tasks.get(id);
	const site = sym ? nearestSite(sym.attrs, SIZING, chain) : null;
	return site ? (site.keyword as SizeKind) : null;
}

/** A `start` or `end` written on the task or an ancestor. */
export interface WrittenDate {
	/** The task it is written on: the task itself, or an ancestor (`inherited`). */
	readonly task: TaskId;
	readonly attr: 'start' | 'end';
	/** Minutes since the project start; null when the value cannot be read (a macro, a zone). */
	readonly at: Minutes | null;
	readonly inherited: boolean;
	readonly site: SourceRange;
}

/**
 * The dates TaskJuggler bounds a task's start (`start`) or end (`end`) with: the task's own, then
 * each ancestor's, nearest first (TaskScenario#earliestStart and #latestEnd read the ancestors'
 * dates). `minstart` and `maxend` are not among them: TaskJuggler only checks them after
 * scheduling ("The value is not used during scheduling", TjpSyntaxRules.rb, `minstart`).
 */
// T10: 6.3 rule 1 names "a written `start` or `minstart` (`end` or `maxend` for ALAP)" for the
// bound. TaskJuggler never schedules by `minstart` or `maxend`: TaskScenario#postScheduleCheck
// only warns ('minstart', 'maxend'), and H4 reports those warnings. A bound with them would claim
// a wait TaskJuggler never made, against rule 5, so the bound leaves them out.
export function writtenDates(
	index: SymbolIndex,
	id: TaskId,
	attr: 'start' | 'end',
	chain: readonly string[],
	startEpoch: number,
): WrittenDate[] {
	const keys = new Set([attr]);
	const out: WrittenDate[] = [];
	let at: TaskId | null = id;
	for (let depth = 0; at !== null; depth++) {
		const sym = index.tasks.get(at);
		if (!sym) break;
		const site = nearestSite(sym.attrs, keys, chain);
		if (site) {
			const date = dateOf(index, site, startEpoch);
			out.push({ task: at, attr, at: date, inherited: depth > 0, site: site.statement });
		}
		at = sym.parent;
	}
	return out;
}

/** The minutes of a written date, or null when the value cannot be read. */
function dateOf(index: SymbolIndex, site: AttrSite, startEpoch: number): Minutes | null {
	if (site.textOnly || site.parsed?.kind !== 'date') return null;
	// Without zone data a local date in a zone does not resolve (`zone-data`): null.
	const r = resolveDate(
		site.parsed.value,
		index.contextAt(site.statement.file, site.statement.from),
	);
	return r.ok ? Math.round((r.value - startEpoch) / 60) : null;
}

const LIMITS = new Set(['limits']);

/**
 * The `limits` statements on a task: its own and every ancestor's (TaskScenario collects the
 * limits of the task and all its parents into `@allLimits`).
 */
export function taskLimitSites(
	index: SymbolIndex,
	id: TaskId,
	chain: readonly string[],
): SourceRange[] {
	const out: SourceRange[] = [];
	for (let at: TaskId | null = id; at !== null;) {
		const sym = index.tasks.get(at);
		if (!sym) break;
		const site = nearestSite(sym.attrs, LIMITS, chain);
		if (site) out.push(site.statement);
		at = sym.parent;
	}
	return out;
}

/**
 * The `limits` statement in force for a person: their own, else the nearest group's (a
 * resource's `limits` is inherited from its parent when it has none).
 */
export function personLimitSite(
	index: SymbolIndex,
	id: ResourceId,
	chain: readonly string[],
): SourceRange | null {
	for (let at: ResourceId | null = id; at !== null;) {
		const sym = index.resources.get(at);
		if (!sym) return null;
		const site = nearestSite(sym.attrs, LIMITS, chain);
		if (site) return site.statement;
		at = sym.parent;
	}
	return null;
}
