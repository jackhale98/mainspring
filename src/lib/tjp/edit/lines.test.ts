// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	attachedStart,
	blankLineBefore,
	bodyIndent,
	breakLength,
	dominantBreak,
	lineBreakNear,
	lineEnd,
	lineIndent,
	lineStart,
	stringModeAfter,
	renderStatement,
	startsLine,
	statementNode,
	trailingEnd,
} from './lines';
import { setup, span, stmt } from './testing';

describe('lines as TaskJuggler reads them', () => {
	const t = 'a\r\n  b\rc\nd';

	it('breaks on \\n, \\r\\n and a lone \\r', () => {
		expect(lineStart(t, 5)).toBe(3);
		expect(lineEnd(t, 3)).toBe(6);
		expect(breakLength(t, 1)).toBe(2);
		expect(breakLength(t, 6)).toBe(1);
		expect(breakLength(t, 8)).toBe(1);
		expect(breakLength(t, t.length)).toBe(0);
		expect(lineStart(t, 7)).toBe(7);
		expect(lineIndent(t, 5)).toBe('  ');
		expect(startsLine(t, 5)).toBe(true);
		expect(startsLine(t, 6)).toBe(false);
	});

	it('finds the break to write', () => {
		expect(dominantBreak('a\r\nb\r\nc\n')).toBe('\r\n');
		expect(dominantBreak('a\rb\rc')).toBe('\r');
		expect(dominantBreak('abc')).toBe('\n');
		expect(lineBreakNear(t, 0)).toBe('\r\n');
		expect(lineBreakNear(t, 7)).toBe('\n');
		expect(lineBreakNear(t, t.length)).toBe('\n');
		expect(lineBreakNear('a\r\nb', 4)).toBe('\r\n');
	});

	it('tracks quotes across lines', () => {
		expect(stringModeAfter('note "a', null)).toBe('"');
		expect(stringModeAfter('b \\" c', '"')).toBe('"');
		expect(stringModeAfter('b"', '"')).toBeNull();
		expect(stringModeAfter("x # 'not a string", null)).toBeNull();
		expect(stringModeAfter("note 'it''", null)).toBe("'");
	});

	it('tracks cut-here strings as their own mode', () => {
		expect(stringModeAfter('note -8<-  ', null)).toBe('cut');
		expect(stringModeAfter("  it's a cut", 'cut')).toBe('cut');
		expect(stringModeAfter('  ->8-', 'cut')).toBeNull();
		expect(stringModeAfter('  ->8- # done "x', 'cut')).toBeNull();
		expect(stringModeAfter('  ->8- "open', 'cut')).toBe('"');
		expect(stringModeAfter('note -8<- x', null)).toBeNull();
	});

	it('leaves lines that start inside strings alone', () => {
		expect(renderStatement('note "a\n\tb"\n\tx 1', '  ', '    ', '\r\n')).toBe(
			'note "a\r\n\tb"\r\n      x 1',
		);
		const cut = "note -8<-\n\tit's cut\n\t->8-\n\tlength 1d";
		expect(renderStatement(cut, '  ', '  ', '\r\n')).toBe(
			"note -8<-\r\n    it's cut\r\n    ->8-\r\n    length 1d",
		);
	});

	it('renders statement text with the unit, indentation and break', () => {
		expect(renderStatement('task x "X" {\n\teffort 1d\n}', '  ', '    ', '\r\n')).toBe(
			'task x "X" {\r\n      effort 1d\r\n  }',
		);
	});
});

describe('nodes and comments', () => {
	const text = [
		'project p "P" 2026-01-05 +2m',
		'task a "A" {',
		'  effort 5d # trailing',
		'',
		'  # one',
		'  /* two */',
		'  task b "B" /* x */ task c "C"',
		'}',
		'',
	].join('\n');
	const s = setup(text);
	const f = s.file();

	it('finds statements by range', () => {
		const a = stmt(f, 'task a');
		expect(statementNode(f, a)?.name).toBe('TaskStatement');
		expect(statementNode(f, { from: a.from, to: a.to - 1 })).toBeNull();
	});

	it('reads trailing comments', () => {
		const e = stmt(f, 'effort');
		expect(trailingEnd(f, e.to)).toBe(text.indexOf('\n', e.to));
		expect(trailingEnd(f, stmt(f, 'task b').to)).toBeNull();
	});

	it('finds attached comment lines and blank-line separation', () => {
		const b = stmt(f, 'task b');
		expect(attachedStart(f, b)).toBe(text.indexOf('  # one'));
		expect(blankLineBefore(f, b)).toBe(true);
		expect(blankLineBefore(f, stmt(f, 'effort'))).toBe(false);
		expect(attachedStart(f, stmt(f, 'task c'))).toBe(span(f, 'task c').from);
	});

	it('reads body indentation', () => {
		const n = statementNode(f, stmt(f, 'task a'));
		expect(n && bodyIndent(f, n)).toBe('  ');
		const b = statementNode(f, stmt(f, 'task b'));
		expect(b && bodyIndent(f, b)).toBe('    ');
	});
});
