// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../index';
import { insertStatement, removeStatement, replaceSpan } from './layout';
import {
	checkFresh,
	checkOps,
	checkSafeText,
	checkStatementErrors,
	statementAround,
	validValue,
} from './refuse';
import type { EditOp } from './types';
import { ops, setup, span, stmt } from './testing';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';

describe('freshness', () => {
	it('refuses an index built from another workspace version', () => {
		const s = setup(HEAD + 'task a "A"\n');
		const st = s.workspace.state('plan.tjp');
		s.workspace.commit('plan.tjp', st.update({ changes: { from: 0, insert: '# x\n' } }), 'typing');
		const ctx = { ...s.ctx, ws: s.workspace.snapshot() };
		expect(checkFresh(ctx)).toMatchObject({ reason: 'stale' });
		const fresh = { ...ctx, index: buildIndex(ctx.ws, undefined, { cache: null }) };
		expect(checkFresh(fresh)).toBeNull();
	});

	it('refuses an index of another workspace at the same version', () => {
		const a = setup(HEAD + 'task a "A"\n');
		const b = setup(HEAD + 'task b "B"\n');
		expect(a.snap.version).toBe(b.snap.version);
		expect(checkFresh({ ...a.ctx, index: b.index })).toMatchObject({ reason: 'stale' });
	});
});

describe('text-only targets', () => {
	const text =
		HEAD +
		'macro len [5d]\n' +
		'task a "A" {\n  effort ${len}\n  start 2026-01-05\n}\n' +
		'task ${len} "M" {\n  start 2026-01-05\n}\n';
	const s = setup(text);
	const f = s.file();

	it('refuses an element under a macro call (X3)', () => {
		const r = checkOps(s.ctx, [removeStatement(f, stmt(f, 'effort'))]);
		expect(r).toMatchObject({ reason: 'text-only', textOnly: 'macro-call' });
	});

	it('allows a target that covers the whole construct', () => {
		expect(checkOps(s.ctx, [removeStatement(f, stmt(f, 'task a'))])).toBeNull();
		expect(checkOps(s.ctx, [removeStatement(f, stmt(f, 'start', 0))])).toBeNull();
	});

	it('checks the change range as well as the element', () => {
		const e = span(f, 'start 2026-01-05');
		const wide: EditOp = { ...replaceSpan(f, e, ''), from: span(f, 'effort').from };
		expect(checkOps(s.ctx, [wide])).toMatchObject({ reason: 'text-only' });
	});

	it('refuses insertions into a block whose id is a macro', () => {
		const r = checkOps(s.ctx, ops(insertStatement(f, stmt(f, 'task ${len}'), 'effort 1d', 'end')));
		expect(r).toMatchObject({ reason: 'text-only', textOnly: 'macro-id' });
	});

	it('refuses unknown files', () => {
		const o: EditOp = { ...replaceSpan(f, { from: 0, to: 0 }, 'x'), file: 'nope.tji' };
		expect(checkOps(s.ctx, [o])).toMatchObject({ reason: 'unknown-target' });
	});
});

describe('syntax errors', () => {
	const text =
		HEAD + 'task a "A" {\n  effort 5d\n  start 2026-01-05 @\n}\ntask b "B" {\n  effort 1d\n}\n';
	const s = setup(text);
	const f = s.file();

	it('refuses edits in a statement that holds an error, not elsewhere', () => {
		const [into] = ops(insertStatement(f, stmt(f, 'task a'), 'note "n"', 'start'));
		expect(into && checkStatementErrors(f, into.element)).toMatchObject({
			reason: 'syntax-error',
		});
		const b = ops(insertStatement(f, stmt(f, 'task b'), 'note "n"', 'start'));
		expect(b[0] && checkStatementErrors(f, b[0].element)).toBeNull();
		expect(checkOps(s.ctx, b)).toBeNull();
	});

	it('finds the statement around a point or a range', () => {
		const e = span(f, 'effort 1d');
		expect(statementAround(f, e)?.name).toBe('EffortStatement');
		expect(statementAround(f, { from: e.from, to: e.from })?.name).toBe('TaskStatement');
		expect(statementAround(f, { from: 0, to: 0 })).toBeNull();
	});
});

describe('shared declarations (M5)', () => {
	const files = {
		'plan.tjp':
			HEAD +
			'task g1 "G1"\ntask g2 "G2"\n' +
			'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
		't.tji': 'task t "T" {\n  effort 1d\n}\ntask u "U"\n',
	};
	const s = setup(files);
	const f = s.file('t.tji');
	const confirmed = { ...s.ctx, opts: { confirmShared: true } };

	it('lets only same-in-every-visit changes through, and only when confirmed', () => {
		const value = [replaceSpan(f, span(f, '1d'), '2d')];
		const r = checkOps(s.ctx, value, true);
		expect(r).toMatchObject({ reason: 'shared-declaration' });
		expect(r?.affects && [...r.affects].sort()).toEqual(['g1.t', 'g2.t']);
		expect(checkOps(confirmed, value, true)).toBeNull();
		const insert = ops(insertStatement(f, stmt(f, 'task t'), 'note "n"', 'start'));
		expect(checkOps(confirmed, insert, false)).toMatchObject({ reason: 'shared-declaration' });
	});

	it('lists every visit id for top-level text', () => {
		const top = ops(insertStatement(f, null, 'task n "N"', 'end'));
		const r = checkOps(confirmed, top);
		expect(r?.affects && [...r.affects].sort()).toEqual(['g1.t', 'g1.u', 'g2.t', 'g2.u']);
	});

	it('leaves files read once alone', () => {
		const main = s.file();
		const m = ops(insertStatement(main, stmt(main, 'task g1'), 'note "n"', 'start'));
		expect(checkOps(s.ctx, m)).toBeNull();
	});
});

describe('values and text', () => {
	const s = setup(HEAD + 'task a "A" {\n  effort 5d\n}\n');
	const where = { file: 'plan.tjp', from: 40, to: 40 };

	it('parses and checks values against the project', () => {
		expect(validValue(s.ctx, 'effort', '3d', where)).toMatchObject({ kind: 'duration' });
		expect(validValue(s.ctx, 'effort', 'x', where)).toMatchObject({ reason: 'invalid-value' });
		expect(validValue(s.ctx, 'start', '2030-01-01', where)).toMatchObject({
			reason: 'invalid-value',
		});
		expect(validValue(s.ctx, 'complete', '120', where)).toMatchObject({
			reason: 'invalid-value',
		});
		expect(() => validValue(s.ctx, 'chargeset', 'x', where)).toThrow();
	});

	it('refuses unsafe text', () => {
		expect(checkSafeText('Plan ${x}')).toMatchObject({ reason: 'unsafe-text' });
		expect(checkSafeText('$(HOME)')).not.toBeNull();
		expect(checkSafeText('a\nb')).not.toBeNull();
		expect(checkSafeText('Design "v2"')).toBeNull();
	});
});
