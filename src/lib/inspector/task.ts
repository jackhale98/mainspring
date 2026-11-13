// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Everything the task inspector shows about one task (phase-2.md 9.3), read from the symbol
 * index and from the schedule the Gantt shows, as plain data. The component only draws it and
 * dispatches intents; nothing here changes the text or computes a schedule (ADR-0007).
 *
 * - Fields come from the index (field.ts): what the text says, with where it is inherited from or
 *   why it is text-only.
 * - Size follows the task list's rule (gantt/grid.ts `sizingSite`): the last of `effort`, `length`
 *   and `duration` written for the shown scenario wins. It is editable only when that statement is
 *   the top scenario's, which is what the edit API rewrites.
 * - The schedule block is read from the shown result and its driving analysis: the engine's
 *   dates, float and the driver are labelled estimates where they are (ADR-0007).
 * - People are the engine's allocations joined with the text's, so a person who comes from a
 *   parent task is listed without a Remove.
 * - `openEnded` is the 11.1 case: a leaf with a person booked and no size and no end, which
 *   TaskJuggler runs to the project end.
 */
import type {
	Minutes,
	ProjectInfo,
	ScheduleResult,
	TaskScenarioResult,
} from '../../engine/protocol';
import { scenarioChain, sizingSite } from '../gantt/grid';
import { scenarioOf } from '../gantt/intents-facts';
import type { OutlineReason } from '../state/outline';
import type { Driver, DrivingAnalysis } from '../schedule/critical';
import { finishScenario } from '../schedule/finish';
import type {
	ResourceId,
	SourceRange,
	SymbolIndex,
	TaskId,
	TaskSymbol,
	TextOnlyReason,
} from '../tjp/index';
import type { DurationUnit } from '../tjp/values';
import { ownSite, readField, siteState, topScenario, type FieldState } from './field';

export type SizeAttr = 'effort' | 'length' | 'duration';

export interface SizeFact {
	/**
	 * `own`: the shown scenario's statement is the top scenario's, so an edit changes it.
	 * `scenario`: it is written for another scenario, which the inspector does not edit.
	 * `blocked`: a container or an explicit milestone, which cannot have a size.
	 */
	readonly kind: 'none' | 'own' | 'text-only' | 'scenario' | 'blocked';
	readonly attr: SizeAttr;
	readonly amount: number | null;
	readonly unit: DurationUnit | null;
	readonly text: string | null;
	readonly at: SourceRange | null;
	readonly scenario: string | null;
	readonly why: 'container' | 'milestone' | null;
	/** For `text-only`: why the editor cannot read it. */
	readonly reason: TextOnlyReason | 'unreadable' | null;
}

/** A list attribute (`flags`, `responsible`): what the task writes and what it inherits. */
export interface ListFact {
	readonly own: readonly string[];
	readonly inherited: readonly string[];
	readonly textOnly: SourceRange | null;
}

export interface PersonFact {
	readonly id: ResourceId;
	readonly name: string;
	/** Written on this task, so it can be removed or replaced here. */
	readonly own: boolean;
}

export interface EngineFact {
	readonly scheduled: boolean;
	readonly start: Minutes | null;
	readonly end: Minutes | null;
	readonly direction: 'asap' | 'alap' | null;
	/** Display estimates (ADR-0007); null until the analysis is ready. */
	readonly critical: boolean | null;
	readonly floatMin: number | null;
	readonly driver: Driver | null;
	readonly driverName: string | null;
}

export interface TaskDetails {
	readonly id: TaskId;
	readonly sym: TaskSymbol;
	readonly name: string;
	/** The whole declaration is text only (a macro builds it). */
	readonly declaration: OutlineReason | null;
	readonly container: boolean;
	/** `milestone` is written on the task. */
	readonly milestone: boolean;
	readonly milestoneAt: SourceRange | null;
	/** TaskJuggler treats it as a milestone without the keyword (no size, nobody booked). */
	readonly impliedMilestone: boolean;
	readonly size: SizeFact;
	readonly start: FieldState;
	readonly end: FieldState;
	readonly minstart: FieldState;
	readonly maxend: FieldState;
	readonly scheduling: FieldState;
	readonly priority: FieldState;
	readonly complete: FieldState;
	readonly note: FieldState;
	readonly flags: ListFact;
	readonly responsible: ListFact;
	readonly people: readonly PersonFact[];
	readonly engine: EngineFact;
	/** A leaf with someone booked, no size and no end: TaskJuggler runs it to the project end. */
	readonly openEnded: boolean;
	/** The same, but only because `milestone` stops it: clearing Milestone would open it (11.1). */
	readonly openEndedIfSolid: boolean;
	readonly project: ProjectInfo | null;
}

export interface InspectInput {
	readonly index: SymbolIndex;
	/** The result the Gantt shows (`GanttAnalysis.shown`). */
	readonly result: ScheduleResult | null;
	readonly analysis: DrivingAnalysis | null;
}

const resourceName = (index: SymbolIndex, id: ResourceId): string =>
	index.resources.get(id)?.name ?? id;

function listOf(index: SymbolIndex, sym: TaskSymbol, keyword: 'flags' | 'responsible'): ListFact {
	const top = topScenario(index);
	const sites = sym.attrs.filter(
		(a) => a.keyword === keyword && (a.scenario === null || a.scenario === top),
	);
	const blocked = sites.find((s) => s.textOnly !== null || s.parsed?.kind !== 'idList');
	const ids = (s: (typeof sites)[number]): readonly string[] =>
		s.parsed?.kind === 'idList' ? s.parsed.value : [];
	const own = [...new Set(sites.flatMap(ids))];
	const inherited: string[] = [];
	for (let p = sym.parent; p !== null;) {
		const up = index.tasks.get(p);
		if (!up) break;
		for (const a of up.attrs) {
			if (a.keyword !== keyword || (a.scenario !== null && a.scenario !== top)) continue;
			for (const id of ids(a)) if (!own.includes(id) && !inherited.includes(id)) inherited.push(id);
		}
		p = up.parent;
	}
	return { own, inherited, textOnly: blocked ? blocked.statement : null };
}

