// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { tjpEditId, type ChangeOrigin, type ChangeInfo } from '../../workspace/workspace';
import { buildIndex } from '../index';
import {
	applyEdit,
	applyIntent,
	buildEdit,
	finishPlan,
	formatFile,
	newEditId,
	undoEdit,
} from './apply';
import { insertStatement, removeStatement, replaceSpan } from './layout';
import { noop, refused, type EditIntent, type EditOp, type TjpEdit } from './types';
import { ops, setup, span, stmt, textsAfter } from './testing';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
const INTENT: EditIntent = { type: 'setAttr', task: 'a', attr: 'effort', value: '2d' };
const FILES = {
	'plan.tjp': HEAD + 'task a "A" {\n  effort 5d\n}\ninclude "b.tji"\n',
	'b.tji': 'task b "B" {\n  effort 1d\n}\n',
};

function edit(r: ReturnType<typeof buildEdit>): TjpEdit {
	if (r.status !== 'edit') throw new Error(JSON.stringify(r));
	return r.edit;
}

describe('buildEdit', () => {
	it('builds per-file change sets, inverses, bases, targets and the selection', () => {
		const s = setup(FILES);
		const a = s.file();
		const b = s.file('b.tji');
		const list: EditOp[] = [
			replaceSpan(a, span(a, '5d'), '2d'),
			...ops(insertStatement(a, stmt(a, 'task a'), 'note "n"', 'start')),
			removeStatement(b, stmt(b, 'effort')),
		];
		const e = edit(buildEdit(s.snap, INTENT, list, { id: 'e1' }));
		expect(e.id).toBe('e1');
		expect(Object.keys(e.changes).sort()).toEqual(['b.tji', 'plan.tjp']);
		expect(e.base).toEqual({ 'plan.tjp': a.version, 'b.tji': b.version });
		const after = textsAfter(s.snap, { status: 'edit', edit: e });
		expect(after['plan.tjp']).toBe(
			HEAD + 'task a "A" {\n  note "n"\n  effort 2d\n}\ninclude "b.tji"\n',
		);
		expect(after['b.tji']).toBe('task b "B" {\n}\n');
		for (const [p, cs] of Object.entries(e.changes)) {
			const inv = e.inverse[p];
			const base = s.snap.files.get(p)?.text;
			expect(inv && base && inv.apply(cs.apply(base)).toString()).toBe(base?.toString());
		}
		expect(e.targets['plan.tjp']).toHaveLength(2);
		// The selection is the first op's (the value), mapped past the inserted note line.
		const sel = e.select;
		expect(sel && after['plan.tjp']?.slice(sel.from, sel.to)).toBe('2d');
	});

	it('refuses results with new error nodes', () => {
		const s = setup(FILES);
		const a = s.file();
		const r = buildEdit(s.snap, INTENT, [replaceSpan(a, span(a, '5d'), '5d {')]);
		expect(r).toMatchObject({ status: 'refused', reason: 'syntax-error' });
	});

	it('gives already-set for ops that change nothing', () => {
		const s = setup(FILES);
		const a = s.file();
		expect(buildEdit(s.snap, INTENT, [replaceSpan(a, span(a, '5d'), '5d')])).toEqual(
			noop('already-set'),
		);
	});

	it('throws on overlapping ops and changes outside their target', () => {
		const s = setup(FILES);
		const a = s.file();
		const v = span(a, '5d');
		expect(() =>
			buildEdit(s.snap, INTENT, [
				replaceSpan(a, v, 'x'),
				replaceSpan(a, { ...v, to: v.to + 1 }, 'y'),
			]),
		).toThrow(/overlapping/);
		const out: EditOp = { ...replaceSpan(a, v, 'x'), target: { from: v.from, to: v.from + 1 } };
		expect(() => buildEdit(s.snap, INTENT, [out])).toThrow(/outside/);
	});

	it('keeps the order of insertions at one point', () => {
		const s = setup(FILES);
		const a = s.file();
		const at = span(a, '5d').from;
		const ins = (t: string): EditOp => ({ ...replaceSpan(a, { from: at, to: at }, t) });
		const after = textsAfter(s.snap, buildEdit(s.snap, INTENT, [ins('1'), ins('2'), ins('3')]));
		expect(after['plan.tjp']).toContain('effort 1235d');
	});

	it('makes unique ids', () => {
		expect(newEditId()).not.toBe(newEditId());
	});
});

