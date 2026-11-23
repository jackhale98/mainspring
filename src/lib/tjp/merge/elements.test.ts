// SPDX-License-Identifier: GPL-2.0-or-later
// Elements of a span (elements.ts): statements with their leading comments, the head after `{`,
// the end, statements sharing a line; and the cover of a range.
import type { SyntaxNode } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import { parseTjp } from '../document';
import { cover, elementsOf, type Element } from './elements';

const show = (t: string, els: readonly Element[]): Array<[string, string, string | null]> =>
	els.map((e) => [e.kind, t.slice(e.from, e.to), e.key]);

describe('elementsOf', () => {
	it('cuts a file into statements with their leading comments, and the end', () => {
		const t = '# head\nproject p "P" 2027-01-01 +1m\n\n# people\nresource r "R"\n# tail\n';
		const tree = parseTjp(t);
		const els = elementsOf(t, tree.topNode, 0, t.length);
		expect(show(t, els)).toEqual([
			['stmt', '# head\nproject p "P" 2027-01-01 +1m\n', 'project'],
			['stmt', '\n# people\nresource r "R"\n', 'resource:r'],
			['end', '# tail\n', null],
		]);
		expect(els[1]?.lead).toBe(t.indexOf('resource'));
	});

	it('gives a body its head line and its end before the brace, and joins statements on a line', () => {
		const t = 'task a "A" { # note\n  effort 1d allocate r\n  depends b\n  }\n';
		const tree = parseTjp(t);
		const body = tree.topNode.firstChild?.getChild('Body') as SyntaxNode;
		const from = (body.firstChild as SyntaxNode).to;
		const to = (body.lastChild as SyntaxNode).from;
		expect(show(t, elementsOf(t, body, from, to))).toEqual([
			['head', ' # note\n', null],
			['stmt', '  effort 1d allocate r\n', 'effort+allocate'],
			['stmt', '  depends b\n', 'depends'],
			['end', '  ', null],
		]);
	});

	it('keeps a one-line body as one element', () => {
		const t = 'task a "A" { effort 1d }\n';
		const body = parseTjp(t).topNode.firstChild?.getChild('Body') as SyntaxNode;
		const from = (body.firstChild as SyntaxNode).to;
		const to = (body.lastChild as SyntaxNode).from;
		expect(show(t, elementsOf(t, body, from, to))).toEqual([
			['stmt', ' effort 1d ', 'effort'],
			['end', '', null],
		]);
	});
});

describe('cover', () => {
	const t = 'task a "A"\ntask b "B" {\n  effort 1d\n}\ntask c "C"\n';
	const els = elementsOf(t, parseTjp(t).topNode, 0, t.length);
	const b = t.indexOf('task b');
	const c = t.indexOf('task c');
	it('widens a range to whole elements', () => {
		expect(cover(els, t.indexOf('effort'), t.indexOf('effort') + 2)).toEqual([b, c]);
		expect(cover(els, b, c)).toEqual([b, c]);
	});
	it('widens an empty range only when it falls inside an element', () => {
		expect(cover(els, b, b)).toEqual([b, b]);
		expect(cover(els, b + 3, b + 3)).toEqual([b, c]);
	});
});
