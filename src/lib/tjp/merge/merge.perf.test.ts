// SPDX-License-Identifier: GPL-2.0-or-later
// Merge timings (phase-4.md 6.4 rule 5, 12.2): at most 50 ms p90 on desktop for `fedora-res`-sized
// files with 20 edits per side. Prints median and p90 of `mergeWorkspace` on Fedora 20,
// `fedora-res` and the 1,000-task plan, each with 20 edit-API intents per side on different tasks
// (a clean merge), and with the same plus one attribute set both ways (a merge with a conflict,
// which parses and refines), cold and computed again from newer ours (8.3). The process's CPU
// time per merge is printed too: on a shared, loaded machine the wall time is not the work. Like the other timing tests, it asserts only a sanity bound ten
// times the target; the timing tier enforces the budget in the browser.
import { readFileSync } from 'node:fs';
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
			 * (8.3). `trees` passes ours' parsed files (the workspace's), as the controller does.
			 */
			const run = (
				o: Texts,
				t: Texts,
				fresh: 'all' | 'ours',
				trees: boolean,
			): { ms: number[]; cpu: number[]; step: number[]; conflicts: number } => {
				const ms: number[] = [];
				const cpu: number[] = [];
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
						...(trees ? { files: snap.files } : {}),
					};
					let whole = 0;
					let longest = 0;
					conflicts = 0;
					const c0 = process.cpuUsage();
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
					const used = process.cpuUsage(c0);
					ms.push(whole);
					cpu.push((used.user + used.system) / 1000);
					step.push(longest);
				}
				return { ms: ms.slice(3), cpu: cpu.slice(3), step: step.slice(3), conflicts };
			};
			const show = (label: string, r: ReturnType<typeof run> | null): string => {
				if (!r) return `${label}: none`;
				const w = stats(r.ms);
				const s = stats(r.step);
				const c = stats(r.cpu);
				return (
					`${label}: whole median ${w.median.toFixed(1)} / p90 ${w.p90.toFixed(1)} ms ` +
					`(CPU time median ${c.median.toFixed(1)} / p90 ${c.p90.toFixed(1)} ms), ` +
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

/**
 * Inputs with large chunks and no anchor line (review N5): thousands of equal lines, where the
 * line diff's cost used to explode. Each side edits one line far from the other's; the whole merge
 * (parse, structural pass, refinement) must stay within a hard bound, and its longest step is
 * printed against the 12.5 ms step budget.
 */
describe('large chunks without anchors (review N5)', () => {
	const H = 'project p "P" 2027-01-04 +3m\n';
	const repeat = (n: number, s: string): string => Array.from({ length: n }, () => s).join('');
	const fedora = readFileSync(
		new URL('../../../../engine/golden/plans/fedora-res/f-20.tjp', import.meta.url),
		'utf8',
	);
	const head = `${fedora.split('\n').slice(0, 1500).join('\n')}\n`;
	const swap = (t: string, s: string, n: number, by: string): string => {
		let at = -1;
		for (let i = 0; i <= n; i++) at = t.indexOf(s, at + 1);
		return `${t.slice(0, at)}${by}${t.slice(at + s.length)}`;
	};
	type Case = [label: string, base: string, ours: string, theirs: string];
	const macros = `${H}macro m [ ]\ntask a "A" {\n${repeat(3000, '  ${m}\n')}}\n`;
	const tasks = `${H}${repeat(1300, 'task t "T" {\n  effort 1d\n}\n')}`;
	const note = `${H}task a "A" {\n  note "\n${repeat(5000, 'x\n')}"\n}\n`;
	const cases: Case[] = [
		[
			'3,000 equal macro calls in one task',
			macros,
			swap(macros, '${m}', 100, 'effort 1d'),
			swap(macros, '${m}', 2900, 'note "n"'),
		],
		[
			'1,300 equal tasks',
			tasks,
			swap(tasks, 'effort 1d', 50, 'effort 2d'),
			swap(tasks, 'effort 1d', 1250, 'effort 3d'),
		],
		[
			'a 5,000-line note',
			note,
			swap(note, 'x\n', 100, 'ours\n'),
			swap(note, 'x\n', 4900, 'theirs\n'),
		],
		[
			'1,500 lines of fedora-res pasted again',
			head,
			head.replace('\n', '\n# ours\n'),
			`${head}${head}`,
		],
	];

	it.each(cases)('%s merges within 300 ms', (label, base, ours, theirs) => {
		const ms: number[] = [];
		const step: number[] = [];
		let conflicts = 0;
		for (let i = 0; i < 6; i++) {
			const mark = (t: string): string => `${t}# run ${i}\n`;
			const [b, o, t] = [mark(base), mark(ours), mark(theirs)];
			const snap = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': o } }).snapshot();
			const steps = mergeFileSteps('plan.tjp', b, o, t, {
				includes: snap.includes,
				files: snap.files,
			});
			let whole = 0;
			let longest = 0;
			for (;;) {
				const t0 = performance.now();
				const r = steps.next();
				const d = performance.now() - t0;
				whole += d;
				longest = Math.max(longest, d);
				if (r.done) {
					conflicts = r.value.conflicts.length;
					break;
				}
			}
			if (i > 0) {
				ms.push(whole);
				step.push(longest);
			}
		}
		const w = stats(ms);
		console.info(
			`N5 ${label}: whole median ${w.median.toFixed(1)} / p90 ${w.p90.toFixed(1)} ms, ` +
				`longest step max ${Math.max(...step).toFixed(1)} ms (${conflicts} conflicts)`,
		);
		expect(w.p90).toBeLessThan(300);
	});
});
