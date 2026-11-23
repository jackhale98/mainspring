// SPDX-License-Identifier: GPL-2.0-or-later
// Merge properties (phase-4.md 13.1, 22; types.ts "Laws" and "Stable ids") over realistic sides:
// generated and golden plans edited by random edit-API intents (sides-testing.ts), one or four per
// side. FC_SEED fixes
// the fast-check seed (CI sets it); MERGE_RUNS sizes the runs.
// - laws: merge(b, x, b) = x, merge(b, b, x) = x and merge(b, x, x) = x, clean;
// - swapping ours and theirs gives the same conflicts with their sides swapped;
// - commutation: intents on different tasks that do not insert at one place merge cleanly, equal
//   to applying B on top of A (and A on top of B for the swapped merge);
// - a clean merge of sides that parse has no syntax issue; a merge with conflicts holds ours in
//   each region, and every region parses again after Take mine or Take theirs where both sides do;
// - one attribute set both ways is one attribute conflict naming it: Take mine gives ours, Take
//   theirs gives theirs' value on top of ours' other edit;
// - ids are unique, stable when the merge is computed again from a newer ours, and new when theirs
//   moves to a head that changes the conflicting region;
// - nothing is doubled: no task or resource is declared more often than on either side.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SyntaxNode } from '@lezer/common';
import { parseTjp, syntaxIssues, textOf } from '../document';
import { statementsIn } from '../tree';
import { blockKind, statementKey } from './hints';
import type { EditIntent } from '../edit/types';
import {
	addsAtSamePlace,
	applyTo,
	drawIntent,
	LOCAL,
	planOf,
	touched,
	touching,
	twoSides,
	type Plan,
	type Texts,
} from './sides-testing';
import { contextOf, filesOf, resolveAll } from './testing';
import { mergeWorkspace } from '../../sync/merge';
import { ENFORCED } from '../../../../tests/fidelity/families';
import type { MergeConflict, WorkspaceMerge } from './types';

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['MERGE_RUNS'] ?? 60);
const opts = { ...SEED, numRuns: RUNS };
const seeds = fc.integer({ min: 1, max: 0x7fffffff });

function merge(p: Plan, base: Texts, ours: Texts, theirs: Texts): WorkspaceMerge {
	return mergeWorkspace(filesOf(base), filesOf(ours), filesOf(theirs), contextOf(p.entry, ours));
}

const plain = (m: WorkspaceMerge): Record<string, string> => Object.fromEntries(m.files);

/** Syntax issues per file, parsed in the context ours' include graph gives it. */
function issues(p: Plan, files: Texts): number {
	const tops = contextOf(p.entry, files).includes.tops;
	let n = 0;
	for (const [f, t] of Object.entries(files)) {
		n += syntaxIssues(parseTjp(t, { top: tops.get(f) ?? 'global' }), textOf(t)).length;
	}
	return n;
}

/** Task and resource declarations by their path of keys, counted (nested ones too). */
function decls(p: Plan, files: Texts): Map<string, number> {
	const tops = contextOf(p.entry, files).includes.tops;
	const out = new Map<string, number>();
	for (const [f, t] of Object.entries(files)) {
		const walk = (node: SyntaxNode, path: string): void => {
			for (const st of statementsIn(node)) {
				const kind = blockKind(st);
				if (kind !== 'task' && kind !== 'resource') continue;
				const key = `${path}/${statementKey(st, t) ?? ''}`;
				out.set(key, (out.get(key) ?? 0) + 1);
				const body = st.getChild('Body');
				if (body) walk(body, key);
			}
		};
		walk(parseTjp(t, { top: tops.get(f) ?? 'global' }).topNode, f);
	}
	return out;
}

const subjectKey = (c: MergeConflict, swap: boolean): string => {
	const s = c.subject;
	const flip = (x: string): string =>
		swap
			? x
					.replace('deleted-ours', '@')
					.replace('deleted-theirs', 'deleted-ours')
					.replace('@', 'deleted-theirs')
			: x;
	const what =
		s.kind === 'attribute' ? `${s.owner.kind}:${s.attr}` : s.kind === 'text' ? '' : flip(s.change);
	return `${c.file}|${s.kind}|${what}|${c.base}|${swap ? c.theirs : c.ours}|${swap ? c.ours : c.theirs}`;
};

/** What a conflict's region in the merged text holds (types.ts `at`). */
function held(c: MergeConflict): string {
	const deletedOurs =
		(c.subject.kind === 'block' || c.subject.kind === 'file') &&
		c.subject.change === 'deleted-ours';
	return (deletedOurs ? c.theirs : c.ours) ?? '';
}

