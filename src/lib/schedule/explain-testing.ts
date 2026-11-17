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
import { resolveDate } from '../tjp/values';
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

/**
 * The independent check of a bound (the T10 review, F4), for an ASAP effort leaf that asks for
 * people: from the raw result and the text alone (no explain*.ts code), the slot TaskJuggler
 * starts such a task in when nothing holds it. L is the latest of each `depends` entry's date
 * (TaskScenario#earliestStart: the predecessor's end or start, then `gaplength` walked slot by slot
 * over the project's working time, or `gapduration` in calendar time, whichever is later) and each
 * `start` written on the task or an ancestor; the slot is the first one at or after the slot that
 * holds L (dateToIdx truncates) in which one of the task's people works. Null when the task is not
 * such a leaf, or when a predecessor has no date or a written date cannot be read.
 */
export function firstSlotOracle(ctx: ExplainContext, id: string): number | null {
	const r = ctx.result;
	const p = r.project;
	const t = r.tasks.find((x) => x.id === id);
	const s = t?.scenarios[ctx.scenario];
	if (!p || !t || !s || s.direction !== 'asap' || s.allocate.length === 0 || t.milestone) {
		return null;
	}
	if (r.tasks.some((x) => x.parent === id)) return null;
	const chain: string[] = [];
	for (let sc: string | null = ctx.scenario; sc !== null && !chain.includes(sc);) {
		chain.push(sc);
		const at: string = sc;
		sc = p.scenarios.find((x) => x.id === at)?.parent ?? null;
	}
	const applies = (sc: string | null) => sc === null || chain.includes(sc);
	const size = (ctx.index.tasks.get(id)?.attrs ?? []).filter(
		(a) => ['effort', 'length', 'duration'].includes(a.keyword) && applies(a.scenario),
	);
	if (size.length === 0 || size.some((a) => a.keyword !== 'effort')) return null;

	const res = p.timingResolutionMin;
	const end = (Date.parse(p.end) - Date.parse(p.start)) / 60_000;
	const slots = (pairs: ReadonlyArray<readonly [number, number]>) => {
		const set = new Set<number>();
		for (const [a, b] of pairs) for (let m = a; m < b; m += res) set.add(m);
		return set;
	};
	const working = slots(p.workingTime);
	let bound = 0;
	for (const d of s.depends) {
		const o = r.tasks.find((x) => x.id === d.task)?.scenarios[ctx.scenario];
		const x = o ? (d.onEnd ? o.end : o.start) : null;
		if (x === null || x === undefined) return null;
		let date = x;
		for (let gap = d.gapLengthMin / res; gap > 0 && date < end; date += res) {
			if (working.has(date)) gap--;
		}
		bound = Math.max(bound, date > x + d.gapDurationMin ? date : x + d.gapDurationMin);
	}
	const startEpoch = Date.parse(p.start) / 1000;
	for (let at: string | null = id; at !== null; at = ctx.index.tasks.get(at)?.parent ?? null) {
		for (const a of ctx.index.tasks.get(at)?.attrs ?? []) {
			if (a.keyword !== 'start' || !applies(a.scenario)) continue;
			if (a.textOnly || a.parsed?.kind !== 'date') return null;
			const where = ctx.index.contextAt(a.statement.file, a.statement.from);
			const v = resolveDate(a.parsed.value, where);
			if (!v.ok) return null;
			bound = Math.max(bound, (v.value - startEpoch) / 60);
		}
	}

	const leavesOf = (rid: string): string[] => {
		const x = r.resources.find((y) => y.id === rid);
		if (!x) return [];
		if (!x.group) return [rid];
		return r.resources.filter((y) => y.parent === rid).flatMap((y) => leavesOf(y.id));
	};
	const people = new Set(s.allocate.flatMap((item) => item.candidates.flatMap(leavesOf)));
	const sets = [...people].map((pid) => {
		const rs = r.resources.find((y) => y.id === pid)?.scenarios[ctx.scenario];
		return slots(rs?.workingTime ?? p.workingTime);
	});
	for (let m = Math.floor(bound / res) * res; m < end; m += res) {
		if (sets.some((set) => set.has(m))) return m;
	}
	return null;
}
