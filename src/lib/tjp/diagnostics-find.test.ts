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

	it('finds statements by keyword on the line or before it, and macro definitions', () => {
		expect(slice(at(4).statementBefore(['EFFORT']))).toBe('s2:effort 3d');
		expect(slice(at(7).statementBefore(['effort']))).toBe('effort 1d');
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
