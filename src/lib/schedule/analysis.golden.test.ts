// SPDX-License-Identifier: GPL-2.0-or-later
// Properties of the driving-path analysis on every golden plan (phase-2.md 13.1, T5), against the
// engine's own dates. The checks use an oracle that walks TaskJuggler's slots directly, as
// TaskScenario#earliestStart and #latestEnd do (TaskScenario.rb:1173-1258), not working-time.ts:
// - float is finite and at least 0, and no late end had to be raised (`clamped` is 0) on a plan
//   that scheduled;
// - every task on the driving path, so every critical task, has zero float (no working slot
//   between its end and its late end);
// - every dependency driver sits where the oracle's earliest start (or latest end) puts it;
// - the path is connected: each task on it ends at the finish, drives a task on it, or sets the
//   end or start of a container on it;
// - every critical link is a line the Gantt draws (gantt/links.ts).
import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../../tests/golden/corpus';
import { createTimeZoneHost } from '../../engine/timezone';
import type { DependencyResult, ProjectInfo, ScheduleResult } from '../../engine/protocol';
import { resolveLinks } from '../gantt/links';
import { analyseResult } from './critical';
import { finishScenario } from './finish';

const zones = createTimeZoneHost();

/** TaskJuggler's slot walks over the project scoreboard, from the raw working-time pairs. */
function oracle(p: ProjectInfo) {
	const res = p.timingResolutionMin;
	const frameEnd = Math.round((Date.parse(p.end) - Date.parse(p.start)) / 60_000);
	const working = new Set<number>();
	for (const [a, b] of p.workingTime) for (let m = a; m < b; m += res) working.add(m);
	const noWorkingSlot = (a: number, b: number): boolean => {
		for (let m = Math.ceil(a / res) * res; m < b; m += res) if (working.has(m)) return false;
		return true;
	};
	return {
		earliest(x: number, d: DependencyResult): number {
			let at = x;
			for (let n = d.gapLengthMin / res; n > 0 && at < frameEnd; at += res) {
				if (working.has(at)) n--;
			}
			return at > x + d.gapDurationMin ? at : x + d.gapDurationMin;
		},
		latest(y: number, d: DependencyResult): number {
			let at = y;
			for (let n = d.gapLengthMin / res; n > 0 && at > 0; at -= res) {
				if (working.has(at - res)) n--;
			}
			return at < y - d.gapDurationMin ? at : y - d.gapDurationMin;
		},
		/** a and b with no working slot from a up to b (b >= a). */
		same(a: number, b: number): boolean {
			return b >= a && noWorkingSlot(a, b);
		},
	};
}

interface Row {
	id: string;
	ok: boolean;
	tasks: number;
	path: number;
	critical: number;
	links: number;
	drivers: string;
	clamped: number;
}
const rows: Row[] = [];

