// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the explainer and demand: an `ExplainContext` from a golden plan (its engine
 * result as recorded, its text through the index, with zone data), or from a hand-made result and
 * inline plan text. Node only (reads the repository's files).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../../tests/grammar/corpus';
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { buildIndex, hintsFromResult, type SymbolIndex } from '../tjp/index';
import { golden, inline } from '../tjp/index/testing';
import type { ZoneOffsets } from '../tjp/values/civil';
import { availabilityOf } from '../workload/availability';
import { analyse } from './critical';
import type { Cause, ExplainContext } from './explain-types';
import { workingTimeOf } from './working-time';

export const zones: ZoneOffsets = createTimeZoneHost();
const NO_TIMINGS = { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 };

/** The recorded result of a golden plan. */
export function goldenResult(id: string): ScheduleResult {
	const file = path.join(ROOT, 'engine/golden/expected', `${id}.json`);
	const g = JSON.parse(fs.readFileSync(file, 'utf8')) as { result: ScheduleResult };
	return { ...g.result, revision: 1, timings: NO_TIMINGS };
}

/** The first active scenario (the one every view draws). */
export function shownScenario(r: ScheduleResult): string {
	const s = r.project?.scenarios.find((x) => x.active)?.id;
	if (!s) throw new Error('no active scenario');
	return s;
}

/** The context the app would give the explainer, from a result and its index. */
export function contextOf(
	result: ScheduleResult,
	index: SymbolIndex,
	scenario = shownScenario(result),
): ExplainContext {
	if (!result.project) throw new Error('no project');
	const wt = workingTimeOf(result.project, zones);
	return {
		result,
		scenario,
		index,
		analysis: analyse(result, scenario, wt),
		wt,
		availability: availabilityOf(result, scenario),
	};
}

/** The context of a golden plan, its index built with engine hints and zone data. */
export function goldenContext(id: string, scenario?: string): ExplainContext {
	const result = goldenResult(id);
	const index = buildIndex(
		golden(id).snapshot(),
		hintsFromResult(result, (_f, l) => l),
		{
			cache: null,
			zones,
		},
	);
	return contextOf(result, index, scenario);
}

/** The context of a hand-made result over inline plan text (the text names every task). */
export function inlineContext(result: ScheduleResult, text: string): ExplainContext {
	const index = buildIndex(inline({ 'plan.tjp': text }).snapshot(), undefined, {
		cache: null,
		zones,
	});
	return contextOf(result, index);
}

type Windowed = Extract<Cause, { window: [number, number] }>;

/** The causes that carry a window (busy, leave, off hours). */
export function windowed(causes: readonly Cause[]): Windowed[] {
	return causes.filter((c): c is Windowed => 'window' in c);
}

/**
 * What breaks the partition property (13.1): for each person, their own windowed causes and the
 * project's (`resource: null`) tile [from, to) exactly, without overlap; no windowed cause extends
 * outside it or names someone else. Empty when it holds.
 */
export function partitionProblems(
	causes: readonly Cause[],
	people: readonly string[],
	from: number,
	to: number,
): string[] {
	const out: string[] = [];
	const list = windowed(causes);
	for (const c of list) {
		const [a, b] = c.window;
		if (a < from || b > to || b <= a) out.push(`${c.kind} [${a}, ${b}) outside [${from}, ${to})`);
		if (c.resource !== null && !people.includes(c.resource)) {
			out.push(`${c.kind} names ${c.resource}`);
		}
	}
	for (const p of people) {
		const mine = list
			.filter((c) => c.resource === p || c.resource === null)
			.sort((x, y) => x.window[0] - y.window[0]);
		let t = from;
		for (const c of mine) {
			if (c.window[0] !== t) out.push(`${p}: ${c.kind} starts at ${c.window[0]}, expected ${t}`);
			t = c.window[1];
		}
		if (t !== to) out.push(`${p}: the causes end at ${t}, expected ${to}`);
	}
	return out;
}
