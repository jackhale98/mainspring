// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which dependency lines the Gantt draws (phase-2.md 5.1), resolved from two sources:
 *
 * - The engine's result (bridge schema v2) is the source of truth for which links exist, and for
 *   their type (`onstart` and `onend`) and gaps, whenever it is current: TaskJuggler has resolved
 *   inheritance, scenarios and macros. A child's entry that only repeats its parent's is left out:
 *   the parent's line stands for it.
 * - The index's `DependencySite`s say where each link is written, so that it can later be removed.
 *   A site belongs to a link when the pred, the succ and the form (`depends` or `precedes`) agree
 *   and its scenario is the active one or one of its parents (an attribute set for a parent
 *   scenario applies to its children). A link may have several sites; they are all kept.
 *
 * When the text is newer than the result, as while typing or after an edit that broke the
 * schedule, the engine no longer describes the text: a declared link the schedule lacks is
 * 'pending', and an engine link the text does not declare is dropped. A result from an engine
 * that does not emit the v2 fields leaves the text's links, all 'declared'.
 */
import type { ScheduleResult, TaskResult, TaskScenarioResult } from '../../engine/protocol';
import type { DependencySite, TaskId } from '../tjp/index';
import type { RawLink } from './model';

export interface LinkInput {
	readonly sites: readonly DependencySite[];
	readonly result: ScheduleResult | null;
	/** The scenario the Gantt draws. */
	readonly scenario: string | null;
	/** Whether the result describes the text now (the index is no newer than it). */
	readonly current: boolean;
}

/** The scenario and its parents, nearest first. */
export function scenarioChain(result: ScheduleResult | null, scenario: string | null): string[] {
	if (scenario === null) return [];
	const byId = new Map((result?.project?.scenarios ?? []).map((s) => [s.id, s] as const));
	const chain: string[] = [];
	for (let id: string | null = scenario; id !== null && !chain.includes(id);) {
		chain.push(id);
		id = byId.get(id)?.parent ?? null;
	}
	return chain;
}

/** The ids of a task's ancestors, nearest first: `a.b.c` has `a.b` and `a`. */
function ancestors(id: string): string[] {
	const out: string[] = [];
	for (let i = id.lastIndexOf('.'); i > 0; i = id.lastIndexOf('.', i - 1)) out.push(id.slice(0, i));
	return out;
}

const linkKey = (l: Pick<RawLink, 'pred' | 'succ' | 'from' | 'to'>): string =>
	`${l.pred}>${l.succ}|${l.from}|${l.to}`;
const pairKey = (form: string, pred: TaskId, succ: TaskId): string => `${form}|${pred}|${succ}`;

interface EngineLink {
	readonly link: Omit<RawLink, 'state' | 'sites'>;
	readonly form: 'depends' | 'precedes';
}

/**
 * The engine's links for a scenario, or null when the result carries no v2 dependency fields.
 * `depends` entries lead to the task, `precedes` entries from it; an entry that an ancestor
 * has too (inheritance) is skipped.
 */
function engineLinks(result: ScheduleResult, scenario: string): EngineLink[] | null {
	const of = (t: TaskResult): Partial<TaskScenarioResult> | undefined => t.scenarios[scenario];
	const byId = new Map(result.tasks.map((t) => [t.id, t] as const));
	if (!result.tasks.some((t) => Array.isArray(of(t)?.depends))) return null;
	const out: EngineLink[] = [];
	const inherited = (id: string, list: 'depends' | 'precedes', task: string, onEnd: boolean) =>
		ancestors(id).some((a) => {
			const parent = byId.get(a);
			return (parent ? (of(parent)?.[list] ?? []) : []).some(
				(d) => d.task === task && d.onEnd === onEnd,
			);
		});
	for (const t of result.tasks) {
		const s = of(t);
		for (const d of s?.depends ?? []) {
			if (inherited(t.id, 'depends', d.task, d.onEnd)) continue;
			// This task starts after the other's end (the default) or its start (`onstart`).
			out.push({
				form: 'depends',
				link: {
					pred: d.task,
					succ: t.id,
					from: d.onEnd ? 'end' : 'start',
					to: 'start',
					gapDurationMin: d.gapDurationMin,
					gapLengthMin: d.gapLengthMin,
				},
			});
		}
		for (const d of s?.precedes ?? []) {
			if (inherited(t.id, 'precedes', d.task, d.onEnd)) continue;
			// This task ends before the other's start (the default) or its end (`onend`).
			out.push({
				form: 'precedes',
				link: {
					pred: t.id,
					succ: d.task,
					from: 'end',
					to: d.onEnd ? 'end' : 'start',
					gapDurationMin: d.gapDurationMin,
					gapLengthMin: d.gapLengthMin,
				},
			});
		}
	}
	return out;
}

export function resolveLinks(i: LinkInput): RawLink[] {
	const chain = new Set(scenarioChain(i.result, i.scenario));
	// Sites by form and ends, those of the active scenario chain only.
	const sites = new Map<string, DependencySite[]>();
	for (const site of i.sites) {
		if (site.pred === null || site.succ === null) continue;
		if (site.scenario !== null && !chain.has(site.scenario)) continue;
		const key = pairKey(site.form, site.pred, site.succ);
		sites.set(key, [...(sites.get(key) ?? []), site]);
	}

	const engine = i.result && i.scenario !== null ? engineLinks(i.result, i.scenario) : null;
	const out = new Map<string, RawLink>();
	const add = (l: RawLink): void => {
		const key = linkKey(l);
		const known = out.get(key);
		out.set(
			key,
			known
				? { ...known, sites: [...known.sites, ...l.sites.filter((x) => !known.sites.includes(x))] }
				: l,
		);
	};

	const matched = new Set<string>();
	if (engine) {
		for (const e of engine) {
			const key = pairKey(e.form, e.link.pred, e.link.succ);
			const own = sites.get(key) ?? [];
			matched.add(key);
			if (own.length === 0 && !i.current) continue; // The text no longer declares it.
			add({ ...e.link, state: own.length > 0 ? 'declared' : 'engine', sites: own });
		}
	}
	// What the text declares and the engine does not show: all of it without engine data, and
	// as 'pending' when the text is newer than the result. With a current result it is dropped:
	// the engine did not resolve it (another scenario, an override), so it does not exist.
	if (!engine || !i.current) {
		for (const [key, list] of sites) {
			if (matched.has(key)) continue;
			const first = list[0];
			if (!first || first.pred === null || first.succ === null) continue;
			add({
				pred: first.pred,
				succ: first.succ,
				from: 'end',
				to: 'start',
				state: engine ? 'pending' : 'declared',
				sites: list,
				gapDurationMin: 0,
				gapLengthMin: 0,
			});
		}
	}
	return [...out.values()];
}