function sizeOf(
	index: SymbolIndex,
	sym: TaskSymbol,
	chain: readonly string[],
	blocked: 'container' | 'milestone' | null,
): SizeFact {
	const none: SizeFact = {
		kind: blocked ? 'blocked' : 'none',
		attr: 'effort',
		amount: null,
		unit: null,
		text: null,
		at: null,
		scenario: null,
		why: blocked,
		reason: null,
	};
	const site = sizingSite(sym, chain);
	if (site === null || blocked) return none;
	const attr = site.keyword as SizeAttr;
	const top = topScenario(index);
	const base = {
		attr,
		at: site.statement,
		scenario: site.scenario,
		why: null,
		reason: null,
	} as const;
	if (site.scenario !== null && site.scenario !== top) {
		return { ...base, kind: 'scenario', amount: null, unit: null, text: null };
	}
	const state = siteState(site);
	const d = site.parsed?.kind === 'duration' ? site.parsed.value : null;
	if (state.kind !== 'own' || d === null) {
		const reason = state.kind === 'text-only' ? state.reason : 'unreadable';
		return { ...base, kind: 'text-only', amount: null, unit: null, text: null, reason };
	}
	return { ...base, kind: 'own', amount: d.amount.value, unit: d.unit, text: state.text };
}

function peopleOf(
	index: SymbolIndex,
	id: TaskId,
	engine: TaskScenarioResult | null,
): readonly PersonFact[] {
	const top = topScenario(index);
	const own = new Set<ResourceId>();
	const written: ResourceId[] = [];
	for (const a of index.allocations) {
		if (a.task !== id || (a.scenario !== null && a.scenario !== top)) continue;
		const r = a.resource ?? a.written;
		if (a.textOnly === null) own.add(r);
		if (!written.includes(r)) written.push(r);
	}
	const ids = engine && engine.allocated.length > 0 ? engine.allocated : written;
	return ids.map((r) => ({ id: r, name: resourceName(index, r), own: own.has(r) }));
}

function engineOf(i: InspectInput, id: TaskId, s: TaskScenarioResult | null): EngineFact {
	const a = i.analysis;
	const dated = !!s?.scheduled && s.start !== null && s.end !== null;
	const driver = a?.driver.get(id) ?? null;
	const names = (t: TaskId): string => i.index.tasks.get(t)?.name ?? t;
	return {
		scheduled: dated,
		start: dated ? (s?.start ?? null) : null,
		end: dated ? (s?.end ?? null) : null,
		direction: s?.direction ?? null,
		critical: a && dated ? a.critical.has(id) : null,
		floatMin: a && dated ? (a.floatMin.get(id) ?? null) : null,
		driver,
		driverName: driver?.kind === 'dependency' ? names(driver.pred) : null,
	};
}

/** The details of a task, or null when the index does not know it. */
export function taskDetails(i: InspectInput, id: TaskId): TaskDetails | null {
	const { index, result } = i;
	const sym = index.tasks.get(id);
	if (!sym) return null;
	const project = result?.project ?? null;
	const scenario = result ? finishScenario(result) : null;
	const chain = scenarioChain(project, scenario);
	const engine = scenarioOf(result, id);
	const engineTask = result?.tasks.find((t) => t.id === id);
	const container = sym.children.length > 0;
	const milestoneSite = ownSite(index, sym, 'milestone');
	const milestone = milestoneSite !== null;
	const size = sizeOf(index, sym, chain, container ? 'container' : milestone ? 'milestone' : null);
	const people = peopleOf(index, id, engine);
	const end = readField(index, sym, 'end');
	const runsOpen =
		!container && people.length > 0 && end.kind === 'unset' && sizingSite(sym, chain) === null;
	return {
		id,
		sym,
		name: sym.name ?? sym.localId,
		declaration: sym.textOnly ? sym.textOnly.reason : sym.expandedOnly ? 'expanded-only' : null,
		container,
		milestone,
		milestoneAt: milestoneSite?.statement ?? null,
		impliedMilestone: !milestone && !container && !!engineTask?.milestone,
		size,
		start: readField(index, sym, 'start'),
		end,
		minstart: readField(index, sym, 'minstart', true),
		maxend: readField(index, sym, 'maxend', true),
		scheduling: readField(index, sym, 'scheduling', true),
		priority: readField(index, sym, 'priority', true),
		complete: readField(index, sym, 'complete'),
		note: readField(index, sym, 'note'),
		flags: listOf(index, sym, 'flags'),
		responsible: listOf(index, sym, 'responsible'),
		people,
		engine: engineOf(i, id, engine),
		openEnded: runsOpen && !milestone,
		openEndedIfSolid: runsOpen && milestone,
		project,
	};
}

/** Resources a person can be added from: those that are not a group of others. */
export function assignable(index: SymbolIndex): ReadonlyArray<{ id: ResourceId; name: string }> {
	return [...index.resources.values()]
		.filter((r) => r.children.length === 0)
		.map((r) => ({ id: r.id, name: r.name ?? r.id }));
}

/** Flags the plan declares, for the flag chips' picker. */
export function declaredFlags(index: SymbolIndex): readonly string[] {
	return [...index.flags.keys()];
}