describe('the driving-path analysis on every golden plan', () => {
	const corpus = loadCorpus();

	it('covers the whole corpus', () => {
		expect(corpus.length).toBe(40);
	});

	for (const { plan, golden } of corpus) {
		const r: ScheduleResult = {
			...golden.result,
			revision: 1,
			timings: { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 },
		};
		it(`holds its properties (${plan.id})`, () => {
			const a = analyseResult(r, zones);
			const p = r.project;
			const scenario = finishScenario(r);
			if (!p || scenario === null) {
				expect(a).toBeNull();
				return;
			}
			if (!a) throw new Error('no analysis');
			const o = oracle(p);
			const tasks = new Map(r.tasks.map((t) => [t.id, t] as const));
			const s = (id: string) => tasks.get(id)?.scenarios[scenario];
			const dated = r.tasks.filter((t) => {
				const x = t.scenarios[scenario];
				return !!x?.scheduled && x.start !== null && x.end !== null;
			});
			const date = (id: string, end: boolean): number => {
				const x = s(id);
				return (end ? x?.end : x?.start) ?? NaN;
			};

			// Float: one value per scheduled task, finite, at least 0, nothing raised.
			expect(a.floatMin.size).toBe(dated.length);
			for (const [id, f] of a.floatMin) {
				expect(Number.isFinite(f), id).toBe(true);
				expect(f, id).toBeGreaterThanOrEqual(0);
				expect(a.lateEnd.get(id) ?? -Infinity, id).toBeGreaterThanOrEqual(date(id, true));
			}
			if (r.ok) expect(a.clamped).toBe(0);

			// Zero float on the whole path (so on every critical task), and critical within the path.
			for (const id of a.path) expect(a.floatMin.get(id), id).toBe(0);
			for (const id of a.critical) {
				const own = a.path.has(id);
				const holds = [...a.path].some((c) => c.startsWith(`${id}.`) && a.critical.has(c));
				expect(own || holds, id).toBe(true);
				expect(date(id, true), id).toBeGreaterThan(a.status ?? -Infinity);
			}

			// Drivers sit on the oracle's bound.
			for (const [id, d] of a.driver) {
				if (d.kind !== 'dependency') continue;
				const x = s(id);
				if (d.via === 'depends') {
					const entry = x?.depends.find((e) => e.task === d.pred);
					if (!entry) throw new Error(`${id}: no depends entry for ${d.pred}`);
					const e = o.earliest(date(d.pred, entry.onEnd), entry);
					expect(o.same(e, date(id, false)), `${id} after ${d.pred}`).toBe(true);
				} else {
					const entry = x?.precedes.find((e) => e.task === d.pred);
					if (!entry) throw new Error(`${id}: no precedes entry for ${d.pred}`);
					const l = o.latest(date(d.pred, entry.onEnd), entry);
					expect(o.same(date(id, true), l), `${id} before ${d.pred}`).toBe(true);
				}
			}

			// The path is connected back from the finish.
			const finish = a.finish ?? NaN;
			const drives = (pred: string, succ: string): boolean => {
				const ds = s(succ)?.depends.some(
					(e) => e.task === pred && o.same(o.earliest(date(pred, e.onEnd), e), date(succ, false)),
				);
				const ps = s(pred)?.precedes.some(
					(e) => e.task === succ && o.same(date(pred, true), o.latest(date(succ, e.onEnd), e)),
				);
				return !!ds || !!ps;
			};
			for (const id of a.path) {
				const end = date(id, true);
				const atFinish = o.same(end, finish);
				const drivesPath = [...a.path].some((succ) => succ !== id && drives(id, succ));
				const parent = tasks.get(id)?.parent ?? null;
				const setsParent =
					parent !== null &&
					a.path.has(parent) &&
					(o.same(end, date(parent, true)) || o.same(date(parent, false), date(id, false)));
				expect(atFinish || drivesPath || setsParent, `${id} is not connected`).toBe(true);
			}

			// Critical links are lines the Gantt draws from this result.
			const drawn = new Set(
				resolveLinks({ sites: [], result: r, scenario, current: true }).map(
					(l) => `${l.pred}>${l.succ}`,
				),
			);
			for (const key of a.criticalLinks) expect(drawn.has(key), key).toBe(true);

			const kinds = new Map<string, number>();
			for (const d of a.driver.values()) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
			rows.push({
				id: plan.id,
				ok: r.ok,
				tasks: dated.length,
				path: a.path.size,
				critical: a.critical.size,
				links: a.criticalLinks.size,
				drivers: [...kinds].map(([k, n]) => `${k} ${n}`).join(', '),
				clamped: a.clamped,
			});
		});
	}

	it('reports the corpus (for the gate)', () => {
		for (const x of rows) {
			console.info(
				`${x.id}: ok ${x.ok}, ${x.tasks} scheduled, path ${x.path}, critical ${x.critical}, ` +
					`links ${x.links}, clamped ${x.clamped}; drivers: ${x.drivers || 'none'}`,
			);
		}
		expect(rows.length).toBeGreaterThan(0);
	});
});
