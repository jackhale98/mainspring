// SPDX-License-Identifier: GPL-2.0-or-later
// checkPlan timings (phase-3.md 8.3: derived work runs in idle tasks; timings recorded, not
// enforced) on fedora-res and syn-20-scale-1000. The index, the analysis, the demand marks and the
// availability are built beforehand, as the app has them (T18 runs checkPlan after demandOf). The
// first call (cold: this module's code not yet optimised) is reported apart; then the median, p90
// and slowest of the warm runs. Only a sanity bound, ten times the 25 ms idle-task budget the
// demand has (explain.perf.test.ts), is asserted.
import { describe, expect, it } from 'vitest';
import { checkPlan } from './report';
import { goldenInput } from './testing';

const PLANS = ['fedora-res', 'syn-20-scale-1000'];
const TARGET_MS = 25;
const SANITY = 10;
const RUNS = 15;
const SKIP = 3;

describe.each(PLANS)('checkPlan timings on %s', (id) => {
	it('checks the plan within the sanity bound', () => {
		const input = goldenInput(id);
		const times: number[] = [];
		let findings = 0;
		for (let i = 0; i < RUNS; i++) {
			const t0 = performance.now();
			findings = checkPlan(input).findings.length;
			times.push(performance.now() - t0);
		}
		const warm = times.slice(SKIP).sort((a, b) => a - b);
		const q = (p: number) => warm[Math.min(warm.length - 1, Math.floor(p * warm.length))] ?? NaN;
		console.info(
			`checkPlan ${id}: ${input.result.tasks.length} tasks, ${findings} findings; first ` +
				`${(times[0] ?? NaN).toFixed(2)} ms; warm median ${q(0.5).toFixed(2)}, p90 ` +
				`${q(0.9).toFixed(2)}, max ${(warm[warm.length - 1] ?? NaN).toFixed(2)} ms ` +
				`(target ${TARGET_MS} ms, recorded)`,
		);
		expect(q(0.5)).toBeLessThan(TARGET_MS * SANITY);
	});
});
