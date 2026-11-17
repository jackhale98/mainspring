// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the health checks: the `HealthInput` the app would build for a golden plan (its
 * recorded engine result, its text indexed with engine hints and zone data, its demand marks), or
 * for an engine result over inline plan text. Node only (reads the repository's files).
 */
import type { ScheduleResult } from '../../engine/protocol';
import { demandOf } from '../schedule/demand';
import {
	contextOf,
	goldenContext,
	goldenResult,
	inlineContext,
	zones,
} from '../schedule/explain-testing';
import type { ExplainContext } from '../schedule/explain-types';
import { applyIntent } from '../tjp/edit/apply';
import type { EditResult } from '../tjp/edit/types';
import {
	buildIndex,
	hintsFromResult,
	type ResourceId,
	type SymbolIndex,
	type TaskId,
} from '../tjp/index';
import { golden } from '../tjp/index/testing';
import type { WorkspaceSnapshot } from '../workspace/workspace';
import { checkPlan } from './report';
import {
	DEFAULT_HEALTH_SETTINGS,
	type CheckId,
	type Finding,
	type FindingOf,
	type Fix,
	type HealthInput,
	type HealthReport,
	type HealthSettings,
} from './types';

export function inputOf(
	ctx: ExplainContext,
	settings: HealthSettings = DEFAULT_HEALTH_SETTINGS,
): HealthInput {
	return {
		index: ctx.index,
		result: ctx.result,
		analysis: ctx.analysis,
		demand: demandOf(ctx),
		wt: ctx.wt,
		settings,
		availability: ctx.availability,
	};
}

/** The input of a golden plan. */
export const goldenInput = (id: string, settings?: HealthSettings): HealthInput =>
	inputOf(goldenContext(id), settings);

/** A golden plan's input with the snapshot its index was built from (for the edit API). */
export function goldenEditable(id: string): { input: HealthInput; snap: WorkspaceSnapshot } {
	const result = goldenResult(id);
	const snap = golden(id).snapshot();
	const index = buildIndex(
		snap,
		hintsFromResult(result, (_f, l) => l),
		{ cache: null, zones },
	);
	return { input: inputOf(contextOf(result, index)), snap };
}

/** The input of an engine result over inline plan text (the text names every task). */
export const inlineInput = (
	result: ScheduleResult,
	text: string,
	settings?: HealthSettings,
): HealthInput => inputOf(inlineContext(result, text), settings);

/** The report on a golden plan. */
export const goldenReport = (id: string, settings?: HealthSettings): HealthReport =>
	checkPlan(goldenInput(id, settings));

/** The findings of one check, with its facts' type. */
export function ofCheck<C extends CheckId>(findings: readonly Finding[], check: C): FindingOf<C>[] {
	return findings.filter((f) => f.check === check) as FindingOf<C>[];
}

/** Settings with every check off but `only`. */
export function only(...checks: Array<keyof HealthSettings['enabled']>): HealthSettings {
	const enabled = { ...DEFAULT_HEALTH_SETTINGS.enabled };
	for (const k of Object.keys(enabled) as Array<keyof typeof enabled>)
		enabled[k] = checks.includes(k);
	return { ...DEFAULT_HEALTH_SETTINGS, enabled };
}

/**
 * The edit a fix leads to, made by the edit API: an intent fix's own intent; "Replace person…"
 * to `to`; a pick's `addDepends` with `other` (the picked task). Null for a fix that only opens a
 * place, or when no `to` or `other` is given for it.
 */
export function probe(
	fix: Fix,
	snap: WorkspaceSnapshot,
	index: SymbolIndex,
	pick: { to?: ResourceId; other?: TaskId } = {},
): EditResult | null {
	if (fix.kind === 'intent') return applyIntent(snap, index, fix.intent);
	if (fix.kind === 'replace-person' && pick.to !== undefined) {
		return applyIntent(snap, index, {
			type: 'replaceAllocation',
			task: fix.task,
			from: fix.from,
			to: pick.to,
		});
	}
	if (fix.kind === 'pick' && pick.other !== undefined) {
		return applyIntent(
			snap,
			index,
			fix.role === 'predecessor'
				? { type: 'addDepends', task: fix.task, target: pick.other }
				: { type: 'addDepends', task: pick.other, target: fix.task },
		);
	}
	return null;
}

/**
 * Why `fix.disabled` disagrees with the edit API's answer `r`, or null when they agree: a
 * disabled fix is refused with that text-only reason, an enabled one never for a text-only one.
 */
export function disabledProblem(fix: Fix, r: EditResult): string | null {
	const textOnly = r.status === 'refused' ? (r.textOnly ?? null) : null;
	if (fix.disabled === textOnly) return null;
	if (fix.disabled === null && r.status === 'refused' && r.reason !== 'text-only') return null;
	const why = r.status === 'refused' ? ` ${r.reason} ${String(textOnly)}` : '';
	return `${fix.kind} disabled ${String(fix.disabled)}, edit API ${r.status}${why}`;
}
