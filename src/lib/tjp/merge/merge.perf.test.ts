// SPDX-License-Identifier: GPL-2.0-or-later
// Merge timings (phase-4.md 6.4 rule 5, 12.2): at most 50 ms p90 on desktop for `fedora-res`-sized
// files with 20 edits per side. Prints median and p90 of `mergeWorkspace` on Fedora 20,
// `fedora-res` and the 1,000-task plan, each with 20 edit-API intents per side on different tasks
// (a clean merge), and with the same plus one attribute set both ways (a merge with a conflict,
// which parses and refines), cold and computed again from newer ours (8.3). Like the other timing tests, it asserts only a sanity bound ten
// times the target; the timing tier enforces the budget in the browser.
import { describe, expect, it } from 'vitest';
import { mergeFileSteps } from '../../sync/merge';
import { createWorkspace } from '../../workspace/workspace';
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
			/**
			 * Timings over 15 runs (the first 3 dropped), each file merged by `mergeFileSteps` as the
			 * sync controller runs it: the whole merge, and its longest step. `fresh` marks the files
			 * of the sides it names with a comment line of the run, so their texts are new to the
			 * merge: 'all' is a first merge, 'ours' the merge computed again from newer local text
			 * (8.3). `trees` passes ours' trees, parsed by the workspace, as the controller does.
			 */
			const run = (
				o: Texts,
				t: Texts,
				fresh: 'all' | 'ours',
				trees: boolean,
			): { ms: number[]; step: number[]; conflicts: number } => {
				const ms: number[] = [];
				const step: number[] = [];
				let conflicts = 0;
				const mark = (f: Texts, i: number): Texts =>
					Object.fromEntries(Object.entries(f).map(([k, v]) => [k, `${v}# run ${i}\n`]));
				for (let i = 0; i < 15; i++) {
					const b = fresh === 'all' ? mark(p.files, i) : p.files;
					const oi = mark(o, i);
					const ti = fresh === 'all' ? mark(t, i) : t;
					const snap = createWorkspace({ entry: p.entry, files: { ...oi } }).snapshot();
					const c = {
						includes: snap.includes,
						...(trees ? { trees: new Map([...snap.files].map(([k, f]) => [k, f.tree])) } : {}),
					};
					let whole = 0;
					let longest = 0;
					conflicts = 0;
					for (const path of Object.keys(oi)) {
						const steps = mergeFileSteps(
							path,
							b[path] ?? null,
							oi[path] ?? null,
							ti[path] ?? null,
							c,
						);
						for (;;) {
							const t0 = performance.now();
							const r = steps.next();
							const d = performance.now() - t0;
							whole += d;
							longest = Math.max(longest, d);
							if (r.done) {
								conflicts += r.value.conflicts.length;
								break;
							}
						}
					}
					ms.push(whole);
					step.push(longest);
				}
				return { ms: ms.slice(3), step: step.slice(3), conflicts };
			};
			const show = (label: string, r: ReturnType<typeof run> | null): string => {
				if (!r) return `${label}: none`;
				const w = stats(r.ms);
				const s = stats(r.step);
				return (
					`${label}: whole median ${w.median.toFixed(1)} / p90 ${w.p90.toFixed(1)} ms, ` +
					`longest step median ${s.median.toFixed(1)} / max ${Math.max(...r.step).toFixed(1)} ms ` +
					`(${r.conflicts} conflicts)`
				);
			};
			const clean = run(ours.files, theirs.files, 'all', true);
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
			const both = o2 && t2 ? run(o2.files, t2.files, 'all', true) : null;
			const bare = o2 && t2 ? run(o2.files, t2.files, 'all', false) : null;
			const again = o2 && t2 ? run(o2.files, t2.files, 'ours', true) : null;
			const size = Object.values(p.files).reduce((n, t) => n + t.length, 0);
			console.info(
				[
					`merge ${id} (${(size / 1024).toFixed(0)} KiB, ${ours.edits}+${theirs.edits} edits; target 50 ms p90 whole, steps under 12.5 ms desktop)`,
					show('  clean', clean),
					show('  with a conflict, ours’ trees given', both),
					show('  with a conflict, no trees', bare),
					show('  computed again from newer ours', again),
				].join('\n'),
			);
			expect(ours.edits + theirs.edits).toBeGreaterThan(0);
			expect(clean.conflicts).toBe(0);
			expect(stats(clean.ms).p90).toBeLessThan(TARGET_MS * SANITY);
			if (both) expect(stats(both.ms).p90).toBeLessThan(TARGET_MS * SANITY);
		},
		120_000,
	);
});
