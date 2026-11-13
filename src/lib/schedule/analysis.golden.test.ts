// SPDX-License-Identifier: GPL-2.0-or-later
// Properties of the driving-path analysis on every golden plan (phase-2.md 13.1, T5), against the
// engine's own dates and an oracle that walks TaskJuggler's slots directly (testing-oracle.ts),
// not working-time.ts. `checkAnalysis` checks both ways:
// - sound: float is finite and at least 0, nothing was raised on a plan that scheduled, every task
//   on the path and every critical task has zero float, every dependency driver sits on its bound;
// - complete: every task that ends at the finish is on the path, the path is exactly the oracle's
//   walk of the 6.2 rules (so it is connected back to the finish, follows precedes, enters
//   containers), critical tasks and links are exactly those after the status date, and a task the
//   oracle can explain by a dependency has that driver.
// Also: every critical link is a line the Gantt draws (gantt/links.ts), and plans that scheduled
// find a path at all.
import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../../tests/golden/corpus';
import { createTimeZoneHost } from '../../engine/timezone';
import type { ScheduleResult } from '../../engine/protocol';
import { resolveLinks } from '../gantt/links';
import { analyseResult } from './critical';
import { finishScenario } from './finish';
import { checkAnalysis } from './testing-oracle';

const zones = createTimeZoneHost();

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
		it(`agrees with the oracle (${plan.id})`, () => {
			const a = analyseResult(r, zones);
			const scenario = finishScenario(r);
			if (!r.project || scenario === null) {
				expect(a).toBeNull();
				return;
			}
			if (!a) throw new Error('no analysis');
			expect(checkAnalysis(r, a)).toEqual([]);
			if (r.ok && a.floatMin.size > 0) expect(a.path.size).toBeGreaterThan(0);

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
				tasks: a.floatMin.size,
				path: a.path.size,
				critical: a.critical.size,
				links: a.criticalLinks.size,
				drivers: [...kinds].map(([k, n]) => `${k} ${n}`).join(', '),
				clamped: a.clamped,
			});
		}, 60_000);
	}

	it('finds driving paths and dependency drivers across the corpus', () => {
		// Guards against an analysis that agrees with the oracle by finding nothing anywhere.
		const sum = (f: (x: Row) => number) => rows.reduce((n, x) => n + f(x), 0);
		expect(sum((x) => x.path)).toBeGreaterThan(100);
		expect(sum((x) => x.links)).toBeGreaterThan(30);
		expect(sum((x) => Number(/dependency (\d+)/.exec(x.drivers)?.[1] ?? 0))).toBeGreaterThan(1000);
		for (const x of rows) {
			console.info(
				`${x.id}: ok ${x.ok}, ${x.tasks} scheduled, path ${x.path}, critical ${x.critical}, ` +
					`links ${x.links}, clamped ${x.clamped}; drivers: ${x.drivers || 'none'}`,
			);
		}
	});
});
