// SPDX-License-Identifier: GPL-2.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { changeSetOf, createFile, syntaxIssues, type TopContext } from './document';
import {
	DEFAULT_UNIT,
	analyzeLines,
	detectIndentUnit,
	formatFile,
	sameShape,
	type FormatOptions,
} from './format';

/** Formatted text; with a two-space unit unless `opts` says otherwise (`{}` detects it). */
function fmt(
	text: string,
	opts: FormatOptions = { unit: '  ' },
	top: TopContext = 'global',
): string {
	const file = createFile('p.tjp', text, top);
	const r = formatFile(file, opts);
	if (r.status !== 'format') throw new Error(`refused: ${r.reason}`);
	return changeSetOf([...r.changes], file.text.length)
		.apply(file.text)
		.toString();
}

/** Lines joined with '\n', for readable expectations. */
const L = (...lines: string[]): string => lines.join('\n');

describe('indentation by depth (7.3)', () => {
	it('indents statements by body depth and braces one level less', () => {
		const text = L(
			'project p "P" 2026-01-05 +1m {',
			'now 2026-01-05',
			'      }',
			'task a "A" {',
			'        task b "B" {',
			'effort 1d',
			'    }',
			'}',
			'',
		);
		expect(fmt(text)).toBe(
			L(
				'project p "P" 2026-01-05 +1m {',
				'  now 2026-01-05',
				'}',
				'task a "A" {',
				'  task b "B" {',
				'    effort 1d',
				'  }',
				'}',
				'',
			),
		);
	});

	it('puts a body brace on its own line at the header level', () => {
		expect(fmt(L('task a "A"', '   {', 'effort 1d', '     }', ''))).toBe(
			L('task a "A"', '{', '  effort 1d', '}', ''),
		);
	});

	it('indents comments between statements like statements', () => {
		expect(fmt(L('task a "A" {', '# one', '      // two', 'effort 1d', '}', ''))).toBe(
			L('task a "A" {', '  # one', '  // two', '  effort 1d', '}', ''),
		);
	});

	it('counts the bodies of dependency items but not the braces of %{ }', () => {
		const text = L(
			'task a "A" {',
			'depends b {',
			'gapduration 1d',
			'}',
			'start %{ 2026-01-05 +',
			'     1d }',
			'}',
			'',
		);
		expect(fmt(text)).toBe(
			L(
				'task a "A" {',
				'  depends b {',
				'    gapduration 1d',
				'  }',
				'  start %{ 2026-01-05 +',
				'       1d }',
				'}',
				'',
			),
		);
	});

	it('leaves one-line blocks and spacing between tokens alone', () => {
		const text = L('task a "A" { effort   1d  allocate r }', '');
		expect(fmt(text)).toBe(text);
	});
});

describe('continuation lines', () => {
	it('keep their offset from the statement first line', () => {
		const text = L('task a "A" {', '      allocate r1,', '               r2', '}', '');
		expect(fmt(text)).toBe(L('task a "A" {', '  allocate r1,', '           r2', '}', ''));
	});

	it('align by columns, written as spaces, when indentations are not prefixes', () => {
		const text = L('task a "A" {', '\tallocate r1,', '            r2', '}', '');
		expect(fmt(text, { unit: '  ' })).toBe(
			L('task a "A" {', '  allocate r1,', '      r2', '}', ''),
		);
	});

	it('keep the layout of a body opened on a continuation line', () => {
		const text = L(
			'taskreport r "" {',
			'      columns name,',
			'              journal { celltext 1 ""',
			'                        width 70 }',
			'}',
			'',
		);
		expect(fmt(text)).toBe(
			L(
				'taskreport r "" {',
				'  columns name,',
				'          journal { celltext 1 ""',
				'                    width 70 }',
				'}',
				'',
			),
		);
	});
});

