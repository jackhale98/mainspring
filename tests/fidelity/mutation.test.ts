// SPDX-License-Identifier: GPL-2.0-or-later
// The meta-test of phase-1.md 9.3: the properties must have teeth. Faulty wrappers around the edit API
// (one byte touched outside the target, one required change skipped, one inverse change dropped) must
// each make P1, P3 or P6 fail within 200 generated cases, or the suite would pass a broken edit API.
// When T11b (deleteTask, moveTask) merges, its module can add the literal "reference fix skipped"
// mutant; until then the skipped change is the last change of any edit with several (a removed site,
// list item or statement).
import type { ChangeSet, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { changeSetOf } from '../../src/lib/tjp/document';
import type { WorkspaceSnapshot } from '../../src/lib/workspace/workspace';
import type { TjpEdit } from '../../src/lib/tjp/edit/types';
import { generatedCase, typeOfCase } from './cases';
import { runCase, realApply, type ApplyFn } from './harness';
import { writePart, type MutationPart } from './stats';

interface Spec {
	from: number;
	to: number;
	insert: string;
}

/** The edit with other forward changes (inverse recomputed), over the same base texts. */
function withChanges(
	edit: TjpEdit,
	specs: Record<string, Spec[]>,
	baseTexts: Record<string, Text>,
): TjpEdit {
	const changes: Record<string, ChangeSet> = { ...edit.changes };
	const inverse: Record<string, ChangeSet> = { ...edit.inverse };
	for (const [file, list] of Object.entries(specs)) {
		const text = baseTexts[file];
		if (!text) continue;
		const cs = changeSetOf(list, text.length);
		changes[file] = cs;
		inverse[file] = cs.invert(text);
	}
	return { ...edit, changes, inverse };
}

/** The edit with `[from, to]` of `file` added to its declared targets, so that only the oracle can object. */
const widen = (edit: TjpEdit, file: string, from: number, to: number): TjpEdit => ({
	...edit,
	targets: { ...edit.targets, [file]: [...(edit.targets[file] ?? []), { file, from, to }] },
});

const baseTexts = (snap: WorkspaceSnapshot): Record<string, Text> =>
	Object.fromEntries([...snap.files].map(([k, f]) => [k, f.text]));

const specsOf = (edit: TjpEdit): Record<string, Spec[]> => {
	const out: Record<string, Spec[]> = {};
	for (const [file, cs] of Object.entries(edit.changes)) {
		out[file] = [];
		cs.iterChanges((from, to, _a, _b, ins) =>
			out[file]?.push({ from, to, insert: ins.toString() }),
		);
	}
	return out;
};

/** Faulty wrappers: each returns the real result with one defect added to an edit. */
const MUTANTS: Array<{ name: string; by: string[]; wrap: (real: ApplyFn) => ApplyFn }> = [
	{
		name: 'touches one byte outside the target',
		by: ['P1-region'],
		wrap: (real) => (snap, index, intent) => {
			const r = real(snap, index, intent);
			if (r.status !== 'edit') return r;
			const file = snap.entry;
			const text = snap.files.get(file)?.text;
			if (!text) return r;
			const inTargets = (p: number): boolean =>
				(r.edit.targets[file] ?? []).some((t) => t.from <= p && p <= t.to);
			const p = [0, text.length, Math.floor(text.length / 2)].find((x) => !inTargets(x));
			if (p === undefined) return r;
			const specs = specsOf(r.edit);
			(specs[file] ??= []).push({ from: p, to: p, insert: ' ' });
			const edit = widen(withChanges(r.edit, specs, baseTexts(snap)), file, p, p);
			return { status: 'edit', edit };
		},
	},
	{
		name: 'skips one required change (a removed site, item or statement)',
		by: ['P3', 'P1-region'],
		wrap: (real) => (snap, index, intent) => {
			const r = real(snap, index, intent);
			if (r.status !== 'edit') return r;
			const specs = specsOf(r.edit);
			const flat = Object.entries(specs).flatMap(([file, list]) => list.map((s) => ({ file, s })));
			if (flat.length < 2) return r;
			const drop = flat[flat.length - 1];
			if (!drop) return r;
			specs[drop.file] = (specs[drop.file] ?? []).filter((s) => s !== drop.s);
			return { status: 'edit', edit: withChanges(r.edit, specs, baseTexts(snap)) };
		},
	},
	{
		name: 'writes an inserted statement at the wrong place (the top of its file)',
		by: ['P1-region'],
		wrap: (real) => (snap, index, intent) => {
			const r = real(snap, index, intent);
			if (r.status !== 'edit' || intent.type === 'format') return r;
			const specs = specsOf(r.edit);
			for (const [file, list] of Object.entries(specs)) {
				const text = snap.files.get(file)?.text.toString() ?? '';
				const top = text.search(/\n/) + 1;
				const at = list.findIndex((c) => c.from === c.to && c.insert.includes('\n'));
				const c = list[at];
				if (!c || top <= 0 || c.from === top) continue;
				list[at] = { ...c, from: top, to: top };
				const edit = widen(withChanges(r.edit, specs, baseTexts(snap)), file, top, top);
				return { status: 'edit', edit };
			}
			return r;
		},
	},
	{
		name: 'drops one change of the inverse',
		by: ['P6'],
		wrap: (real) => (snap, index, intent) => {
			const r = real(snap, index, intent);
			if (r.status !== 'edit') return r;
			const inverse: Record<string, ChangeSet> = { ...r.edit.inverse };
			for (const [file, inv] of Object.entries(r.edit.inverse)) {
				const list: Spec[] = [];
				inv.iterChanges((from, to, _a, _b, ins) => list.push({ from, to, insert: ins.toString() }));
				if (list.length === 0) continue;
				inverse[file] = changeSetOf(list.slice(1), inv.length);
				return { status: 'edit', edit: { ...r.edit, inverse } };
			}
			return r;
		},
	},
];

/** Fixed, so that the meta-test does not depend on FIDELITY_SEED. */
const MUTATION_SEED = 4_100_000;
const BUDGET = 200;
const parts: MutationPart['mutants'] = [];

describe('the properties have teeth', () => {
	it('the unmodified wrapper passes the cases used below', () => {
		for (let n = 0; n < 48; n++) {
			const c = generatedCase(MUTATION_SEED + n, typeOfCase(n));
			expect(runCase(c, realApply).failures, `${c.type} ${c.seed}`).toEqual([]);
		}
	});

	for (const m of MUTANTS) {
		it(`catches a wrapper that ${m.name}`, () => {
			const apply = m.wrap(realApply);
			let caught: string | null = null;
			let used = 0;
			for (let n = 0; n < BUDGET && caught === null; n++) {
				used = n + 1;
				const c = generatedCase(MUTATION_SEED + 1000 + n, typeOfCase(n));
				const labels = runCase(c, apply).failures.map((f) => f.split(':')[0] as string);
				caught = m.by.find((p) => labels.includes(p)) ?? null;
			}
			parts.push({ name: m.name, caught: caught !== null, by: caught ?? '-', cases: used });
			expect(caught, `not caught within ${BUDGET} cases`).not.toBeNull();
			writePart('mutation', { mutants: parts } satisfies MutationPart);
		});
	}
});
