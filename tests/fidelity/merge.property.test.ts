// SPDX-License-Identifier: GPL-2.0-or-later
// Merged plans schedule (phase-4.md 13.1; T6 review M2): two sides edit one plan with the edit API
// (src/lib/tjp/merge/sides-testing.ts: one or four intents per side, on different tasks, pairs
// aimed at one task or at adjacent lines, and statements typed at random lines of a body), the workspace merge is clean, and the real engine
// (the built public/engine bundle in Node) schedules the merged text with nothing new:
// - `ok` is true when it is on both sides;
// - no message (error, fatal or warning, as level and id) appears more often than the two edits
//   bring together: count(merged) <= count(ours) + count(theirs) - count(base). That is what would
//   have caught a value said twice in one block (`attr_overwrite`, review H1).
// Errors that depend on the computed schedule (two timing edits can together push a chain past
// the project end) are counted, not failed, as in schedule.property.test.ts. MERGE_FIDELITY_RUNS
// clean merges (default 100 on push; the nightly job sets 2,000, split over its shards by
// FIDELITY_SHARD), seeded by FIDELITY_SEED.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../engine/golden/run-wasm.mjs';
import type { ScheduleResult } from '../../src/engine/protocol';
import { mergeWorkspace } from '../../src/lib/sync/merge';
import {
	adjacentSides,
	handSides,
	LOCAL,
	touched,
	twoSides,
	type TwoSides,
} from '../../src/lib/tjp/merge/sides-testing';
import { contextOf, filesOf } from '../../src/lib/tjp/merge/testing';
import { REPO } from '../golden/corpus';
import { CONFIG } from './config';

type Engine = Awaited<ReturnType<typeof bootNodeEngine>>;

const RUNS = Number(process.env['MERGE_FIDELITY_RUNS'] ?? 100);
/** Errors that depend on the computed schedule (schedule.property.test.ts, 15.19). */
const SCHEDULE_DEPENDENT = new Set([
	'task_pred_before',
	'task_succ_after',
	'impossible_start_dep',
	'impossible_end_dep',
	'sched_runaway',
	'task_start_range',
	'task_end_range',
	'task_start_in_parent',
	'task_end_in_parent',
	'start_after_end',
	'not_scheduled',
	'effort_no_allocations',
	'booking_no_duty',
	'booking_on_vacation',
]);

let engine: Engine;
let revision = 0;
const schedule = (
	files: Readonly<Record<string, string>>,
	entry: string,
	now: string | null,
): ScheduleResult =>
	engine.schedule({
		files,
		entry,
		revision: ++revision,
		options: now ? { now } : {},
	}) as ScheduleResult;

const counts = (r: ScheduleResult): Map<string, number> => {
	const out = new Map<string, number>();
	for (const m of r.messages) {
		const k = `${m.level}:${m.id}`;
		out.set(k, (out.get(k) ?? 0) + 1);
	}
	return out;
};

/**
 * The sides of case `n`: edits aimed at adjacent lines, statements typed at random lines (often
 * the same task), and one or four edit-API intents per side on different tasks, in turn.
 */
function sidesOf(seed: number, n: number): TwoSides | null {
	if (n % 4 === 0) return adjacentSides(seed);
	if (n % 4 === 3) return handSides(seed);
	const s = twoSides(seed, LOCAL, n % 4 === 1 ? 0 : 3);
	if (!s) return null;
	const ta = touched(s.a.intent);
	const tb = touched(s.b.intent);
	return ta && tb && !ta.some((t) => tb.includes(t)) ? s : null;
}

describe('merged plans schedule (13.1)', () => {
	beforeAll(async () => {
		if (!fs.existsSync(path.join(REPO, 'public/engine/manifest.json'))) {
			throw new Error('public/engine is missing: run npm run build:engine first');
		}
		engine = await bootNodeEngine({ log: () => {} });
	}, 120_000);

	it(`schedules ${RUNS} clean merges with nothing new`, () => {
		// Seeds are drawn until this shard has merged its share of RUNS clean merges (a draw may
		// offer no case, or merge with a conflict, which this property does not schedule).
		const share = Math.ceil(RUNS / CONFIG.shard.count);
		const seeds = fc.sample(fc.integer({ min: 1, max: 0x7fffffff }), {
			numRuns: RUNS * 8,
			seed: CONFIG.seed + 4242,
		});
		const failures: string[] = [];
		const tolerated: Record<string, number> = {};
		let merged = 0;
		let skipped = 0;
		seeds.forEach((seed, n) => {
			if (merged >= share || n % CONFIG.shard.count !== CONFIG.shard.index) return;
			const s = sidesOf(seed, n);
			if (!s) {
				skipped++;
				return;
			}
			const { p } = s;
			const m = mergeWorkspace(
				filesOf(p.files),
				filesOf(s.a.files),
				filesOf(s.b.files),
				contextOf(p.entry, s.a.files),
			);
			if (m.conflicts.length > 0) {
				skipped++;
				return;
			}
			merged++;
			const [rb, ra, rt, rm] = [p.files, s.a.files, s.b.files, Object.fromEntries(m.files)].map(
				(f) => schedule(f, p.entry, p.c.now),
			) as [ScheduleResult, ScheduleResult, ScheduleResult, ScheduleResult];
			const [cb, ca, ct, cm] = [rb, ra, rt, rm].map(counts) as [
				Map<string, number>,
				Map<string, number>,
				Map<string, number>,
				Map<string, number>,
			];
			const bad: string[] = [];
			let scheduleDependent = false;
			for (const [k, n2] of cm) {
				const allowed = Math.max(
					ca.get(k) ?? 0,
					ct.get(k) ?? 0,
					(ca.get(k) ?? 0) + (ct.get(k) ?? 0) - (cb.get(k) ?? 0),
				);
				if (n2 <= allowed) continue;
				if (SCHEDULE_DEPENDENT.has(k.split(':')[1] ?? '')) {
					tolerated[k] = (tolerated[k] ?? 0) + 1;
					scheduleDependent = true;
				} else bad.push(`${k} ${n2} > ${allowed}`);
			}
			if (ra.ok && rt.ok && !rm.ok && !scheduleDependent) bad.push('ok went false');
			if (bad.length > 0) {
				failures.push(
					`${p.name} seed ${seed}: ${JSON.stringify(s.a.intent)} / ${JSON.stringify(s.b.intent)}: ${bad.join('; ')}`,
				);
			}
		});
		console.info(
			`merged plans schedule: ${merged} clean merges scheduled, ${skipped} skipped (no case, or a conflict); tolerated ${JSON.stringify(tolerated)}`,
		);
		expect(failures).toEqual([]);
		expect(merged).toBe(share);
	}, 3_600_000);
});