describe('what format never touches', () => {
	it('keeps the inner lines of strings and their trailing blanks', () => {
		const text = L('task a "A" {', 'note "one  ', '      two', '  three"', '}', '');
		expect(fmt(text)).toBe(L('task a "A" {', '  note "one  ', '      two', '  three"', '}', ''));
	});

	it('keeps cut-here strings, including blanks after the mark', () => {
		const text = L(
			'task a "A" {',
			'    note -8<-   ',
			'      first',
			'    second',
			'  ->8-',
			'}',
			'',
		);
		expect(fmt(text)).toBe(
			L('task a "A" {', '  note -8<-   ', '      first', '    second', '  ->8-', '}', ''),
		);
	});

	it('keeps block comment inner lines but indents their first line', () => {
		const text = L('task a "A" {', '/* one', '      two */', '}', '');
		expect(fmt(text)).toBe(L('task a "A" {', '  /* one', '      two */', '}', ''));
	});

	it('keeps macro bodies and the line feed after their ]', () => {
		const text = L(
			'macro m [',
			'      task x "X" {  ',
			'  }',
			']',
			'task a "A" {',
			'${m}',
			'}',
			'',
		);
		expect(fmt(text)).toBe(
			L('macro m [', '      task x "X" {  ', '  }', ']', 'task a "A" {', '  ${m}', '}', ''),
		);
	});

	it('keeps multi-line macro-related text-only ranges as written', () => {
		const ids = L(
			'task ${id} "X" {',
			'      effort 1d   ',
			'}',
			'task b "B" {',
			'effort 1d',
			'}',
			'',
		);
		expect(fmt(ids)).toBe(
			L('task ${id} "X" {', '      effort 1d   ', '}', 'task b "B" {', '  effort 1d', '}', ''),
		);
		const call = L('task a "A" {', '    allocate ${r},', '        r2', '}', '');
		expect(fmt(call)).toBe(call);
	});

	it('keeps CRLF line endings and strips blanks before the \\r', () => {
		const text = 'task a "A" {\r\n      effort 1d  \r\n   \r\n}\r\n';
		expect(fmt(text)).toBe('task a "A" {\r\n  effort 1d\r\n\r\n}\r\n');
	});

	it('keeps blank lines, the final newline and a missing final newline', () => {
		expect(fmt(L('task a "A" {', '', '', 'effort 1d', '}'))).toBe(
			L('task a "A" {', '', '', '  effort 1d', '}'),
		);
	});

	it('strips trailing blanks after comments and statements', () => {
		expect(fmt(L('task a "A" { \t', '  effort 1d # x  ', '}  ', ''))).toBe(
			L('task a "A" {', '  effort 1d # x', '}', ''),
		);
	});

	it('keeps a leading BOM and lines with other whitespace', () => {
		const text = '﻿project p "P" 2026-01-05 +1m {\n\f now 2026-01-05\n}\n';
		expect(fmt(text)).toBe(text);
	});
});

describe('indent unit (7.2)', () => {
	it('detects tabs, N spaces, and defaults to two spaces', () => {
		const unit = (t: string): string => detectIndentUnit(createFile('p.tjp', t));
		expect(unit('task a "A" {\n\teffort 1d\n}\n')).toBe('\t');
		expect(unit('task a "A" {\n    task b "B" {\n        effort 1d\n    }\n}\n')).toBe('    ');
		expect(unit('task a "A" { effort 1d }\n')).toBe(DEFAULT_UNIT);
		expect(unit('task a "A" {\n   effort 1d\n}\ntask b "B" {\n  effort 1d\n}\n')).toBe('   ');
	});

	it('formats with the detected unit, or the one given', () => {
		const text = L('task a "A" {', '\ttask b "B" {', 'effort 1d', '}', '}', '');
		expect(fmt(text, {})).toBe(
			L('task a "A" {', '\ttask b "B" {', '\t\teffort 1d', '\t}', '}', ''),
		);
		expect(fmt(text, { unit: '   ' })).toBe(
			L('task a "A" {', '   task b "B" {', '      effort 1d', '   }', '}', ''),
		);
	});
});

