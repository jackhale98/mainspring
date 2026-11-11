// SPDX-License-Identifier: GPL-2.0-or-later
// The Lezer external tokenizer, driven by a small test grammar: it must produce exactly the
// tokens of tokenizeTjp, also after an incremental reparse.
import { TreeFragment, type Tree } from '@lezer/common';
import fc from 'fast-check';
import { buildParser } from '@lezer/generator';
import type { LRParser } from '@lezer/lr';
import { describe, expect, it } from 'vitest';
import { tjpExternalTokenizer, tokenizeTjp, type TjpTokenKind } from './tokens';

const GRAMMAR = `
@top File { (Keyword | Identifier | String | Macro | Other)* }
@skip { space | Comment }
@external tokens tjp from "./tokens" { space, Comment, Keyword, Identifier, String, Macro, Other }
`;

/** Each test term and the kinds it stands for. */
const TERM_OF: Partial<Record<TjpTokenKind, string>> = {
	Whitespace: 'space',
	LineComment: 'Comment',
	BlockComment: 'Comment',
	Bom: 'Comment',
	Identifier: 'Identifier',
	String: 'String',
	MacroCall: 'Macro',
	MacroWord: 'Macro',
};

function testParser(): LRParser {
	return buildParser(GRAMMAR, {
		externalTokenizer: (_name, terms) =>
			tjpExternalTokenizer((token, text) => {
				if (token.kind === 'Identifier' && text() === 'task') return terms['Keyword'] ?? -1;
				return terms[TERM_OF[token.kind] ?? 'Other'] ?? -1;
			}),
	});
}

/** Leaf nodes as `Name:from-to`, skipping whitespace (which the tree does not record). */
function leaves(tree: Tree): string[] {
	const out: string[] = [];
	tree.iterate({
		enter(node) {
			if (node.type.isTop) return;
			out.push(`${node.name}:${node.from}-${node.to}`);
		},
	});
	return out;
}

/** The leaves the test grammar should produce, computed with tokenizeTjp. */
function expected(text: string): string[] {
	return tokenizeTjp(text)
		.filter((t) => t.kind !== 'Whitespace')
		.map((t) => {
			const name =
				t.kind === 'Identifier' && text.slice(t.from, t.to) === 'task'
					? 'Keyword'
					: (TERM_OF[t.kind] ?? 'Other');
			return `${name}:${t.from}-${t.to}`;
		});
}

const SAMPLE = [
	'\ufeffproject p "P" 2024-01-01 +1m // c',
	'macro m [',
	'  effort 1d',
	']',
	'task t "${m} x" { ${m} t${n}2 note -8<-',
	'  # not a comment',
	'  ->8- /* a */ b */',
	'  depends !a.b, c:d 10:30 .5',
	'}',
	'',
].join('\n');

describe('tjpExternalTokenizer', () => {
	const parser = testParser();

	it('produces the same tokens as tokenizeTjp, with no error nodes', () => {
		const tree = parser.parse(SAMPLE);
		expect(tree.length).toBe(SAMPLE.length);
		expect(leaves(tree)).toEqual(expected(SAMPLE));
		expect(leaves(tree).some((l) => l.startsWith('⚠'))).toBe(false);
	});

	it('lets the grammar choose terms from the token text', () => {
		expect(leaves(parser.parse('task task1'))).toEqual(['Keyword:0-4', 'Identifier:5-10']);
	});

	it('covers an unterminated string with one token to the end', () => {
		const text = 'a "b\nc d\n';
		expect(leaves(parser.parse(text))).toEqual(['Identifier:0-1', `Other:2-${text.length}`]);
	});

	it('gives the same tree after an incremental reparse as after a fresh parse', () => {
		const edits: [number, number, string][] = [
			[SAMPLE.indexOf('x"'), SAMPLE.indexOf('x"') + 1, '"'], // closes the string early
			[SAMPLE.indexOf(']'), SAMPLE.indexOf(']') + 1, '] x'], // moves the macro body end
			[SAMPLE.indexOf('->8-'), SAMPLE.indexOf('->8-'), 'z '], // the cut mark no longer closes
			[SAMPLE.indexOf('/* a'), SAMPLE.indexOf('/* a') + 1, ''], // breaks the comment
		];
		// Copies after the edited one give Lezer fragments to reuse.
		const doc = SAMPLE + SAMPLE.slice(1).repeat(40);
		for (const [from, to, insert] of edits) {
			const tree = parser.parse(doc);
			const next = doc.slice(0, from) + insert + doc.slice(to);
			const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
				{ fromA: from, toA: to, fromB: from, toB: from + insert.length },
			]);
			const reparsed = parser.parse(next, fragments);
			expect(leaves(reparsed)).toEqual(leaves(parser.parse(next)));
			expect(leaves(reparsed)).toEqual(expected(next));
		}
	});

	it('reads the stream exactly as tokenizeTjp reads the string, on random token soup', () => {
		const pieces = [
			'"',
			"'",
			'\\',
			'\n',
			'\r\n',
			' ',
			'#',
			'//',
			'/*',
			'*/',
			'[',
			']\n',
			'-8<-\n',
			'  ->8-',
			'${x}',
			'$(A)',
			'a',
			'task',
			'1',
			'.5',
			'\ufeff',
			'😀',
			'\ud800',
		];
		fc.assert(
			fc.property(fc.array(fc.constantFrom(...pieces), { maxLength: 50 }), (parts) => {
				const text = parts.join('');
				expect(leaves(parser.parse(text))).toEqual(expected(text));
			}),
			{ numRuns: 200 },
		);
	});
});
