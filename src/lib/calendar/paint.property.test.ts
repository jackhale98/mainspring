// SPDX-License-Identifier: GPL-2.0-or-later
// Leave-paint properties (phase-3.md 6.6, 13.1), text only (the engine half is in
// paint.engine.test.ts): random paint and erase strokes of whole local days, every type, with and
// without a name, Everyone or one person, on the leave-types fixture (UTC, every leave type and a
// vacation) and the DST-weeks fixture (Europe/Berlin). For every stroke that gives an edit:
// - the inverse restores the text byte for byte, every change lies in a declared target, and a
//   fresh parse has no new syntax issues;
// - re-indexed, a paint's days are covered by the scope's items of its type and name, and an
//   erase leaves no own item of the scope in its days.
// FC_SEED fixes the seed; PAINT_RUNS sets the number of strokes per fixture.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { syntaxIssues } from '../tjp/tree';
import { applyIntent } from '../tjp/edit/apply';
import type { LeaveType } from '../tjp/edit/types';
import { buildIndex } from '../tjp/index';
import { createWorkspace } from '../workspace/workspace';
import { bucketAxis } from '../workload/axis';
import { workloadPlan, ZONES, type Plan } from '../workload/rebalance-testing';
import { planLeavePaint, type LeavePaint, type PaintScope } from './paint';
import { scopeItems } from './paint-items';

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['PAINT_RUNS'] ?? 150);
const TYPES: LeaveType[] = ['holiday', 'annual', 'special', 'sick', 'unpaid', 'unemployed'];

/** Random strokes over the plan's local days (from the day axis, so DST days are right). */
function strokeArb(p: Plan): fc.Arbitrary<LeavePaint> {
	const project = p.result.project;
	if (!project) throw new Error('no project');
	const days = bucketAxis(project, ZONES, 'day').bounds;
	const people = [...p.index.resources.keys()];
	const scope: fc.Arbitrary<PaintScope> = fc.oneof(
		fc.constant({ kind: 'global' as const }),
		fc.constantFrom(...people).map((resource) => ({ kind: 'resource' as const, resource })),
	);
	const range = fc
		.tuple(fc.nat({ max: days.length - 2 }), fc.integer({ min: 1, max: 6 }))
		.map(([i, n]) => {
			const j = Math.min(days.length - 1, i + n);
			return { from: Math.max(0, days[i] as number), to: days[j] as number };
		});
	const name = fc.option(fc.constantFrom('Holiday', 'Company closure', 'Trip'), { nil: undefined });
	return fc.oneof(
		fc.tuple(scope, range, fc.constantFrom(...TYPES), name).map(([s, r, leave, n]) => ({
			type: 'paint' as const,
			scope: s,
			...r,
			leave,
			...(n === undefined ? {} : { name: n }),
		})),
		fc.tuple(scope, range).map(([s, r]) => ({ type: 'erase' as const, scope: s, ...r })),
	);
}

/** Edits per kind, so a run that never edits fails. */
const edits = { paint: 0, erase: 0 };

function check(p: Plan, stroke: LeavePaint): boolean {
	const planned = planLeavePaint(stroke, { index: p.index, result: p.result, zones: ZONES });
	if (planned.status !== 'intent') return true;
	const r = applyIntent(p.snap, p.index, planned.intent);
	if (r.status !== 'edit') return true;
	edits[stroke.type]++;
	const files: Record<string, string> = {};
	for (const [path, f] of p.snap.files) {
		const cs = r.edit.changes[path];
		const after = cs ? cs.apply(f.text) : f.text;
		files[path] = after.toString();
		if (!cs) continue;
		expect(r.edit.inverse[path]?.apply(after).toString()).toBe(f.text.toString());
		const targets = r.edit.targets[path] ?? [];
		cs.iterChangedRanges((a, b) => {
			expect(targets.some((t) => t.from <= a && b <= t.to)).toBe(true);
		});
	}
	const snap = createWorkspace({ entry: p.snap.entry, files }).snapshot();
	for (const [path, f] of snap.files) {
		const before = p.snap.files.get(path);
		if (before) {
			expect(syntaxIssues(f.tree, f.text).length).toBe(
				syntaxIssues(before.tree, before.text).length,
			);
		}
	}
	const index = buildIndex(snap, undefined, { cache: null, zones: ZONES });
	const project = p.result.project;
	if (!project) return false;
	const items = scopeItems(index, stroke.scope, Math.round(Date.parse(project.start) / 1000));
	if (stroke.type === 'erase') {
		return !items.some((i) => i.to > stroke.from && i.from < stroke.to);
	}
	const mine = items.filter((i) => i.type === stroke.leave && i.name === (stroke.name ?? null));
	// Every day of the stroke is in one of the scope's items of its type and name.
	return mine.some((i) => i.from <= stroke.from && stroke.to <= i.to);
}

describe.each(['leave-types', 'dst-weeks'])('paint and erase on %s (property)', (name) => {
	it('gives local edits that parse and say what was painted', () => {
		const p = workloadPlan(name);
		fc.assert(
			fc.property(strokeArb(p), (s) => check(p, s)),
			{ numRuns: RUNS, ...SEED },
		);
		expect(edits.paint).toBeGreaterThan(RUNS / 5);
		// dst-weeks has no leave to erase.
		if (name === 'leave-types') expect(edits.erase).toBeGreaterThan(RUNS / 20);
		console.info(`${name}: ${edits.paint} paint and ${edits.erase} erase edits in ${RUNS} strokes`);
		edits.paint = 0;
		edits.erase = 0;
	});
});
