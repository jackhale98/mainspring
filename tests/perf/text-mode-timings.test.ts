// SPDX-License-Identifier: GPL-2.0-or-later
// The Node timings of phase-1.md 8.4, recorded for the gate (T21): cold parse of Fedora 20 and
// the 1,000-task plan, incremental reparse after one keystroke, index rebuild for one changed
// file (Fedora), and the edit intents on Fedora. Each is timed over many warm runs and reported as
// p50, p90 and max. Written to test-results/text-mode-node-timings.json and printed.
// Enforced here: only sanity caps of ten times the target, so a slow shared runner never fails.
import fs from 'node:fs';
import path from 'node:path';
import type { Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { ROOT, readTjp } from '../grammar/corpus';
import { reparse } from '../../src/lib/tjp/grammar/fragments';
import { tjpGlobalParser } from '../../src/lib/tjp/grammar/parser';
import { applyIntent } from '../../src/lib/tjp/edit/apply';
import type { EditIntent } from '../../src/lib/tjp/edit/types';
import { buildIndex, createFactsCache, hintsFromResult } from '../../src/lib/tjp/index';
import type { ScheduleResult } from '../../src/engine/protocol';
import { golden } from '../../src/lib/tjp/index/testing';

const SANITY = 10;
const FEDORA = readTjp('engine/tj/examples/Fedora-20/f-20.tjp');
const SCALE = readTjp('engine/golden/plans/synthetic/20-scale-1000/plan.tjp');
const out: Record<string, Stats> = {};

interface Stats {
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

function record(name: string, xs: number[], targetMs: number | null): void {
	const st: Stats = {
		runs: xs.length,
		p50: pct(xs, 50),
		p90: pct(xs, 90),
		max: Math.max(...xs),
		targetMs,
	};
	out[name] = st;
	console.info(
		`${name}: p50 ${st.p50.toFixed(2)} ms, p90 ${st.p90.toFixed(2)} ms, max ${st.max.toFixed(2)} ms` +
			(targetMs === null ? '' : ` (target ${targetMs} ms)`),
	);
	if (targetMs !== null) expect(st.p50).toBeLessThan(targetMs * SANITY);
}

/** `n` timed runs after three warm-up runs. */
function repeat(n: number, f: () => void): number[] {
	const xs: number[] = [];
	for (let i = 0; i < n + 3; i++) {
		const t0 = performance.now();
		f();
		if (i >= 3) xs.push(performance.now() - t0);
	}
	return xs;
}

describe('node timings (spec 8.4)', () => {
	it('cold parse', () => {
		record(
			'cold parse Fedora f-20.tjp (2,442 lines)',
			repeat(20, () => tjpGlobalParser.parse(FEDORA)),
			150,
		);
		record(
			'cold parse scale-1000 (5,628 lines)',
			repeat(20, () => tjpGlobalParser.parse(SCALE)),
			300,
		);
	});

	it('incremental reparse after one keystroke', () => {
		for (const [label, text] of [
			['Fedora', FEDORA],
			['scale-1000', SCALE],
		] as const) {
			const tree = tjpGlobalParser.parse(text);
			const at = text.indexOf('\n', text.length >> 1) + 1;
			const next = text.slice(0, at) + '#' + text.slice(at);
			const change = [{ fromA: at, toA: at, fromB: at, toB: at + 1 }];
			record(
				`incremental reparse ${label}`,
				repeat(40, () => reparse(tjpGlobalParser, next, tree, change)),
				5,
			);
		}
	});

	it('index rebuild for one changed file (Fedora)', () => {
		const ws = golden('upstream-fedora-20');
		const cache = createFactsCache();
		buildIndex(ws.snapshot(), undefined, { cache });
		const entry = ws.snapshot().entry;
		const xs: number[] = [];
		for (let i = 0; i < 28; i++) {
			const state = ws.state(entry);
			const text = state.doc.toString();
			const at = text.indexOf('\n', text.length >> 1) + 1;
			const tr: Transaction = state.update({ changes: { from: at, insert: `# e${i}\n` } });
			ws.commit(entry, tr, 'typing');
			const snap = ws.snapshot();
			const t0 = performance.now();
			buildIndex(snap, undefined, { cache });
			if (i >= 3) xs.push(performance.now() - t0);
		}
		record('index rebuild after one edit (Fedora)', xs, 30);
	});

	it('edit intents on Fedora', () => {
		const ws = golden('upstream-fedora-20');
		const snap = ws.snapshot();
		const expected = JSON.parse(
			fs.readFileSync(path.join(ROOT, 'engine/golden/expected/upstream-fedora-20.json'), 'utf8'),
		) as { result: ScheduleResult };
		// With the engine's hints, as in the app: Fedora's tasks come from macros.
		const hints = hintsFromResult(expected.result, (_f, l) => l);
		const index = buildIndex(snap, hints, { cache: null });
		const tasks = [...index.tasks.values()];
		const dep = index.dependencies.find((d) => d.pred && d.succ && d.site === 'decl');
		const leaf = tasks.filter((t) => t.children.length === 0 && t.parent && !t.expandedOnly);
		const [a, b, c] = leaf;
		if (!dep?.succ || !dep.pred || !a || !b || !c) throw new Error('plan shape');
		const intents: Record<string, EditIntent> = {
			'setAttr priority': { type: 'setAttr', task: a.id, attr: 'priority', value: '700' },
			renameTask: { type: 'renameTask', task: a.id, name: 'Renamed task' },
			addDepends: { type: 'addDepends', task: b.id, target: c.id },
			removeDepends: { type: 'removeDepends', task: dep.succ, target: dep.pred },
			format: { type: 'format', file: snap.entry },
		};
		// Task-tree intents (addTask, deleteTask, moveTask) have no handler on this branch yet.
		for (const [name, intent] of Object.entries(intents)) {
			let status = '';
			const xs = repeat(15, () => {
				status = applyIntent(snap, index, intent).status;
			});
			record(`intent ${name} (Fedora, ${status})`, xs, 50);
		}
	});

	it('writes the report', () => {
		const file = path.join(ROOT, 'test-results', 'text-mode-node-timings.json');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(
			file,
			JSON.stringify({ node: process.version, platform: process.platform, timings: out }, null, 2),
		);
	});
});