describe('merge properties (13.1)', { timeout: 300_000 }, () => {
	it('laws: one side unchanged gives the other; equal sides give that side', () => {
		fc.assert(
			fc.property(seeds, (seed) => {
				const s = twoSides(seed);
				fc.pre(s !== null);
				if (!s) return;
				const { p, a } = s;
				for (const m of [
					merge(p, p.files, a.files, p.files),
					merge(p, p.files, p.files, a.files),
					merge(p, p.files, a.files, a.files),
				]) {
					expect(m.conflicts).toEqual([]);
					expect(plain(m)).toEqual(a.files);
				}
			}),
			opts,
		);
	});

	it('swapping ours and theirs gives the same conflicts with their sides swapped', () => {
		fc.assert(
			fc.property(seeds, (seed) => {
				const s = twoSides(seed, ENFORCED, seed % 2 === 0 ? 3 : 0);
				fc.pre(s !== null);
				if (!s) return;
				const ab = merge(s.p, s.p.files, s.a.files, s.b.files);
				const ba = merge(s.p, s.p.files, s.b.files, s.a.files);
				// The same conflicts; their order may differ, as each merge holds its own ours.
				expect(ba.conflicts.map((c) => subjectKey(c, true)).sort()).toEqual(
					ab.conflicts.map((c) => subjectKey(c, false)).sort(),
				);
				if (ab.conflicts.length === 0) {
					// Clean both ways: the files differ at most in the order of two adds at one place.
					expect(Object.keys(plain(ba)).sort()).toEqual(Object.keys(plain(ab)).sort());
				}
			}),
			opts,
		);
	});

	it('commutation: intents on different tasks merge cleanly, equal to B on top of A', () => {
		let checked = 0;
		fc.assert(
			fc.property(seeds, (seed) => {
				const s = twoSides(seed, LOCAL);
				fc.pre(s !== null);
				if (!s) return;
				const ta = touched(s.a.intent);
				const tb = touched(s.b.intent);
				fc.pre(ta !== null && tb !== null && !ta.some((t) => tb.includes(t)));
				const ca = s.a.changes?.changes ?? [];
				const cb = s.b.changes?.changes ?? [];
				fc.pre(!addsAtSamePlace(ca, cb) && !touching(ca, cb));
				const bOnA = applyTo(s.p, s.a.files, s.b.intent);
				const aOnB = applyTo(s.p, s.b.files, s.a.intent);
				fc.pre(bOnA !== null && aOnB !== null);
				const ab = merge(s.p, s.p.files, s.a.files, s.b.files);
				const ba = merge(s.p, s.p.files, s.b.files, s.a.files);
				const why = `${s.p.name}: ${JSON.stringify(s.a.intent)} / ${JSON.stringify(s.b.intent)}`;
				expect(ab.conflicts, why).toEqual([]);
				expect(plain(ab), why).toEqual(bOnA?.files);
				expect(ba.conflicts, why).toEqual([]);
				expect(plain(ba), why).toEqual(aOnB?.files);
				checked++;
			}),
			opts,
		);
		console.info(`commutation: ${checked} pairs checked`);
		expect(checked).toBeGreaterThan(0);
	});

	it('a clean merge parses; conflicts hold ours; Take mine and Take theirs parse', () => {
		fc.assert(
			fc.property(seeds, (seed) => {
				// Half the cases make four edits per side.
				const s = twoSides(seed, ENFORCED, seed % 2 === 0 ? 3 : 0);
				fc.pre(s !== null);
				if (!s) return;
				const { p } = s;
				const m = merge(p, p.files, s.a.files, s.b.files);
				const sidesClean = issues(p, s.a.files) === 0 && issues(p, s.b.files) === 0;
				const merged = plain(m);
				for (const c of m.conflicts) {
					expect((merged[c.file] ?? '').slice(c.at.from, c.at.to)).toBe(held(c));
					if (c.atOurs)
						expect((s.a.files[c.file] ?? '').slice(c.atOurs.from, c.atOurs.to)).toBe(c.ours ?? '');
				}
				expect(new Set(m.conflicts.map((c) => c.id)).size).toBe(m.conflicts.length);
				if (!sidesClean) return;
				// No task or resource is declared more often than on either side (nothing doubled).
				const da = decls(p, s.a.files);
				const db = decls(p, s.b.files);
				for (const [k, n] of decls(p, merged)) {
					expect(n, k).toBeLessThanOrEqual(Math.max(da.get(k) ?? 0, db.get(k) ?? 0));
				}
				if (m.conflicts.length === 0) expect(issues(p, merged)).toBe(0);
				else {
					const mine = Object.fromEntries(resolveAll(m, 'ours'));
					const theirs = Object.fromEntries(resolveAll(m, 'theirs'));
					expect(issues(p, mine)).toBe(0);
					expect(issues(p, theirs)).toBe(0);
					for (const c of m.conflicts) if (c.theirs) expect(theirs[c.file]).toContain(c.theirs);
				}
			}),
			opts,
		);
	});

	it('one attribute set both ways is one attribute conflict; Take mine and Take theirs give each', () => {
		let checked = 0;
		fc.assert(
			fc.property(seeds, fc.boolean(), (seed, extra) => {
				const p = planOf(seed);
				// Refinement needs sides without error nodes (a plan with syntax errors merges on lines).
				fc.pre(issues(p, p.files) === 0);
				const i = drawIntent(p, seed, ['setAttr']);
				fc.pre(
					i !== null &&
						i.type === 'setAttr' &&
						['effort', 'length', 'duration', 'priority', 'complete'].includes(i.attr),
				);
				if (!i || i.type !== 'setAttr') return;
				const v1: EditIntent = {
					...i,
					value: i.attr === 'priority' || i.attr === 'complete' ? '17' : '17d',
				};
				const v2: EditIntent = {
					...i,
					value: i.attr === 'priority' || i.attr === 'complete' ? '23' : '23d',
				};
				const a1 = applyTo(p, p.files, v1);
				const b = applyTo(p, p.files, v2);
				fc.pre(a1 !== null && b !== null);
				if (!a1 || !b) return;
				// With `extra`, ours also edits another task, far from the conflict.
				let a = a1;
				if (extra) {
					const d = drawIntent(p, seed + 7, LOCAL);
					const t = d ? touched(d) : null;
					const da = d && t && !t.includes(i.task) ? applyTo(p, a1.files, d) : null;
					fc.pre(
						da !== null &&
							!touching(
								da.changes,
								a1.changes.map((c) => ({ ...c, from: c.from - 200, to: c.to + 200 })),
							),
					);
					if (!da) return;
					a = { files: da.files, changes: [...a1.changes, ...da.changes] };
				}
				// Theirs' value on top of ours: what Take theirs must give (the edit API must still take it).
				const expected = applyTo(p, a.files, v2);
				fc.pre(expected !== null);
				const m = merge(p, p.files, a.files, b.files);
				const why = `${p.name}: ${JSON.stringify(i)}`;
				expect(
					m.conflicts.map((c) => [
						c.subject.kind,
						c.subject.kind === 'attribute' ? c.subject.attr : null,
					]),
					why,
				).toEqual([['attribute', i.attr]]);
				expect(Object.fromEntries(resolveAll(m, 'ours')), why).toEqual(a.files);
				expect(Object.fromEntries(resolveAll(m, 'theirs')), why).toEqual(expected?.files);
				checked++;
			}),
			opts,
		);
		console.info(`attribute conflicts: ${checked} checked`);
		expect(checked).toBeGreaterThan(0);
	});

	it('ids are unique, stable from a newer ours, and new when theirs changes the region', () => {
		let checked = 0;
		fc.assert(
			fc.property(seeds, (seed) => {
				const p = planOf(seed);
				fc.pre(issues(p, p.files) === 0);
				const i = drawIntent(p, seed, ['setAttr']);
				fc.pre(
					i !== null && i.type === 'setAttr' && ['effort', 'length', 'duration'].includes(i.attr),
				);
				if (!i || i.type !== 'setAttr') return;
				const v = (x: string): EditIntent => ({ ...i, value: x });
				const a = applyTo(p, p.files, v('17d'));
				const b = applyTo(p, p.files, v('23d'));
				// Theirs also edits another task, so the merge has a clean part too.
				const e = drawIntent(p, seed + 5, LOCAL);
				const be = b && e && !touched(e)?.includes(i.task) ? applyTo(p, b.files, e) : null;
				fc.pre(a !== null && be !== null);
				if (!a || !be) return;
				const m = merge(p, p.files, a.files, be.files);
				expect(new Set(m.conflicts.map((c) => c.id)).size).toBe(m.conflicts.length);
				fc.pre(m.conflicts.length > 0);
				// A newer ours: one more intent, away from every conflict's region in ours.
				// It edits a task neither conflicting edit touches (not one theirs edits too).
				const d = drawIntent(p, seed + 11, LOCAL);
				const td = d ? touched(d) : null;
				const busy = [i.task, ...(touched(e as EditIntent) ?? [])];
				const da = d && td && !td.some((t) => busy.includes(t)) ? applyTo(p, a.files, d) : null;
				fc.pre(da !== null);
				if (!da) return;
				const far = m.conflicts.every((c) =>
					da.changes.every(
						(x) =>
							x.file !== c.file ||
							!c.atOurs ||
							x.to < c.atOurs.from - 400 ||
							x.from > c.atOurs.to + 400,
					),
				);
				fc.pre(far);
				const again = merge(p, p.files, da.files, be.files);
				expect(new Set(again.conflicts.map((c) => c.id)).size).toBe(again.conflicts.length);
				// Every conflict keeps its id (the newer edit may add conflicts of its own with theirs).
				const ids = new Set(again.conflicts.map((c) => c.id));
				for (const c of m.conflicts) expect(ids.has(c.id), c.id).toBe(true);
				// Theirs moves to a newer head that changes the attribute again: a new id.
				const b2 = applyTo(p, be.files, v('29d'));
				fc.pre(b2 !== null);
				if (!b2) return;
				const moved = merge(p, p.files, a.files, b2.files);
				const attr = (x: WorkspaceMerge): MergeConflict | undefined =>
					x.conflicts.find((c) => c.subject.kind === 'attribute' && c.subject.attr === i.attr);
				expect(attr(moved)?.theirs).toContain('29d');
				expect(attr(moved)?.id).not.toBe(attr(m)?.id);
				checked++;
			}),
			{ ...opts, numRuns: Math.max(10, Math.round(RUNS / 2)) },
		);
		console.info(`stable ids: ${checked} checked`);
		expect(checked).toBeGreaterThan(0);
	});
});
