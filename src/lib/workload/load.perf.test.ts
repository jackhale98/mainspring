// SPDX-License-Identifier: GPL-2.0-or-later
// Load model timings (phase-3.md 8.3, 18.14): the targets are recorded, not enforced. On desktop
// the load step (`availabilityOf`, then `buildLoad`, once per result) should take at most 15 ms on
// fedora-res and syn-20-scale-1000. This prints, per plan and zoom, the median and the slowest of
// 11 runs (the first 3 left out), and asserts only a sanity bound ten times the target.
// - Hosts: the plain Intl host, and the Gantt's `memoZones` over it (which asks the host three
//   times on a miss), so that a slow path through either shows here.
// - Cold: a new wrapper over the one Intl host for each run, so the axis is built (a new frame,
//   zone or zoom) while the host's formatter exists, as in the app. Warm: one wrapper, so a result
//   with the same frame reuses its axis (the common case: an edit).
// The index is built beforehand, as the app already has it. The deterministic guard on the axis's
// host calls is in axis.test.ts.
import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../../../tests/golden/corpus';
import type { ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/timezone';
import { memoZones } from '../gantt/zones';
import { buildIndex, hintsFromResult } from '../tjp/index';
import { golden } from '../tjp/index/testing';
import type { ZoneOffsets } from '../tjp/values/civil';
import { availabilityOf } from './availability';
import { buildLoad } from './load';
import type { BucketKind } from './types';

const TARGET_MS = 15;
const SANITY = 10;
const NO_TIMINGS = { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 };
const PLANS = [
	'fedora-res',
	'upstream-fedora-20',
	'syn-20-scale-1000',
	'gantt-500',
	'syn-23-unused-resources',
];
const KINDS: BucketKind[] = ['day', 'week', 'month'];
/** Intl formatters are slow to make, so one host per file, as the app has one per view. */
const base = createTimeZoneHost();
const HOSTS: ReadonlyArray<readonly [string, () => ZoneOffsets]> = [
	['plain', () => ({ offset: (z, e) => base.offset(z, e), valid: (z) => base.valid(z) })],
	['memoZones', () => memoZones(base)],
];
const RUNS = 11;
const SKIP = 3;

const stats = (xs: number[]): { median: number; max: number } => {
	const s = xs.slice(SKIP).sort((a, b) => a - b);
	return { median: s[Math.floor(s.length / 2)] ?? NaN, max: s[s.length - 1] ?? NaN };
};
const ms = (v: { median: number; max: number }): string =>
	`${v.median.toFixed(2)} (max ${v.max.toFixed(2)})`;

const corpus = new Map(loadCorpus().map((c) => [c.plan.id, c.golden]));

describe.each(PLANS)('load timings on %s', (id) => {
	it('builds the availability and the load model within the recorded target', () => {
		const g = corpus.get(id);
		if (!g) throw new Error(`no golden ${id}`);
		const result: ScheduleResult = { ...g.result, revision: 1, timings: NO_TIMINGS };
		const scenario = result.project?.scenarios.find((s) => s.active)?.id ?? 'plan';
		const hints = hintsFromResult(result, (_f, l) => l);
		const index = buildIndex(golden(id).snapshot(), hints, { cache: null });
		const lines: string[] = [];
		for (const [name, host] of HOSTS) {
			const shared = host();
			for (const kind of KINDS) {
				const cold: number[] = [];
				const warm: number[] = [];
				let cells = 0;
				for (let n = 0; n < RUNS; n++) {
					const t0 = performance.now();
					const availability = availabilityOf(result, scenario);
					const input = { result, index, kind, collapsed: new Set<string>(), availability };
					buildLoad({ ...input, zones: host(), demand: null });
					const t1 = performance.now();
					const m = buildLoad({ ...input, zones: shared, demand: null });
					const t2 = performance.now();
					cold.push(t1 - t0);
					warm.push(t2 - t1);
					cells = m.rows.length * m.axis.count;
				}
				const c = stats(cold);
				lines.push(
					`${name.padEnd(9)} ${kind.padEnd(5)} cold ${ms(c)} ms, warm buildLoad ${ms(stats(warm))} ms (${cells} cells)`,
				);
				expect(c.median).toBeLessThan(TARGET_MS * SANITY);
			}
		}
		console.info(
			`load ${id} (${result.resources.length} resources, ${result.bookings.length} bookings), ` +
				`target ${TARGET_MS} ms; cold = availabilityOf + buildLoad with a new axis:\n  ${lines.join('\n  ')}`,
		);
	}, 120_000);
});
