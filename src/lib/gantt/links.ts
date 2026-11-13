// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The dependency adapter (phase-2.md 5.1): which links the Gantt draws. Lines that can be removed
 * must map to text, so the source is the index's `DependencySite`s, which the index has already
 * normalised so that `pred` is the task that must finish first, for `depends` and `precedes`
 * alike. A site that names no task (a macro the index cannot resolve) is skipped, as is a site
 * that belongs to another scenario.
 *
 * The engine's resolved dependencies (bridge schema v2: inheritance, macros) join through
 * `mergeEngineLinks` as links without a site, which the view draws dashed and cannot remove.
 */
import type { ScheduleResult, TaskScenarioResult } from '../../engine/protocol';
import type { DependencySite } from '../tjp/index';
import type { RawLink } from './model';

export function linksFromIndex(
	sites: readonly DependencySite[],
	scenario: string | null,
): RawLink[] {
	const out: RawLink[] = [];
	for (const site of sites) {
		if (site.pred === null || site.succ === null) continue;
		if (site.scenario !== null && site.scenario !== scenario) continue;
		out.push({ pred: site.pred, succ: site.succ, site });
	}
	return out;
}

/** The ids of a task's ancestors, nearest first: `a.b.c` has `a.b` and `a`. */
function ancestors(id: string): string[] {
	const out: string[] = [];
	for (let i = id.lastIndexOf('.'); i > 0; i = id.lastIndexOf('.', i - 1)) out.push(id.slice(0, i));
	return out;
}

/**
 * Adds the links only the engine knows (bridge schema v2: `depends` and `precedes` after
 * inheritance and macros), as links without a site, which the view draws dashed. A link the text
 * already declares is skipped, and so is one a child only inherits from its parent: the parent's
 * own link stands for it. A result from an engine that does not emit the fields adds nothing.
 */
export function mergeEngineLinks(
	links: readonly RawLink[],
	result: ScheduleResult | null,
	scenario: string | null,
): readonly RawLink[] {
	if (result === null || scenario === null) return links;
	const known = new Set(links.map((l) => `${l.pred}>${l.succ}`));
	const out = [...links];
	const add = (pred: string, succ: string): void => {
		const key = `${pred}>${succ}`;
		if (known.has(key) || pred === succ) return;
		const inherited =
			ancestors(succ).some((a) => known.has(`${pred}>${a}`)) ||
			ancestors(pred).some((a) => known.has(`${a}>${succ}`));
		known.add(key);
		if (!inherited) out.push({ pred, succ, site: null });
	};
	for (const t of result.tasks) {
		const s = t.scenarios[scenario] as Partial<TaskScenarioResult> | undefined;
		for (const d of s?.depends ?? []) add(d.task, t.id);
		for (const d of s?.precedes ?? []) add(t.id, d.task);
	}
	return out;
}
