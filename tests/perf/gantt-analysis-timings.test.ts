// SPDX-License-Identifier: GPL-2.0-or-later
// Node timings of the driving-path analysis (phase-2.md 6.2, 8.3; T5): the analysis of one result
// on gantt-200, gantt-500, Fedora 20 and the 1,000-task plan (target 10 ms for 500 tasks on
// desktop), and the Gantt model built from the same result without and with it (the main-thread
// step the analysis feeds, before and after T5). Each is timed over warm runs and reported as p50,
// p90 and max. Written to test-results/gantt-analysis-node-timings.json and printed.
// Enforced here: only a sanity cap of ten times the target, so a slow shared runner never fails.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../grammar/corpus';
import type { ScheduleResult } from '../../src/engine/protocol';
import { resolveLinks } from '../../src/lib/gantt/links';
import { buildGanttModel } from '../../src/lib/gantt/model';
import { analyseResult } from '../../src/lib/schedule/critical';
import { finishScenario } from '../../src/lib/schedule/finish';
import { buildOutline } from '../../src/lib/state/outline';
import { buildIndex, hintsFromResult } from '../../src/lib/tjp/index';
import { golden } from '../../src/lib/tjp/index/testing';

const SANITY = 10;
const TARGET_MS = 10;
const out: Record<string, Stats> = {};

interface Stats {
	tasks: number;
	runs: number;
	p50: number;
	p90: number;
	max: number;
	targetMs: number | null;
}

function pct(xs: readonly number[], p: number): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN;
}

function record(name: string, tasks: number, xs: number[], targetMs: number | null): void {
	const st: Stats = {
		tasks,
		runs: xs.length,
		p50: pct(xs, 50),
		p90: pct(xs, 90),
		max: Math.max(...xs),
		targetMs,
	};
	out[name] = st;
	console.info(
		`${name} (${tasks} tasks): p50 ${st.p50.toFixed(2)} ms, p90 ${st.p90.toFixed(2)} ms, ` +
			`max ${st.max.toFixed(2)} ms` +
			(targetMs === null ? '' : ` (target ${targetMs} ms)`),
	);
	if (targetMs !== null) expect(st.p50).toBeLessThan(targetMs * SANITY);
}

/** `n` timed runs after five warm-up runs. */
function repeat(n: number, f: () => void): number[] {
	const xs: number[] = [];
	for (let i = 0; i < n + 5; i++) {
		const t0 = performance.now();
		f();
		if (i >= 5) xs.push(performance.now() - t0);
	}
	return xs;
}

function resultOf(id: string): ScheduleResult {
	const file = path.join(ROOT, 'engine/golden/expected', `${id}.json`);
	const r = (JSON.parse(fs.readFileSync(file, 'utf8')) as { result: ScheduleResult }).result;
	return {
		...r,
		revision: 1,
		timings: { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 },
	};
}

const PLANS = ['gantt-200', 'gantt-500', 'upstream-fedora-20', 'syn-20-scale-1000'];

describe('driving-path analysis timings (spec 6.2, 8.3)', () => {
	it('analyses one result', () => {
		for (const id of PLANS) {
			const r = resultOf(id);
			let n = 0;
			const xs = repeat(200, () => {
				n = analyseResult(r)?.floatMin.size ?? 0;
			});
			record(
				`analysis ${id}`,
				n,
				xs,
				id === 'gantt-500' || id === 'upstream-fedora-20' ? TARGET_MS : null,
			);
		}
	}, 120_000);

	it('builds the Gantt model without and with the analysis (before and after T5)', () => {
		for (const id of ['gantt-500', 'upstream-fedora-20']) {
			const r = resultOf(id);
			const index = buildIndex(
				golden(id).snapshot(),
				hintsFromResult(r, (_f, l) => l),
				{
					cache: null,
				},
			);
			const nodes = buildOutline(index).tasks;
			const scenario = finishScenario(r);
			const links = resolveLinks({ sites: index.dependencies, result: r, scenario, current: true });
			const analysis = analyseResult(r);
			const build = (withAnalysis: boolean) => () =>
				buildGanttModel({
					nodes,
					collapsed: new Set(),
					result: r,
					dimmed: false,
					links,
					analysis: withAnalysis ? analysis : null,
					nowMs: Date.parse('2026-11-13T12:00:00Z'),
				});
			record(`model ${id}, no analysis (before)`, r.tasks.length, repeat(100, build(false)), null);
			record(`model ${id}, with analysis (after)`, r.tasks.length, repeat(100, build(true)), null);
		}
	}, 60_000);

	it('writes the report', () => {
		const file = path.join(ROOT, 'test-results', 'gantt-analysis-node-timings.json');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(
			file,
			JSON.stringify({ node: process.version, platform: process.platform, timings: out }, null, 2),
		);
	});
});