describe('applyIntent and finishPlan', () => {
	const s = setup(FILES);
	const a = s.file();

	it('passes refusals and no-ops through and runs the pipeline', () => {
		expect(finishPlan(s.ctx, INTENT, refused('cycle'))).toEqual(refused('cycle'));
		expect(finishPlan(s.ctx, INTENT, noop('not-present'))).toEqual(noop('not-present'));
		expect(finishPlan(s.ctx, INTENT, [replaceSpan(a, span(a, '5d'), '2d')]).status).toBe('edit');
	});

	it('dispatches to handlers and to formatFile', () => {
		const r = applyIntent(
			s.snap,
			s.index,
			INTENT,
			{},
			{
				setAttr: { plan: (_ctx, i) => [replaceSpan(a, span(a, '5d'), String(i.value))] },
			},
		);
		expect(textsAfter(s.snap, r)['plan.tjp']).toContain('effort 2d');
		expect(() => applyIntent(s.snap, s.index, INTENT, {}, {})).toThrow(/no edit handler/);
		expect(applyIntent(s.snap, s.index, { type: 'format', file: 'plan.tjp' })).toEqual(
			noop('already-set'),
		);
	});
});

describe('Workspace.apply integration', () => {
	function listen(s: ReturnType<typeof setup>) {
		const seen: Array<{ origin: ChangeOrigin; info: ChangeInfo }> = [];
		s.workspace.subscribe((_snap, origin, info) => seen.push({ origin, info }));
		return seen;
	}

	it('applies every file, annotated with the edit id and the intent event', () => {
		const s = setup(FILES);
		const seen = listen(s);
		const a = s.file();
		const b = s.file('b.tji');
		const e = edit(
			finishPlan(s.ctx, INTENT, [
				replaceSpan(a, span(a, '5d'), '2d'),
				replaceSpan(b, span(b, '1d'), '3d'),
			]),
		);
		expect(s.workspace.apply(e)).toBe('applied');
		expect(s.workspace.texts()['b.tji']).toContain('effort 3d');
		expect(seen).toHaveLength(1);
		expect(seen[0]?.origin).toBe('intent');
		for (const tr of seen[0]?.info.transactions ?? []) {
			expect(tr.annotation(tjpEditId)).toBe(e.id);
			expect(tr.isUserEvent('input.tjp.setAttr')).toBe(true);
		}
		expect(seen[0]?.info.transactions).toHaveLength(2);
	});

	it('is all or nothing when a base version moved', () => {
		const s = setup(FILES);
		const a = s.file();
		const b = s.file('b.tji');
		const e = edit(
			finishPlan(s.ctx, INTENT, [
				replaceSpan(a, span(a, '5d'), '2d'),
				replaceSpan(b, span(b, '1d'), '3d'),
			]),
		);
		const st = s.workspace.state('b.tji');
		s.workspace.commit('b.tji', st.update({ changes: { from: 0, insert: '# x\n' } }), 'typing');
		const before = s.workspace.texts();
		expect(s.workspace.apply(e)).toBe('stale');
		expect(s.workspace.texts()).toEqual(before);
	});

	it('undoes with the inverse, byte for byte', () => {
		const s = setup(FILES);
		const original = s.workspace.texts();
		const a = s.file();
		const e = edit(
			finishPlan(s.ctx, INTENT, [
				...ops(insertStatement(a, stmt(a, 'task a'), 'note "n"', 'start')),
			]),
		);
		const applied = applyEdit(s.workspace, e);
		if (applied === 'stale') throw new Error('stale');
		expect(applied.versions['plan.tjp']).toBe((e.base['plan.tjp'] ?? 0) + 1);
		const undo = undoEdit(applied, s.workspace.snapshot());
		expect(undo).not.toBeNull();
		if (undo) expect(s.workspace.apply(undo)).toBe('applied');
		expect(s.workspace.texts()).toEqual(original);
		// The undo was applied, so the edit's inverse no longer fits.
		expect(undoEdit(applied, s.workspace.snapshot())).toBeNull();
	});

	it('refuses to undo after a same-length change (M4)', () => {
		const s = setup(FILES);
		const a = s.file();
		const e = edit(finishPlan(s.ctx, INTENT, [replaceSpan(a, span(a, '5d'), '2d')]));
		const applied = applyEdit(s.workspace, e);
		if (applied === 'stale') throw new Error('stale');
		const st = s.workspace.state('plan.tjp');
		const p = s.workspace.texts()['plan.tjp']?.indexOf('"A"') ?? 0;
		s.workspace.commit(
			'plan.tjp',
			st.update({ changes: { from: p + 1, to: p + 2, insert: 'B' } }),
			'typing',
		);
		expect(s.workspace.snapshot().files.get('plan.tjp')?.text.length).toBe(
			e.inverse['plan.tjp']?.length,
		);
		expect(undoEdit(applied, s.workspace.snapshot())).toBeNull();
		expect(applyEdit(s.workspace, e)).toBe('stale');
	});

	it('records versions even when a listener edits in turn', () => {
		const s = setup(FILES);
		const a = s.file();
		const e = edit(finishPlan(s.ctx, INTENT, [replaceSpan(a, span(a, '5d'), '2d')]));
		let once = false;
		s.workspace.subscribe(() => {
			if (once) return;
			once = true;
			const st = s.workspace.state('b.tji');
			s.workspace.commit('b.tji', st.update({ changes: { from: 0, insert: '# x\n' } }), 'typing');
		});
		const applied = applyEdit(s.workspace, e);
		if (applied === 'stale') throw new Error('stale');
		expect(applied.versions['plan.tjp']).toBe((e.base['plan.tjp'] ?? 0) + 1);
		expect(undoEdit(applied, s.workspace.snapshot())).not.toBeNull();
	});

	it('reports format edits with origin format', () => {
		const s = setup({ 'plan.tjp': HEAD + 'task a "A" {\neffort 5d   \n}\n' });
		const seen = listen(s);
		const e = edit(formatFile(s.snap, 'plan.tjp'));
		expect(e.intent).toEqual({ type: 'format', file: 'plan.tjp' });
		expect(s.workspace.apply(e)).toBe('applied');
		expect(seen[0]?.origin).toBe('format');
		expect(s.workspace.texts()['plan.tjp']).toBe(HEAD + 'task a "A" {\n  effort 5d\n}\n');
	});
});

describe('formatFile', () => {
	it('refuses unknown files and files with syntax errors only', () => {
		const s = setup({ 'plan.tjp': HEAD + 'task a "A" {\n  effort 5d @\n}\n' });
		expect(formatFile(s.snap, 'x.tji')).toMatchObject({ reason: 'unknown-target' });
		expect(formatFile(s.snap, 'plan.tjp')).toMatchObject({ reason: 'syntax-error' });
	});

	it('declares the changed ranges as targets and selects nothing', () => {
		const s = setup({
			'plan.tjp': HEAD + 'task a "A" {\n  effort 5d\n  task b "B" {\n      effort 1d\n  }\n}\n',
		});
		const e = edit(formatFile(s.snap, 'plan.tjp'));
		expect(e.select).toBeNull();
		expect(e.targets['plan.tjp']?.length).toBeGreaterThan(0);
		const idx = buildIndex(s.snap, undefined, { cache: null });
		expect(idx.version).toBe(s.snap.version);
	});
});
