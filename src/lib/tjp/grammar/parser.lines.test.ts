// SPDX-License-Identifier: GPL-2.0-or-later
// Words on the next line after a statement (phase-1.md 5.2): which continue it and which are
// errors, at any indentation and with `\n`, `\r\n` or lone `\r` line breaks.
import { describe, expect, it } from 'vitest';
import { errorNodes } from '../../../../tests/grammar/corpus';
import { tjpGlobalParser } from './parser';

/**
 * Misspelt attributes and next-line arguments at any indentation (T12 review probes, checked with
 * native tj3). `body` goes seven tasks deep; `{INDENT}` marks where the indentation goes.
 */
describe('next-line words', () => {
	const INDENTS: [string, string][] = [
		['no indentation', ''],
		['24 blanks', ' '.repeat(24)],
		['40 blanks', ' '.repeat(40)],
		['tabs', '\t\t\t'],
	];
	const HEAD =
		'project p "P" 2026-01-05 +2m {\n}\naccount cost "Cost"\naccount rev "Revenue"\n' +
		'resource r1 "R1"\nresource r2 "R2"\n';
	const deep = (body: string): string => {
		let s = body;
		for (let i = 0; i < 7; i++) s = `task t${i} "T${i}" {\n${s}\n}`;
		return HEAD + s + '\n';
	};
	const plan = (template: string, indent: string): string => template.replace('{INDENT}', indent);
	const lineOf = (text: string, word: string): number =>
		text.slice(0, text.indexOf(word)).split('\n').length;

	// Valid TaskJuggler: the next line continues the statement.
	const VALID: [string, string][] = [
		[
			'a second balance account',
			HEAD +
				'task t "T" {\n  effort 1d\n  allocate r1\n}\n' +
				'accountreport ar "" {\n  balance cost\n{INDENT}rev\n}\n',
		],
		['a charge mode', deep('effort 1d\nallocate r1\nchargeset cost\ncharge 100\n{INDENT}onstart')],
		['an allocation after a comma', deep('effort 1d\nallocate r1,\n{INDENT}r2\nnote "x"')],
	];

	// TaskJuggler rejects the word: the statement before it can take no more arguments.
	const MISSPELT: [string, string][] = [
		['after a typed statement', deep('effort 1d\n{INDENT}bogusword')],
		['after an allocation', deep('effort 1d\nallocate r1\n{INDENT}bogusword')],
		['after a keyword without arguments', deep('effort 1d\nscheduled\n{INDENT}bogusword')],
		['after a body', deep('effort 1d\nlimits { dailymax 4h }\n{INDENT}bogusword')],
		[
			'after a list of choices',
			HEAD +
				'task t "T" {\n  effort 1d\n}\ntaskreport a "" {\n  taskreport b "" {\n' +
				'    formats html\n{INDENT}bogusword\n  }\n}\n',
		],
	];

	describe.each(INDENTS)('indented with %s', (_what, indent) => {
		it.each(VALID)('accepts %s', (_case, template) => {
			const text = plan(template, indent);
			expect(errorNodes(tjpGlobalParser.parse(text), text)).toEqual([]);
		});

		it.each(MISSPELT)('rejects a misspelt word %s', (_case, template) => {
			const text = plan(template, indent);
			const errors = errorNodes(tjpGlobalParser.parse(text), text);
			expect(errors[0]?.line).toBe(lineOf(text, 'bogusword'));
		});

		it('misses a typo after an opaque statement with open-ended arguments', () => {
			// Accepted false negative: `chargeset cost` could go on (`chargeset cost 50%`), and the
			// syntax line does not say what may follow, so the word is read as an argument. The
			// engine reports it (native: "Unexpected token 'bogusword'").
			const text = plan(deep('effort 1d\nchargeset cost\n{INDENT}bogusword'), indent);
			expect(errorNodes(tjpGlobalParser.parse(text), text)).toEqual([]);
		});
	});

	// TaskJuggler reads `\r\n` and a lone `\r` as line breaks too. Nothing above depends on where
	// lines break, so the results are the same with either.
	describe.each([
		['\\r\\n', '\r\n'],
		['a lone \\r', '\r'],
	])('with %s line breaks', (_what, eol) => {
		const withBreaks = (template: string): string => plan(template, '  ').replace(/\n/g, eol);

		it.each(VALID)('accepts %s', (_case, template) => {
			const text = withBreaks(template);
			expect(errorNodes(tjpGlobalParser.parse(text), text)).toEqual([]);
		});

		it.each(MISSPELT)('rejects a misspelt word %s, at the word', (_case, template) => {
			const text = withBreaks(template);
			const at = text.indexOf('bogusword');
			const first = errorNodes(tjpGlobalParser.parse(text), text)[0];
			expect(first && first.from >= at - 2 && first.from <= at + 'bogusword'.length).toBe(true);
		});
	});
});
