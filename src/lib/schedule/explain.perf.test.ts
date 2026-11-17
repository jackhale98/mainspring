// SPDX-License-Identifier: GPL-2.0-or-later
// Explainer and demand timings (phase-3.md 6.3, 8.3): recorded, not enforced. Targets on desktop:
// `explainTask` at most 5 ms for one task, on demand; `demandOf` at most 25 ms for the whole plan,
// in an idle task, on fedora-res and syn-20-scale-1000. The index, the driving analysis and the
// availability are built beforehand, as the app has them. Cold: a new result object for each run,
// so the result-wide tables (explain-prep.ts, cached per result) are built inside the timed call,
// as on the first call after a result arrives. This prints the median and the slowest of the runs
// (the first few left out) and asserts only a sanity bound ten times the target.
// Cold-first-call (the review, F7): the very first `explainTask` and `demandOf` in this worker, on
// fedora-res, before any other explainer code ran (module code not yet optimised), reported and
// not enforced. The app pays it once per session; T14 runs demandOf in one idle task after the
// load model and keeps it per result, so the first "Why here?" usually finds the code warm.
import { describe, expect, it } from 'vitest';
import { availabilityOf } from '../workload/availability';
import { demandOf } from './demand';
import { explainTask } from './explain';
import { goldenContext } from './explain-testing';

const PLANS = ['fedora-res', 'syn-20-scale-1000', 'gantt-500'];
const EXPLAIN_MS = 5;
const DEMAND_MS = 25;
const SANITY = 10;
const RUNS = 11;
const SKIP = 3;

const stats = (xs: number[], skip = SKIP) => {
	const s = xs.slice(skip).sort((a, b) => a - b);
	const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
	return { median: at(0.5), p90: at(0.9), max: s[s.length - 1] ?? NaN };
};
const ms = (v: { median: number; p90: number; max: number }): string =>
	`median ${v.median.toFixed(2)}, p90 ${v.p90.toFixed(2)}, max ${v.max.toFixed(2)} ms`;

describe('the first calls in a fresh worker (cold-first-call, reported only)', () => {
	it('times the first explainTask, then the first demandOf, on fedora-res', () => {
		const ctx = goldenContext('fedora-res');
		const id = 'f20.supplement_wallpaper.supplement_license_review';
		const t0 = performance.now();
		explainTask(id, ctx);
		const t1 = performance.now();
		const result = { ...ctx.result };
		const other = { ...ctx, result, availability: availabilityOf(result, ctx.scenario) };
		const t2 = performance.now();
		demandOf(other);
		const t3 = performance.now();
		console.info(
			`cold-first-call fedora-res: explainTask ${(t1 - t0).toFixed(2)} ms (tables included), ` +
				`then demandOf ${(t3 - t2).toFixed(2)} ms (its own tables), reported, not enforced`,
		);
		expect(t1 - t0).toBeGreaterThan(0);
	});
});

describe.each(PLANS)('explainer and demand timings on %s', (id) => {
	it('explains one task and computes the demand within the recorded targets', () => {
		const ctx = goldenContext(id);
		const ids = ctx.result.tasks.map((t) => t.id);
		const fresh = () => {
			const result = { ...ctx.result };
			return { ...ctx, result, availability: availabilityOf(result, ctx.scenario) };
		};

		// Demand, cold (tables built in the call) and warm.
		const cold: number[] = [];
		const warm: number[] = [];
		for (let n = 0; n < RUNS; n++) {
			const c = fresh();
			const t0 = performance.now();
			demandOf(c);
			const t1 = performance.now();
			demandOf(c);
			const t2 = performance.now();
			cold.push(t1 - t0);
			warm.push(t2 - t1);
		}

		// One task: the first call on a new result (cold), then every task of the plan (warm).
		const first: number[] = [];
		for (let n = 0; n < RUNS; n++) {
			const c = fresh();
			const t0 = performance.now();
			explainTask(ids[Math.floor(ids.length / 2)] as string, c);
			first.push(performance.now() - t0);
		}
		// Per task, the best of five rounds, so that a garbage collection in one call does not count
		// against the task; the slowest task is then named.
		const best = new Map<string, number>();
		for (let round = 0; round < 5; round++) {
			for (const t of ids) {
				const t0 = performance.now();
				explainTask(t, ctx);
				const dt = performance.now() - t0;
				best.set(t, Math.min(best.get(t) ?? Infinity, dt));
			}
		}
		const perTask = stats([...best.values()], 0);
		const slowest = [...best].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
		const demand = stats(cold);
		console.info(
			`${id} (${ids.length} tasks, ${ctx.result.bookings.length} bookings):\n` +
				`  demandOf cold ${ms(demand)}; warm ${ms(stats(warm))} (target ${DEMAND_MS} ms)\n` +
				`  explainTask first call on a result ${ms(stats(first))}; ` +
				`per task, warm, best of 5, over every task ${ms(perTask)}, slowest ${slowest} ` +
				`(target ${EXPLAIN_MS} ms)`,
		);
		expect(demand.median).toBeLessThan(DEMAND_MS * SANITY);
		expect(perTask.max).toBeLessThan(EXPLAIN_MS * SANITY);
	}, 120_000);
});
