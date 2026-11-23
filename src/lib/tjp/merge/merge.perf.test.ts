// SPDX-License-Identifier: GPL-2.0-or-later
// Merge timings (phase-4.md 6.4 rule 5, 12.2): at most 50 ms p90 on desktop for `fedora-res`-sized
// files with 20 edits per side. Prints median and p90 of `mergeWorkspace` on Fedora 20,
// `fedora-res` and the 1,000-task plan, each with 20 edit-API intents per side on different tasks
// (a clean merge), and with the same plus one attribute set both ways (a merge with a conflict,
// which parses and refines), cold and computed again from newer ours (8.3). Like the other timing tests, it asserts only a sanity bound ten
// times the target; the timing tier enforces the budget in the browser.
import { describe, expect, it } from 'vitest';
import { mergeWorkspace } from '../../sync/merge';
import type { EditIntent } from '../edit/types';
import type { Change } from '../../../../tests/fidelity/families/types';
import {
	applier,
	applyTo,
	drawIntent,
	goldenPlan,
	LOCAL,
	touched,
	touching,
	withChanges,
	type Plan,
	type Texts,
} from './sides-testing';
import { contextOf, filesOf } from './testing';

const TARGET_MS = 50;
const SANITY = 10;
const PLANS = ['upstream-fedora-20', 'fedora-res', 'syn-20-scale-1000'];

function stats(xs: number[]): { median: number; p90: number } {
	const s = [...xs].sort((a, b) => a - b);
	const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
	return { median: at(0.5), p90: at(0.9) };
}

/**
 * `n` intents on tasks no other intent of the run touches, each made on the base by the edit API
 * (one index for all) and applied together: their changes do not touch.
 */
function side(
	p: Plan,
	apply: (i: EditIntent) => ReturnType<typeof applyTo>,
	seed: number,
	n: number,
	taken: Set<string>,
	made: Change[],
): { files: Texts; edits: number } {
	const mine: Change[] = [];
	for (let i = 0; i < n * 20 && edits(mine) < n; i++) {
		const intent = drawIntent(p, seed + i * 7919, LOCAL);
		const t = intent ? touched(intent) : null;
		if (!intent || !t || t.some((x) => taken.has(x))) continue;
		const r = apply(intent);
		if (!r || touching(r.changes, made)) continue;
		for (const x of t) taken.add(x);
		mine.push(...r.changes.map((c) => ({ ...c, edit: i })));
		made.push(...r.changes);
	}
	return { files: withChanges(p.files, mine), edits: edits(mine) };
}

const edits = (cs: readonly Change[]): number =>
	new Set(cs.map((c) => (c as Change & { edit: number }).edit)).size;

describe.each(PLANS)('%s', (id) => {
	const p = goldenPlan(id);

	it.skipIf(!p)(
		'merges 20 edits per side within the budget',
		() => {
			if (!p) return;
			const taken = new Set<string>();
			const made: Change[] = [];
			const apply = applier(p, p.files);
			const ours = side(p, apply, 11, 20, taken, made);
			const theirs = side(p, apply, 23, 20, taken, made);
			const ctx = contextOf(p.entry, ours.files);
			/**
			 * Timings over 15 runs (the first 3 dropped). `fresh` marks the files of the sides it
			 * names with a comment line of the run, so their texts are new to the merge: 'all' is a
			 * first merge, 'ours' the merge computed again from newer local text (8.3).
			 */
			const run = (
				o: Texts,
				t: Texts,
				fresh: 'all' | 'ours',
			): { ms: number[]; conflicts: number } => {
				const ms: number[] = [];
				let conflicts = 0;
				const mark = (f: Texts, i: number): Texts =>
					Object.fromEntries(Object.entries(f).map(([k, v]) => [k, `${v}# run ${i}\n`]));
				for (let i = 0; i < 15; i++) {
					const b = fresh === 'all' ? mark(p.files, i) : p.files;
					const oi = mark(o, i);
					const ti = fresh === 'all' ? mark(t, i) : t;
					const t0 = performance.now();
					const m = mergeWorkspace(filesOf(b), filesOf(oi), filesOf(ti), ctx);
					ms.push(performance.now() - t0);
					conflicts = m.conflicts.length;
				}
				return { ms: ms.slice(3), conflicts };
			};
			const clean = run(ours.files, theirs.files, 'all');
			// One attribute set both ways on top: the merge parses and refines.
			const set = (task: string, v: string): EditIntent => ({
				type: 'setAttr',
				task,
				attr: 'priority',
				value: v,
			});
			// The first task of the run whose priority both sides can set.
			let o2: ReturnType<typeof applyTo> = null;
			let t2: ReturnType<typeof applyTo> = null;
			for (const task of taken) {
				o2 = applyTo(p, ours.files, set(task, '17'));
				t2 = o2 && applyTo(p, theirs.files, set(task, '23'));
				if (o2 && t2) break;
			}
			const both = o2 && t2 ? run(o2.files, t2.files, 'all') : null;
			const again = o2 && t2 ? run(o2.files, t2.files, 'ours') : null;
			const size = Object.values(p.files).reduce((n, t) => n + t.length, 0);
			const s1 = stats(clean.ms);
			const s2 = both ? stats(both.ms) : null;
			const s3 = again ? stats(again.ms) : null;
			console.info(
				`merge ${id} (${(size / 1024).toFixed(0)} KiB, ${ours.edits}+${theirs.edits} edits): ` +
					`clean median ${s1.median.toFixed(1)} ms, p90 ${s1.p90.toFixed(1)} ms (${clean.conflicts} conflicts); ` +
					(s2 && both
						? `with a conflict median ${s2.median.toFixed(1)} ms, p90 ${s2.p90.toFixed(1)} ms (${both.conflicts} conflicts)`
						: 'no conflict case') +
					(s3
						? `; computed again from newer ours median ${s3.median.toFixed(1)} ms, p90 ${s3.p90.toFixed(1)} ms`
						: '') +
					`; target ${TARGET_MS} ms p90`,
			);
			expect(ours.edits + theirs.edits).toBeGreaterThan(0);
			expect(clean.conflicts).toBe(0);
			expect(s1.p90).toBeLessThan(TARGET_MS * SANITY);
			if (s2) expect(s2.p90).toBeLessThan(TARGET_MS * SANITY);
		},
		120_000,
	);
});
