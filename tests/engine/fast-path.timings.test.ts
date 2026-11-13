// SPDX-License-Identifier: GPL-2.0-or-later
// Timings of the fast-path spike (phase-2.md section 12, step 5; T19): the engine time of a full
// run against a fast run of the same in-place rewrite, on Fedora 20, gantt-200, gantt-500,
// scale-1000 and Tutorial, in the real engine booted in Node. Each round, interleaved: the full
// run of the rewritten text, the run of the text before it that keeps its parse (`retain`, whose
// extra cost is `retainMs`), and the fast run. Medians of FAST_PATH_TIMING_RUNS rounds (default
// 5) after one warm-up round. Every fast run must take the fast path and equal the full run.
//
// Opt-in (FAST_PATH=1). Writes test-results/fast-path-timings.json. The adoption bar (median engine
// time saved of at least 30% on Fedora and gantt-200) is recorded there, not asserted: the ADR
// decides.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../engine/golden/run-wasm.mjs';
import type { ScheduleRequest, ScheduleResult } from '../../src/engine/protocol';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { goldenHints } from '../fidelity/oracle';
import { loadCorpus, planRequest, REPO } from '../golden/corpus';
import { canonicalResult, eligibleSites, indexOf, rewrite, type Rewrite } from './fast-path-cases';

const ENGINE = path.join(REPO, 'public/engine/manifest.json');
const ON = process.env['FAST_PATH'] === '1';
const ROUNDS = Number(process.env['FAST_PATH_TIMING_RUNS'] || 5);
const ALL_PLANS = ['upstream-fedora-20', 'gantt-200', 'gantt-500', 'syn-20-scale-1000', 'upstream-tutorial'];
/** FAST_PATH_TIMING_PLANS=a,b runs only these. */
const PLANS = (process.env['FAST_PATH_TIMING_PLANS'] ?? '').split(',').filter(Boolean).length
	? (process.env['FAST_PATH_TIMING_PLANS'] ?? '').split(',').filter(Boolean)
	: ALL_PLANS;
/** The bar of phase-2.md 12, step 5 (and 18.12). */
const BAR = 0.3;

type Engine = { schedule(r: ScheduleRequest): ScheduleResult };

const median = (xs: number[]): number => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] ?? NaN;
};

interface Row {
	plan: string;
	edit: string;
	rounds: number;
	fullMs: number;
	fullParseMs: number;
	fullScheduleMs: number;
	fastMs: number;
	fastCloneMs: number;
	fastApplyMs: number;
	fastScheduleMs: number;
	retainRunMs: number;
	retainMs: number;
	retainKB: number;
	saved: number;
	meetsBar: boolean | null;
}

describe.skipIf(!ON || !fs.existsSync(ENGINE))('fast path: timings', () => {
	let engine: Engine;
	let revision = 0;
	const rows: Row[] = [];

	beforeAll(async () => {
		engine = (await bootNodeEngine({ log: () => {} })) as unknown as Engine;
	}, 300_000);

	for (const id of PLANS) {
		it(id, () => {
			const c = loadCorpus().find((x) => x.plan.id === id);
			if (!c) throw new Error(`no golden ${id}`);
			const { revision: _r, ...req } = planRequest(c.plan, c.golden, 0);
			const ws = createWorkspace({ entry: req.entry, files: req.files });
			const index = indexOf(ws, goldenHints(c.golden.result, ws.snapshot()));
			// The first effort or length that the edit API rewrites in place: the commonest drag (R1).
			let rw: Rewrite | null = null;
			for (const site of eligibleSites(ws, index)) {
				if (site.attribute !== 'effort' && site.attribute !== 'length') continue;
				rw = rewrite(ws, index, site, site.value === '3d' ? '4d' : '3d');
				if (rw) break;
			}
			if (!rw) throw new Error(`${id}: no effort or length to rewrite`);
			const edited = { ...req, files: rw.files };
			const runs = { full: [] as ScheduleResult[], base: [] as ScheduleResult[], fast: [] as ScheduleResult[] };
			for (let i = 0; i <= ROUNDS; i++) {
				const full = engine.schedule({ ...edited, revision: ++revision });
				const base = engine.schedule({ ...req, retain: true, revision: ++revision });
				const fast = engine.schedule({
					...edited,
					revision: ++revision,
					fast: { base: base.revision, edits: [rw.edit] },
				});
				expect(fast.timings.path, fast.timings.fastFallback).toBe('fast');
				expect(canonicalResult(fast)).toBe(canonicalResult(full));
				if (i === 0) continue; // warm-up
				runs.full.push(full);
				runs.base.push(base);
				runs.fast.push(fast);
			}
			const m = (list: ScheduleResult[], f: (t: ScheduleResult['timings']) => number | undefined) =>
				Math.round(median(list.map((r) => f(r.timings) ?? 0)) * 10) / 10;
			const fullMs = m(runs.full, (t) => t.totalMs);
			const fastMs = m(runs.fast, (t) => t.totalMs);
			const saved = Math.round((1 - fastMs / fullMs) * 1000) / 1000;
			const row: Row = {
				plan: id,
				edit: `${rw.edit.task} ${rw.edit.attribute} ${rw.site.value} -> ${rw.edit.value}`,
				rounds: ROUNDS,
				fullMs,
				fullParseMs: m(runs.full, (t) => t.parseMs),
				fullScheduleMs: m(runs.full, (t) => t.scheduleMs),
				fastMs,
				fastCloneMs: m(runs.fast, (t) => t.cloneMs),
				fastApplyMs: m(runs.fast, (t) => t.applyMs),
				fastScheduleMs: m(runs.fast, (t) => t.scheduleMs),
				retainRunMs: m(runs.base, (t) => t.totalMs),
				retainMs: m(runs.base, (t) => t.retainMs),
				retainKB: Math.round(m(runs.base, (t) => t.retainBytes) / 1024),
				saved,
				meetsBar: id === 'upstream-fedora-20' || id === 'gantt-200' ? saved >= BAR : null,
			};
			rows.push(row);
			console.info(
				`${id}: full ${fullMs} ms (parse ${row.fullParseMs}, schedule ${row.fullScheduleMs}); ` +
					`fast ${fastMs} ms (clone ${row.fastCloneMs}, apply ${row.fastApplyMs}, schedule ${row.fastScheduleMs}); ` +
					`saved ${(saved * 100).toFixed(1)}%; keeping the parse costs ${row.retainMs} ms on a full run ` +
					`and ${row.retainKB} KB`,
			);
		}, 1_800_000);
	}

	it('writes the report', () => {
		const file = path.join(REPO, 'test-results', 'fast-path-timings.json');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify({ bar: BAR, rows }, null, 2)}\n`);
		expect(rows.length).toBe(PLANS.length);
	});
});
