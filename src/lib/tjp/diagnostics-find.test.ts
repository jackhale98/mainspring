// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createFile } from './document';
import { headerOf, LineSearch, ownAttributes, pickForScenario, sameRef } from './diagnostics-find';
import { engineLine } from './diagnostics-lines';

const TEXT =
	'macro m [ x ]\ntask a "A" {\n  effort 2d\n  s2:effort 3d\n  task b "B" { effort 1d }\n  note "colour" colour\n}\nmacro m [ y ]\n';
const file = createFile('plan.tjp', TEXT);
const at = (n: number) => new LineSearch(file, engineLine(file.text, n));
const slice = (s: { from: number; to: number } | null) => s && TEXT.slice(s.from, s.to);

describe('LineSearch', () => {
	it('finds a token, string contents included, preferring one after an error on the line', () => {
		expect(slice(at(3).token('2d'))).toBeNull();
		expect(slice(at(3).token('effort'))).toBe('effort');
		const hit = at(6).token('colour');
		expect(hit && hit.from).toBe(TEXT.lastIndexOf('colour'));
		expect(at(6).token('note')?.from).toBe(TEXT.indexOf('note'));
		const str = new LineSearch(file, engineLine(file.text, 6)).leaves.find(
			(l) => l.name === 'String',
		);
		expect(str && slice(str)).toBe('"colour"');
	});

	it('finds declarations by their local id and builds headers', () => {
		const d = at(2).decl('task', 'x.a');
		expect(d && slice(headerOf(d))).toBe('task a "A"');
		expect(at(5).decl('task', null)?.name).toBe('TaskStatement');
		expect(at(3).decl('task', 'a')).toBeNull();
		const own = d ? ownAttributes(d).map((s) => slice(s)) : [];
		expect(own).toEqual(['effort 2d', 's2:effort 3d', 'note "colour"']);
	});

	it('finds the statement just read at a line, and macro definitions', () => {
		expect(slice(at(4).reportedStatement(['EFFORT']))).toBe('s2:effort 3d');
		expect(slice(at(5).reportedStatement(['effort']))).toBe('effort 1d');
		// A statement ending on an earlier line is not the one just read.
		expect(at(7).reportedStatement(['effort'])).toBeNull();
		expect(slice(at(9).macroBefore('m'))).toBe('m');
		expect(at(9).macroBefore('m')?.from).toBe(TEXT.lastIndexOf('m ['));
	});

	it('cuts a span to the line and trims it', () => {
		const line = engineLine(file.text, 3);
		expect(slice(at(3).onLine({ from: 0, to: TEXT.length }))).toBe(
			TEXT.slice(line.from, line.to).trim(),
		);
	});
});

describe('reportedStatement', () => {
	const REPORT =
		'taskreport r "r" {\n  hidetask a | b\n  hidetask b\n\n  title "T"\n}\ntask x "X" { start 2026-01-01 start 2026-01-02 }\n';
	const f = createFile('plan.tjp', REPORT);
	const on = (n: number, kws: string[]) => {
		const s = new LineSearch(f, engineLine(f.text, n)).reportedStatement(kws);
		return s && REPORT.slice(s.from, s.to);
	};

	it('takes a logical expression whose next token is on the line', () => {
		expect(on(3, ['hidetask'])).toBe('hidetask a | b');
		expect(on(5, ['hidetask'])).toBe('hidetask b');
		expect(on(4, ['hidetask'])).toBeNull();
	});

	it('takes the last statement ending on the line for other values', () => {
		expect(on(5, ['title'])).toBe('title "T"');
		expect(on(7, ['start'])).toBe('start 2026-01-02');
		expect(on(6, ['title'])).toBeNull();
	});
});

describe('helpers', () => {
	it('picks the scenario statement TaskJuggler keeps', () => {
		const items: Array<[string, string | null]> = [
			['a', null],
			['b', 's2'],
			['c', null],
		];
		const pick = (s: string | null) => pickForScenario(items, (i) => i[1], s)?.[0];
		expect([pick('s2'), pick('plan'), pick(null)]).toEqual(['b', 'c', 'c']);
		expect(pickForScenario([['x', 's1']] as const, (i) => i[1], null)?.[0]).toBe('x');
	});

	it('compares written references with resolved ids', () => {
		expect(sameRef('!x', 'a.x')).toBe(true);
		expect(sameRef('a.x', 'a.x')).toBe(true);
		expect(sameRef('x', 'y')).toBe(false);
		expect(sameRef('!!x', 'x')).toBe(true);
	});
});
