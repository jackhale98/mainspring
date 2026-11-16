// SPDX-License-Identifier: GPL-2.0-or-later
// Load model timings (phase-3.md 8.3, 18.14): the targets are recorded, not enforced. On desktop
// the load step should take at most 15 ms on fedora-res and syn-20-scale-1000. This prints, per
// plan and zoom, the median of `availabilityOf` and of `buildLoad` (the two run together once per
// result), and asserts only a sanity bound ten times the target. The index is built beforehand,
// as the app already has it; the zone host is the plain Intl one, without the app's memo.
import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../../tests/golden/corpus';
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { buildIndex, hintsFromResult } from '../tjp/index';
import { golden } from '../tjp/index/testing';
import { availabilityOf } from './availability';
import { buildLoad } from './load';
import type { BucketKind } from './types';

const TARGET_MS = 15;
const NO_TIMINGS = { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 };
const SANITY = 10;
const PLANS = ['fedora-res', 'syn-20-scale-1000', 'gantt-500', 'syn-23-unused-resources'];
const KINDS: BucketKind[] = ['day', 'week', 'month'];

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] ?? NaN;
}

const corpus = new Map(loadCorpus().map((c) => [c.plan.id, c.golden]));

describe.each(PLANS)('load timings on %s', (id) => {
	it('builds the availability and the load model within the recorded target', () => {
		const g = corpus.get(id);
		if (!g) throw new Error(`no golden ${id}`);
		const result: ScheduleResult = { ...g.result, revision: 1, timings: NO_TIMINGS };
		const scenario = result.project?.scenarios.find((s) => s.active)?.id ?? 'plan';
		const hints = hintsFromResult(result, (_f, l) => l);
		const index = buildIndex(golden(id).snapshot(), hints, { cache: null });
		const zones = createTimeZoneHost();
		const lines: string[] = [];
		for (const kind of KINDS) {
			const avail: number[] = [];
			const load: number[] = [];
			let cells = 0;
			for (let n = 0; n < 11; n++) {
				const t0 = performance.now();
				const availability = availabilityOf(result, scenario);
				const t1 = performance.now();
				const m = buildLoad({
					result,
					index,
					zones,
					kind,
					collapsed: new Set(),
					availability,
					demand: null,
				});
				const t2 = performance.now();
				avail.push(t1 - t0);
				load.push(t2 - t1);
				cells = m.rows.length * m.axis.count;
			}
			const a = median(avail.slice(3));
			const b = median(load.slice(3));
			lines.push(
				`${kind.padEnd(5)} availabilityOf ${a.toFixed(2)} ms, buildLoad ${b.toFixed(2)} ms, ` +
					`total ${(a + b).toFixed(2)} ms (${cells} cells)`,
			);
			expect(a + b).toBeLessThan(TARGET_MS * SANITY);
		}
		console.info(
			`load ${id} (${result.resources.length} resources, ${result.bookings.length} bookings), target ${TARGET_MS} ms:\n  ${lines.join('\n  ')}`,
		);
	}, 60_000);
});
