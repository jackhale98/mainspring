// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { insertStatement, removeStatement, replaceSpan } from './layout';
import { checkOps } from './refuse';
import {
	checkMacroAdjacency,
	checkMacroBreaks,
	keywordLedSafeCall,
	nextSignificant,
} from './refuse-macro';
import type { EditOp } from './types';
import { ops, setup, span, stmt } from './testing';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
const at = (op: EditOp, from: number, to = from, insert = 'y'): EditOp => ({
	...op,
	from,
	to,
	insert,
	element: { from, to },
});

describe('macro adjacency (H1)', () => {
	it('refuses a body before a macro call that supplies one', () => {
		const text = HEAD + 'macro b [{ length 1d }]\ntask a "A" ${b}\n';
		const s = setup(text);
		const f = s.file();
		const r = checkOps(s.ctx, ops(insertStatement(f, stmt(f, 'task a'), 'priority 600', 'end')));
		expect(r).toMatchObject({ reason: 'text-only', textOnly: 'macro-call' });
	});

	it('refuses text glued to a macro token, and insertion points before one', () => {
		const text = HEAD + 'macro m [x]\ntask a "A" {\n  note "n"\n  ${m}\n  effort 1d\n}\n';
		const s = setup(text);
		const f = s.file();
		const call = span(f, '${m}');
		const base = removeStatement(f, stmt(f, 'note'));
		expect(checkMacroAdjacency(s.ctx, f, at(base, call.to))).not.toBeNull();
		expect(checkMacroAdjacency(s.ctx, f, at(base, call.from))).not.toBeNull();
		// The line start before the call: the next significant token is the call.
		expect(checkMacroAdjacency(s.ctx, f, at(base, call.from - 2))).not.toBeNull();
		// Removing the statement before the call makes the call follow other text.
		expect(checkOps(s.ctx, [base])).toMatchObject({ reason: 'text-only' });
		expect(checkOps(s.ctx, [removeStatement(f, stmt(f, 'effort'))])).toBeNull();
		expect(nextSignificant(f, stmt(f, 'note').to)?.name).toBe('MacroCall');
	});

	it('refuses edits of a macro definition name', () => {
		const text = HEAD + 'macro m [x]\ntask a "A"\n';
		const s = setup(text);
		const f = s.file();
		const name = span(f, 'm [').from;
		const o = replaceSpan(f, { from: name, to: name + 1 }, 'n');
		expect(checkOps(s.ctx, [o])).toMatchObject({ reason: 'text-only', textOnly: 'macro-body' });
		expect(checkOps(s.ctx, [at(o, name + 1)])).not.toBeNull();
	});
});

describe('macro body line breaks', () => {
	for (const eol of ['\n', '\r\n', '\r']) {
		it(`never touches the break after ] (${JSON.stringify(eol)})`, () => {
			const text = `${HEAD}macro m [x]${eol}task a "A"${eol}`;
			const s = setup(text);
			const f = s.file();
			const end = text.indexOf(']') + 1;
			const base = replaceSpan(f, { from: 0, to: 0 }, 'y');
			expect(checkMacroBreaks(f, at(base, end))).toMatchObject({ textOnly: 'macro-body' });
			expect(checkMacroBreaks(f, at(base, end, end + 1))).toMatchObject({
				textOnly: 'macro-body',
			});
			if (eol.length === 2) expect(checkMacroBreaks(f, at(base, end + 1))).not.toBeNull();
			expect(checkMacroBreaks(f, at(base, end + eol.length))).toBeNull();
			expect(checkMacroBreaks(f, at(base, end - 2, end - 1))).toBeNull();
			const whole = at(base, text.indexOf('macro'), end + eol.length, '');
			expect(checkMacroBreaks(f, whole)).toBeNull();
		});
	}
});

describe('safe statement-level calls (L4)', () => {
	const plan = (body: string): string =>
		HEAD +
		'resource d2 "D2"\n' +
		`macro devs [${body}]\n` +
		'task a "A" {\n  effort 5d\n  ${devs}\n}\n';

	it('lets edits before a keyword-led safe call through', () => {
		const s = setup(plan('\n  allocate r\n  allocate d2\n'));
		const f = s.file();
		const call = span(f, '${devs}');
		const leaf = nextSignificant(f, call.from);
		expect(leaf && keywordLedSafeCall(s.ctx, f, leaf)).toBe(true);
		expect(checkOps(s.ctx, [removeStatement(f, stmt(f, 'effort'))])).toBeNull();
	});

	it('still refuses before an unsafe call', () => {
		const s = setup(plan('\n  task x "X"\n'));
		const f = s.file();
		const leaf = nextSignificant(f, span(f, '${devs}').from);
		expect(leaf && keywordLedSafeCall(s.ctx, f, leaf)).toBe(false);
	});

	it('still refuses before a call whose body continues the text before it', () => {
		const s = setup(plan(', d2'));
		const f = s.file();
		const leaf = nextSignificant(f, span(f, '${devs}').from);
		expect(leaf && keywordLedSafeCall(s.ctx, f, leaf)).toBe(false);
		expect(checkOps(s.ctx, [removeStatement(f, stmt(f, 'effort'))])).toMatchObject({
			reason: 'text-only',
		});
	});
});
