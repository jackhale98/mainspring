// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What `planAction` reads about one task (intents.ts): its symbol, its own top-scenario
 * attributes as the edit API sees them (the last unprefixed, or top-scenario, site of each
 * keyword), and its dates in the scenario the Gantt draws. Pure reads of the index and the result.
 */
import type { ProjectInfo, ScheduleResult, TaskScenarioResult } from '../../engine/protocol';
import { finishScenario } from '../schedule/finish';
import type { AttrSite, SourceRange, SymbolIndex, TaskId, TaskSymbol } from '../tjp/index';
import type { DurationUnit } from '../tjp/values/duration';

export type SizingAttr = 'effort' | 'length' | 'duration';

export interface Sizing {
	readonly attr: SizingAttr;
	/** Null when the value is not a plain duration (a macro, say). */
	readonly amount: number | null;
	readonly unit: DurationUnit | null;
	readonly site: AttrSite;
}

export interface TaskFacts {
	readonly id: TaskId;
	readonly sym: TaskSymbol;
	readonly name: string;
	readonly container: boolean;
	readonly milestone: boolean;
	/** The declaration is text-only (macro-built) or only macro expansion declares it. */
	readonly textOnly: boolean;
	readonly sizing: Sizing | null;
	readonly ownStart: boolean;
	readonly ownEnd: boolean;
	/** Dates in the drawn scenario, when scheduled. */
	readonly s: TaskScenarioResult | null;
	readonly project: ProjectInfo | null;
}

const SIZING: readonly string[] = ['effort', 'length', 'duration'];

/** The task's own sites the edit API would edit: unprefixed, or of the top scenario. */
export function ownAttrs(index: SymbolIndex, sym: TaskSymbol): AttrSite[] {
	const top = index.scenarios[0]?.id ?? null;
	return sym.attrs.filter((a) => a.scenario === null || a.scenario === top);
}

const lastOf = (attrs: readonly AttrSite[], keys: readonly string[]): AttrSite | null => {
	for (let i = attrs.length - 1; i >= 0; i--) {
		const a = attrs[i] as AttrSite;
		if (keys.includes(a.keyword)) return a;
	}
	return null;
};

const resultCache = new WeakMap<ScheduleResult, Map<string, TaskScenarioResult>>();

/** The task's entry in the scenario the Gantt draws (`finishScenario`), or null. */
export function scenarioOf(result: ScheduleResult | null, id: TaskId): TaskScenarioResult | null {
	if (!result) return null;
	let byId = resultCache.get(result);
	if (!byId) {
		byId = new Map();
		const scenario = finishScenario(result);
		if (scenario !== null) {
			for (const t of result.tasks) {
				const s = t.scenarios[scenario];
				if (s) byId.set(t.id, s);
			}
		}
		resultCache.set(result, byId);
	}
	return byId.get(id) ?? null;
}

export function factsOf(
	index: SymbolIndex,
	result: ScheduleResult | null,
	id: TaskId,
): TaskFacts | null {
	const sym = index.tasks.get(id);
	if (!sym) return null;
	const attrs = ownAttrs(index, sym);
	const size = lastOf(attrs, SIZING);
	const parsed = size?.parsed;
	const duration = parsed?.kind === 'duration' ? parsed.value : null;
	const engineTask = result?.tasks.find((t) => t.id === id);
	return {
		id,
		sym,
		name: sym.name ?? sym.localId,
		container: sym.children.length > 0,
		milestone: lastOf(attrs, ['milestone']) !== null || !!engineTask?.milestone,
		textOnly: sym.textOnly !== null || sym.expandedOnly,
		sizing: size
			? {
					attr: size.keyword as SizingAttr,
					amount: duration ? duration.amount.value : null,
					unit: duration ? duration.unit : null,
					site: size,
				}
			: null,
		ownStart: lastOf(attrs, ['start']) !== null,
		ownEnd: lastOf(attrs, ['end']) !== null,
		s: scenarioOf(result, id),
		project: result?.project ?? null,
	};
}

/** Where to point at a task in the text: its header. */
export const headerOf = (f: TaskFacts): SourceRange[] => [f.sym.decl.header];

/** Whether the task, or an ancestor, allocates someone in the top scenario (the index's view). */
export function allocatedInText(index: SymbolIndex, id: TaskId): number {
	const top = index.scenarios[0]?.id ?? null;
	const up = new Set<string>();
	for (let t: string | null = id; t !== null; t = index.tasks.get(t)?.parent ?? null) up.add(t);
	const people = new Set<string>();
	for (const a of index.allocations) {
		if (a.task !== null && up.has(a.task) && (a.scenario === null || a.scenario === top)) {
			people.add(a.resource ?? a.written);
		}
	}
	return people.size;
}
