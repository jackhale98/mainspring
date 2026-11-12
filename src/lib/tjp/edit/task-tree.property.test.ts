// SPDX-License-Identifier: GPL-2.0-or-later
// Task tree intents as properties (phase-1.md 9.3 P1, P2, P3, P6, text only) on generated plans
// (varied unit, line breaks, blank lines, comments, a second file, relative ids) and on the
// golden and fixture corpus. For every intent:
// - it never throws; a refusal or no-op changes nothing;
// - an edit's changes lie in its declared targets, its inverse restores the base byte for byte,
//   and a fresh parse of the result has no new error nodes;
// - the result has the tree and dependencies the intent asks for, by an oracle written from 7.1
//   (testing-plans.ts), starting from the generator's model for generated plans: addTask adds one task under the parent at the index; deleteTask removes
//   the subtree and the dependencies naming it; moveTask maps the subtree's ids to the new
//   parent, puts the task at the index, and keeps every dependency (mapped).
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { createWorkspace, type WorkspaceSnapshot } from '../../workspace/workspace';
import { syntaxIssues } from '../document';
import { applyIntent } from './apply';
import {
	arbPlan,
	corpusPlans,
	intentFor,
	load,
	movedId,
	shapeOf,
	type Loaded,
	type Shape,
} from './testing-plans';
import type { EditIntent, EditResult } from './types';

const RUNS = Number(process.env['TASK_TREE_RUNS'] ?? 150);
/** A fixed fast-check seed (FC_SEED), else a random one. */
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

function issues(snap: WorkspaceSnapshot): number {
	let n = 0;
	for (const f of snap.files.values()) n += syntaxIssues(f.tree, f.text).length;
	return n;
}

function textsOf(snap: WorkspaceSnapshot, r: EditResult): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [p, f] of snap.files) {
		const cs = r.status === 'edit' ? r.edit.changes[p] : undefined;
		out[p] = cs ? cs.apply(f.text).toString() : f.text.toString();
	}
	return out;
}

/** The oracle (module comment); throws with a message on a mismatch. */
function checkShape(intent: EditIntent, before: Shape, after: Shape): void {
	const ids = [...before.parent.keys()];
	if (intent.type === 'addTask') {
		const added = [...after.parent.keys()].filter((id) => !before.parent.has(id));
		expect(added).toHaveLength(1);
		const id = added[0] as string;
		expect(after.parent.get(id)).toBe(intent.parent);
		expect(after.children(intent.parent).indexOf(id)).toBe(intent.index);
		expect(after.deps).toEqual(before.deps);
		return;
	}
	if (intent.type === 'deleteTask') {
		const gone = (id: string): boolean => id === intent.task || id.startsWith(`${intent.task}.`);
		expect([...after.parent.keys()].sort()).toEqual(ids.filter((id) => !gone(id)).sort());
		const kept = before.deps.filter((d) => !d.split(' -> ').some(gone));
		expect(after.deps).toEqual(kept);
		return;
	}
	if (intent.type !== 'moveTask') return;
	const map = movedId(intent.task, intent.parent);
	expect([...after.parent.keys()].sort()).toEqual(ids.map(map).sort());
	const next = map(intent.task);
	expect(after.parent.get(next)).toBe(intent.parent);
	expect(after.children(intent.parent).indexOf(next)).toBe(intent.index);
	for (const id of ids) {
		if (id === intent.task) continue;
		const p = before.parent.get(id) ?? null;
		expect(after.parent.get(map(id))).toBe(p === null ? null : map(p));
	}
	const mapped = before.deps.map((d) => d.split(' -> ').map(map).join(' -> ')).sort();
	expect(after.deps).toEqual(mapped);
}

const tally = new Map<string, number>();
afterAll(() => {
	console.log(`task tree outcomes: ${JSON.stringify([...tally].sort())}`);
});

function check(c: Loaded, intent: EditIntent, model?: Shape): void {
	let r: EditResult;
	try {
		r = applyIntent(c.snap, c.index, intent);
	} catch (e) {
		throw new Error(`${c.name}: ${JSON.stringify(intent)} threw ${String(e)}`);
	}
	const k = `${intent.type} ${r.status}${r.status === 'refused' ? ` ${r.reason}` : ''}`;
	tally.set(k, (tally.get(k) ?? 0) + 1);
	if (r.status !== 'edit') return;
	const e = r.edit;
	for (const [path, cs] of Object.entries(e.changes)) {
		const base = c.snap.files.get(path)?.text;
		if (!base) throw new Error(`no ${path}`);
		expect(e.inverse[path]?.apply(cs.apply(base)).toString()).toBe(base.toString());
		// CodeMirror merges touching changes, so a changed range lies in the union of the targets.
		const merged: Array<{ from: number; to: number }> = [];
		for (const t of [...(e.targets[path] ?? [])].sort((a, b) => a.from - b.from)) {
			const last = merged[merged.length - 1];
			if (last && t.from <= last.to) last.to = Math.max(last.to, t.to);
			else merged.push({ from: t.from, to: t.to });
		}
		cs.iterChangedRanges((from, to) => {
			expect(merged.some((t) => t.from <= from && to <= t.to)).toBe(true);
		});
	}
	const next = createWorkspace({ entry: c.snap.entry, files: textsOf(c.snap, r) }).snapshot();
	expect(issues(next)).toBeLessThanOrEqual(issues(c.snap));
	try {
		checkShape(intent, model ?? shapeOf(c.snap), shapeOf(next));
	} catch (err) {
		throw new Error(`${c.name}: ${JSON.stringify(intent)}: ${String(err)}`);
	}
}

const pick = fc.array(fc.nat({ max: 10_000 }), { minLength: 5, maxLength: 5 });

describe('task tree intents on generated plans', () => {
	it('keep locality, inverse, parse and the tree the intent asks for', () => {
		fc.assert(
			fc.property(arbPlan(), pick, (plan, p) => {
				const c = load('generated', plan);
				// The oracle starts from the generator's model, not from the index.
				check(c, intentFor(c.index, p), plan.model);
			}),
			{ numRuns: RUNS, ...SEED },
		);
		for (const t of ['addTask', 'deleteTask', 'moveTask']) {
			expect(tally.get(`${t} edit`) ?? 0).toBeGreaterThanOrEqual(5);
		}
	}, 120_000);
});

describe('task tree intents on the corpus', () => {
	const corpus = corpusPlans()
		.filter((c) => !c.name.includes('20-scale-1000'))
		.map((c) => load(c.name, c.plan))
		.filter((c) => c.index.tasks.size > 0);

	it('keep locality, inverse, parse and the tree the intent asks for', () => {
		fc.assert(
			fc.property(fc.nat({ max: corpus.length - 1 }), pick, (i, p) => {
				const c = corpus[i] as Loaded;
				check(c, intentFor(c.index, p));
			}),
			{ numRuns: RUNS, ...SEED },
		);
	}, 120_000);
});
