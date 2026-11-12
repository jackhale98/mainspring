// SPDX-License-Identifier: GPL-2.0-or-later
// Index timings (T8). Spec 8.4 records performance targets rather than enforcing them, so this
// prints the numbers for the gate and asserts only sanity bounds ten times the targets: a full
// index of Fedora 20 and the 1,000-task plan under 50 ms, and an incremental index (the edited
// file rescanned, every other file's facts reused, the link run in full) after a one-line edit
// under 5 ms. Parsing is not included: the workspace has already reparsed the file.
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@codemirror/state';
import { buildIndex, createFactsCache, hintsFromResult } from './index';
import { golden } from './testing';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../../../tests/grammar/corpus';
import type { ScheduleResult } from '../../../engine/protocol';

const FULL_TARGET_MS = 50;
const INCREMENTAL_TARGET_MS = 5;
const SANITY = 10;

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] ?? NaN;
}

const PLANS = ['upstream-fedora-20', 'syn-20-scale-1000'];

describe.each(PLANS)('%s', (id) => {
	const result = (
		JSON.parse(
			fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${id}.json`), 'utf8'),
		) as { result: ScheduleResult }
	).result;
	const hints = hintsFromResult(result, (_f, l) => l);

	it('indexes fully', () => {
		const snap = golden(id).snapshot();
		const runs: number[] = [];
		for (let i = 0; i < 9; i++) {
			const t0 = performance.now();
			buildIndex(snap, hints, { cache: null });
			runs.push(performance.now() - t0);
		}
		const ms = median(runs.slice(2));
		const idx = buildIndex(snap, hints, { cache: null });
		console.info(
			`full index ${id} (${idx.tasks.size} tasks, ${idx.resources.size} resources): median ${ms.toFixed(1)} ms`,
		);
		expect(ms).toBeLessThan(FULL_TARGET_MS * SANITY);
	});

	it('indexes incrementally after a one-line edit', () => {
		const ws = golden(id);
		const cache = createFactsCache();
		buildIndex(ws.snapshot(), hints, { cache });
		const entry = ws.snapshot().entry;
		const runs: number[] = [];
		for (let i = 0; i < 9; i++) {
			const state = ws.state(entry);
			const text = state.doc.toString();
			const at = text.indexOf('\n', text.length >> 1) + 1;
			const tr: Transaction = state.update({ changes: { from: at, insert: `# edit ${i}\n` } });
			ws.commit(entry, tr, 'typing');
			const snap = ws.snapshot();
			const t0 = performance.now();
			buildIndex(snap, hints, { cache });
			runs.push(performance.now() - t0);
		}
		const ms = median(runs.slice(2));
		console.info(`incremental index ${id} after a one-line edit: median ${ms.toFixed(2)} ms`);
		expect(ms).toBeLessThan(INCREMENTAL_TARGET_MS * SANITY);
	});
});
