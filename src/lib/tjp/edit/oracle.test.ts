// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { changeSetOf, parseTjp, textOf } from '../document';
import { statementsIn } from '../tree';
import { inOrder, lineRegion, listItems, oracleRank, touchedMacro } from './oracle';

describe('edit test oracles', () => {
	it('computes line regions with every break style', () => {
		expect(lineRegion('a\r\nbc\rd', 3, 4)).toEqual({ from: 3, to: 6 });
		expect(lineRegion('a\nb', 2, 3)).toEqual({ from: 2, to: 3 });
	});

	it('ranks and orders statements as 7.2', () => {
		const text = 'task a "A" {\n  note "n"\n  effort 1d\n  allocate r\n}\n';
		const tree = parseTjp(text);
		const body = tree.topNode.firstChild?.getChild('Body');
		const stmts = body ? statementsIn(body) : [];
		expect(stmts.map((s) => oracleRank('task', s, text))).toEqual([0, 10, 13]);
		const [note, effort, alloc] = stmts;
		expect(effort && inOrder('task', effort, stmts, text)).toBe(true);
		expect(
			note &&
				inOrder(
					'task',
					note,
					[effort, note, alloc].filter((x) => !!x),
					text,
				),
		).toBe(false);
	});

	it('reads list items back', () => {
		const text = 'task a "A" {\n  depends b, c { gaplength 1d }\n}\n';
		expect(listItems(parseTjp(text), text, text.indexOf('depends'))).toEqual([
			'b',
			'c { gaplength 1d }',
		]);
	});

	it('finds changes that touch macro nodes', () => {
		const text = 'macro m [x]\ntask a "A" {\n  ${m}\n}\n';
		const tree = parseTjp(text);
		const glue = text.indexOf('${m}') + 4;
		const cs = changeSetOf({ from: glue, insert: 'y' }, text.length);
		expect(touchedMacro(tree, text, parseTjp(cs.apply(textOf(text)).toString()), cs)).toMatch(
			/MacroCall/,
		);
		const brk = text.indexOf(']') + 1;
		const cs2 = changeSetOf({ from: brk, insert: ' ' }, text.length);
		expect(touchedMacro(tree, text, tree, cs2)).not.toBeNull();
		const safe = changeSetOf({ from: text.length, insert: '# end\n' }, text.length);
		expect(touchedMacro(tree, text, tree, safe)).toBeNull();
	});
});