describe('formatFile', () => {
	it('refuses files with syntax errors', () => {
		const r = formatFile(createFile('p.tjp', 'task a "A" {\n  effort 1d\n  bogus\n}\n'));
		expect(r.status).toBe('refused');
		if (r.status === 'refused') {
			expect(r.reason).toBe('syntax-error');
			expect(r.at.length).toBeGreaterThan(0);
			expect(r.at[0]?.file).toBe('p.tjp');
		}
	});

	it('returns minimal, ordered changes in leading and trailing blanks only', () => {
		const two = L('task b "B" {', '  effort 1d', '}');
		const text = L('task a "A" {', '      effort 1d  ', '  }', two, two, '');
		const r = formatFile(createFile('p.tjp', text));
		expect(r.status).toBe('format');
		if (r.status !== 'format') return;
		expect(r.unit).toBe(DEFAULT_UNIT);
		expect(r.changes).toEqual([
			{ from: 15, to: 19, insert: '' },
			{ from: 28, to: 30, insert: '' },
			{ from: 31, to: 33, insert: '' },
		]);
	});

	it('formats only the lines in a range', () => {
		const text = L('task a "A" {', 'effort 1d', 'allocate r', '}', '');
		const at = text.indexOf('allocate');
		expect(fmt(text, { from: at, to: at, unit: '  ' })).toBe(
			L('task a "A" {', 'effort 1d', '  allocate r', '}', ''),
		);
	});

	it('uses the include site context', () => {
		const text = L('timezone "UTC"', '   now 2026-01-05', '');
		expect(fmt(text, { unit: '  ' }, 'project')).toBe(L('timezone "UTC"', 'now 2026-01-05', ''));
	});

	it('refuses with the new error ranges if the result would not parse', () => {
		// With the 24-unit line-start limit of grammar/chars.ts, re-indenting `xyz` made it an
		// unknown word starting a line (an error). Either the result parses cleanly, or format
		// refuses and points at that line in the file as it is.
		const deep = `${' '.repeat(26)}xyz`;
		const text = L('taskreport r "" {', '      columns name', deep, '}', '');
		const file = createFile('p.tjp', text);
		expect(analyzeLines(file)[2]?.kind).toBe('continuation');
		const r = formatFile(file, { unit: '  ' });
		if (r.status === 'format') {
			const next = changeSetOf([...r.changes], file.text.length).apply(file.text);
			expect(syntaxIssues(createFile('q.tjp', next).tree, next)).toEqual([]);
		} else {
			expect(r.reason).toBe('syntax-error');
			const line = text.indexOf(deep);
			for (const at of r.at) {
				expect(at.from).toBeGreaterThanOrEqual(line);
				expect(at.to).toBeLessThanOrEqual(line + deep.length + 1);
			}
		}
	});

	it('rejects an indent unit that is not a tab or spaces', () => {
		const file = createFile('p.tjp', L('task a "A" {', 'effort 1d', '}', ''));
		for (const unit of ['', '\t\t', ' \t', 'x']) {
			expect(() => formatFile(file, { unit })).toThrow(RangeError);
		}
		expect(fmt(L('task a "A" {', 'effort 1d', '}', ''), { unit: '\t' })).toBe(
			L('task a "A" {', '\teffort 1d', '}', ''),
		);
	});

	it('pulls a continuation group into a range that covers part of it', () => {
		const text = L(
			'task a "A" {',
			'      allocate r1,',
			'               r2,',
			'               r3',
			'}',
			'',
		);
		const at = text.indexOf('r3');
		expect(fmt(text, { from: at, to: at, unit: '  ' })).toBe(
			L('task a "A" {', '  allocate r1,', '           r2,', '           r3', '}', ''),
		);
	});

	it('returns no changes for a formatted file', () => {
		const r = formatFile(createFile('p.tjp', L('task a "A" {', '  effort 1d', '}', '')));
		expect(r).toEqual({ status: 'format', changes: [], unit: DEFAULT_UNIT });
	});

	it('classifies lines', () => {
		const file = createFile(
			'p.tjp',
			L('task a "A" {', '  allocate r1,', '    r2', '', '  note "x', 'y"', '}'),
		);
		expect(analyzeLines(file).map((i) => i.kind)).toEqual([
			'absolute',
			'absolute',
			'continuation',
			'blank',
			'absolute',
			'kept',
			'absolute',
		]);
		expect(analyzeLines(file)[2]?.anchor).toBe(2);
	});
});

describe('format properties', () => {
	const blanks = fc.constantFrom('', ' ', '  ', '\t', '    ', ' \t ');
	/** A small nested plan with random indentation and trailing blanks. */
	const plan = fc
		.array(fc.tuple(fc.constantFrom('open', 'close', 'attr', 'comment', 'blank'), blanks, blanks), {
			maxLength: 30,
		})
		.map((ops) => {
			const out: string[] = [];
			let depth = 0;
			let n = 0;
			for (const [op, lead, tail] of ops) {
				if (op === 'open') {
					out.push(`${lead}task t${n++} "T" {${tail}`);
					depth++;
				} else if (op === 'close' && depth > 0) {
					out.push(`${lead}}${tail}`);
					depth--;
				} else if (op === 'attr' && depth > 0) out.push(`${lead}effort 1d${tail}`);
				else if (op === 'comment') out.push(`${lead}# c${tail}`);
				else if (op === 'blank') out.push(lead);
			}
			while (depth-- > 0) out.push('}');
			return `${out.join('\n')}\n`;
		});

	it('is idempotent, keeps the tree shape and changes only blanks', () => {
		fc.assert(
			fc.property(plan, (text) => {
				const once = fmt(text, {});
				expect(fmt(once, {})).toBe(once);
				expect(sameShape(createFile('a', text).tree, createFile('b', once).tree)).toBe(true);
				const core = (t: string): string[] => t.split('\n').map((l) => l.trim());
				expect(core(once)).toEqual(core(text));
			}),
			{ numRuns: 300 },
		);
	});
});
