// SPDX-License-Identifier: GPL-2.0-or-later
// The term choice of the grammar's tokenizer (lexer.ts): mandatory arguments, keyword versus
// identifier, statement heads for macros, unknown identifiers and scenario prefixes.
import { describe, expect, it } from 'vitest';
import { KEYWORDS, keywordById } from '../syntax/keywords';
import { requiresArgument } from './lexer';
import { tjpGlobalParser } from './parser';

function leaves(text: string): string[] {
	const out: string[] = [];
	tjpGlobalParser.parse(text).iterate({
		enter(n) {
			if (!n.node.firstChild) out.push(`${n.name}:${text.slice(n.from, n.to)}`);
		},
	});
	return out;
}

function entry(id: string) {
	const e = keywordById(id);
	if (!e) throw new Error(`no keyword ${id}`);
	return e;
}

describe('requiresArgument', () => {
	it.each([
		['milestone', false],
		['limits.task', false],
		['scheduled', false],
		['task', true],
		['columns', true],
		['purge', true],
		['extend', true],
		['timingresolution', true],
		['effort', true],
	])('%s: %s', (id, want) => {
		expect(requiresArgument(entry(id))).toBe(want);
	});

	it('is decided for every keyword without throwing', () => {
		for (const k of KEYWORDS) expect(typeof requiresArgument(k)).toBe('boolean');
	});
});

describe('statement heads', () => {
	it('starts a statement with a macro call only when the current one cannot take it', () => {
		// `effort ${len}` takes it as the value; the next `${alloc}` is a statement of its own.
		expect(leaves('task t "T" { effort ${len} ${alloc} }')).toEqual([
			'Keyword:task',
			'Identifier:t',
			'String:"T"',
			'OpenBrace:{',
			'Keyword:effort',
			'MacroCall:${len}',
			'MacroCall:${alloc}',
			'CloseBrace:}',
		]);
		const tree = tjpGlobalParser.parse('task t "T" { effort ${len} ${alloc} }').toString();
		expect(tree).toContain(
			'EffortStatement(Keyword,WorkingDuration(MacroCall)),MacroCallStatement',
		);
	});

	it('keeps a scenario prefix with the keyword or extension attribute after it', () => {
		const tree = tjpGlobalParser.parse('task t "T" { delayed:effort 2d plan:Cost 1 }').toString();
		expect(tree).toContain('EffortStatement(ScenarioPrefix,Keyword');
		expect(tree).toContain('ExtensionStatement(ScenarioPrefix,AttributeName');
	});

	it('treats capitalised identifiers as extension attributes only in task and resource bodies', () => {
		expect(tjpGlobalParser.parse('task t "T" { Phone "1" }').toString()).toContain(
			'ExtensionStatement(AttributeName,String)',
		);
		expect(tjpGlobalParser.parse('Phone "1"').toString()).toContain('⚠');
	});

	it('reads units only in duration slots', () => {
		expect(leaves('task t "T" { effort 5 d }')).toContain('Unit:d');
		expect(leaves('task t "T" { booking r 2024-01-01 +4h }')).toContain('Identifier:h');
	});

	it('reads a `{` after `%` as a date expression that opens no keyword context', () => {
		const tree = tjpGlobalParser.parse('task t "T" { start %{2024-01-01 + 1d} }').toString();
		expect(tree).toContain(
			'StartStatement(Keyword,DateExpr(Percent,OpenBrace,Date,Plus,Integer,Unit,CloseBrace))',
		);
	});

	it('marks strings with macro calls or environment references as templated', () => {
		expect(leaves('task t "${a} b" { note "$(HOME)" }')).toEqual(
			expect.arrayContaining(['TemplateString:"${a} b"', 'TemplateString:"$(HOME)"']),
		);
	});
});
