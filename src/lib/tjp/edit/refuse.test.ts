// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../index';
import { insertStatement, removeStatement, replaceSpan } from './layout';
import {
	checkFresh,
	checkMacroBreaks,
	checkOps,
	checkSafeText,
	checkStatementErrors,
	statementAround,
	validValue,
} from './refuse';
import type { EditOp } from './types';
import { setup, span, stmt } from './testing';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
const op = (x: unknown): EditOp => x as EditOp;

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
		const wide = op({ ...replaceSpan(f, e, ''), from: span(f, 'effort').from });
		expect(checkOps(s.ctx, [wide])).toMatchObject({ reason: 'text-only' });
	});

	it('refuses insertions into a block whose id is a macro', () => {
		const r = checkOps(s.ctx, [
			insertStatement(f, stmt(f, 'task ${len}'), 'effort 1d', 'end') as EditOp,
		]);
		expect(r).toMatchObject({ reason: 'text-only', textOnly: 'macro-id' });
	});

	it('refuses unknown files', () => {
		expect(checkOps(s.ctx, [op({ ...replaceSpan(f, e0(), 'x'), file: 'nope.tji' })])).toMatchObject(
			{ reason: 'unknown-target' },
		);
		function e0() {
			return { from: 0, to: 0 };
		}
	});
});

describe('syntax errors', () => {
	const text =
		HEAD + 'task a "A" {\n  effort 5d\n  start 2026-01-05 @\n}\ntask b "B" {\n  effort 1d\n}\n';
	const s = setup(text);
	const f = s.file();

	it('refuses edits in a statement that holds an error, not elsewhere', () => {
		const into = insertStatement(f, stmt(f, 'task a'), 'note "n"', 'start') as EditOp;
		expect(checkStatementErrors(f, into.element)).toMatchObject({ reason: 'syntax-error' });
		const b = insertStatement(f, stmt(f, 'task b'), 'note "n"', 'start') as EditOp;
		expect(checkStatementErrors(f, b.element)).toBeNull();
		expect(checkOps(s.ctx, [b])).toBeNull();
	});

	it('finds the statement around a point or a range', () => {
		const at = span(f, 'effort 1d');
		expect(statementAround(f, at)?.name).toBe('EffortStatement');
		expect(statementAround(f, { from: at.from, to: at.from })?.name).toBe('TaskStatement');
		expect(statementAround(f, { from: 0, to: 0 })).toBeNull();
	});
});

describe('macro body line breaks', () => {
	// The scanner closes a macro body on `]` and a line break; \r\n and \r count once the
	// tokenizer reads them as breaks (15.14). Until then those bodies are scan errors and the
	// cases are skipped.
	for (const eol of ['\n', '\r\n', '\r']) {
		const text = `${HEAD}macro m [x]${eol}task a "A"${eol}`;
		const s = setup(text);
		const f = s.file();
		let parsed = false;
		f.tree.iterate({
			enter(n) {
				if (n.name === 'MacroBody') parsed = true;
			},
		});
		it.skipIf(!parsed)(`never touches the break after ] (${JSON.stringify(eol)})`, () => {
			const end = text.indexOf(']') + 1;
			const at = (from: number, to = from): EditOp => op({ ...replaceSpan(f, { from, to }, 'y') });
			expect(checkMacroBreaks(f, at(end))).toMatchObject({ textOnly: 'macro-body' });
			expect(checkMacroBreaks(f, at(end, end + 1))).toMatchObject({ textOnly: 'macro-body' });
			if (eol.length === 2) expect(checkMacroBreaks(f, at(end + 1))).not.toBeNull();
			expect(checkMacroBreaks(f, at(end + eol.length))).toBeNull();
			expect(checkMacroBreaks(f, at(end - 2, end - 1))).toBeNull();
			const whole = { from: text.indexOf('macro'), to: end + eol.length };
			expect(checkMacroBreaks(f, op({ ...replaceSpan(f, whole, '') }))).toBeNull();
		});
	}
});

describe('shared declarations', () => {
	const files = {
		'plan.tjp':
			HEAD +
			'task g1 "G1"\ntask g2 "G2"\n' +
			'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
		't.tji': 'task t "T" {\n  effort 1d\n}\n',
	};

	it('refuses text read in several visits unless confirmed', () => {
		const s = setup(files);
		const f = s.file('t.tji');
		const o = insertStatement(f, stmt(f, 'task t'), 'note "n"', 'start') as EditOp;
		const r = checkOps(s.ctx, [o]);
		expect(r).toMatchObject({ reason: 'shared-declaration' });
		expect(r?.affects && [...r.affects].sort()).toEqual(['g1.t', 'g2.t']);
		expect(checkOps({ ...s.ctx, opts: { confirmShared: true } }, [o])).toBeNull();
		const main = s.file();
		const m = insertStatement(main, stmt(main, 'task g1'), 'note "n"', 'start') as EditOp;
		expect(checkOps(s.ctx, [m])).toBeNull();
	});
});

describe('values and text', () => {
	const s = setup(HEAD + 'task a "A" {\n  effort 5d\n}\n');
	const at = { file: 'plan.tjp', from: 40, to: 40 };

	it('parses and checks values against the project', () => {
		expect(validValue(s.ctx, 'effort', '3d', at)).toMatchObject({ kind: 'duration' });
		expect(validValue(s.ctx, 'effort', 'x', at)).toMatchObject({ reason: 'invalid-value' });
		expect(validValue(s.ctx, 'start', '2030-01-01', at)).toMatchObject({
			reason: 'invalid-value',
		});
		expect(validValue(s.ctx, 'complete', '120', at)).toMatchObject({ reason: 'invalid-value' });
		expect(() => validValue(s.ctx, 'chargeset', 'x', at)).toThrow();
	});

	it('refuses unsafe text', () => {
		expect(checkSafeText('Plan ${x}')).toMatchObject({ reason: 'unsafe-text' });
		expect(checkSafeText('$(HOME)')).not.toBeNull();
		expect(checkSafeText('a\nb')).not.toBeNull();
		expect(checkSafeText('Design "v2"')).toBeNull();
	});
});
