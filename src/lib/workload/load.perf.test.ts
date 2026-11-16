// SPDX-License-Identifier: GPL-2.0-or-later
// Load model timings (phase-3.md 8.3, 18.14): the targets are recorded, not enforced. On desktop
// the load step should take at most 15 ms on fedora-res and syn-20-scale-1000. This prints, per
// plan and zoom, the median of `availabilityOf` and of `buildLoad` (the two run together once per
// result), and asserts only a sanity bound ten times the target. `buildLoad` is timed twice: with
// a new zone host each run, so the axis is built (a new frame, zone or zoom), and with one host,
// so a result with the same frame reuses its axis (the common case: an edit). The index is built
// beforehand, as the app already has it; the zone host is the plain Intl one.
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
const PLANS = [
	'fedora-res',
	'upstream-fedora-20',
	'syn-20-scale-1000',
	'gantt-500',
	'syn-23-unused-resources',
];
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
		const shared = createTimeZoneHost();
		const lines: string[] = [];
		for (const kind of KINDS) {
			const avail: number[] = [];
			const cold: number[] = [];
			const warm: number[] = [];
			let cells = 0;
			for (let n = 0; n < 11; n++) {
				const t0 = performance.now();
				const availability = availabilityOf(result, scenario);
				const t1 = performance.now();
				const input = { result, index, kind, collapsed: new Set<string>(), availability };
				buildLoad({ ...input, zones: createTimeZoneHost(), demand: null });
				const t2 = performance.now();
				const m = buildLoad({ ...input, zones: shared, demand: null });
				const t3 = performance.now();
				avail.push(t1 - t0);
				cold.push(t2 - t1);
				warm.push(t3 - t2);
				cells = m.rows.length * m.axis.count;
			}
			const [a, b, c] = [avail, cold, warm].map((xs) => median(xs.slice(3))) as [
				number,
				number,
				number,
			];
			lines.push(
				`${kind.padEnd(5)} availabilityOf ${a.toFixed(2)} ms; buildLoad ${b.toFixed(2)} ms with ` +
					`a new axis, ${c.toFixed(2)} ms reusing it; total ${(a + b).toFixed(2)} ms (${cells} cells)`,
			);
			expect(a + b).toBeLessThan(TARGET_MS * SANITY);
		}
		console.info(
			`load ${id} (${result.resources.length} resources, ${result.bookings.length} bookings), target ${TARGET_MS} ms:\n  ${lines.join('\n  ')}`,
		);
	}, 60_000);
});
