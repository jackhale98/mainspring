// SPDX-License-Identifier: GPL-2.0-or-later
// Property tests for the TJP parser (phase-1.md 5.5, 6.1): after random edits to corpus files,
// an incremental reparse gives exactly the tree of a fresh parse, parsing never throws, and the
// leaves still print the edited text.
import { TreeFragment, type Tree } from '@lezer/common';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CORPORA, printLeaves, readTjp, serialize } from '../../../../tests/grammar/corpus';
import type { TopContextName } from '../syntax/keywords';
import { reparse } from './fragments';
import { tjpParser } from './parser';

const FILES = CORPORA.flatMap((c) => c.files);
const TEXTS = new Map(FILES.map((f) => [f, readTjp(f)]));

/** Pieces of TJP that change token boundaries, contexts and statement structure. */
const SNIPPETS = [
	'{',
	'}',
	'"',
	"'",
	'[',
	']',
	'(',
	')',
	'\n',
	'\r\n',
	' ',
	'\t',
	'#',
	'//',
	'/*',
	'*/',
	'-8<-\n',
	'\n->8-',
	',',
	'!',
	'%{',
	'${m}',
	'${m "a"}',
	'x${m}',
	'$(HOME)',
	'task t "T" {',
	'resource r "R" {',
	'effort 1d',
	'effort 5 d',
	'depends !a, b { gaplength 2d }',
	'allocate r1, r2',
	'delayed:',
	'Phone "x"',
	'extend task {',
	'supplement task t {',
	'project p "P" 2024-01-01 +1m {',
	'2024-01-01',
	'9:00 - 12:00',
	'workinghours mon - fri',
	'leaves annual 2024-07-01 +1w',
	'macro m [ x ]\n',
	'include "a.tji"',
	'columns start, end',
	'é',
	'﻿',
	'@',
	'start',
	'end',
	'task',
];

interface Edit {
	/** Where, as a fraction of the current length. */
	at: number;
	/** Code units to delete. */
	del: number;
	insert: string;
}

const editArb: fc.Arbitrary<Edit> = fc.record({
	at: fc.double({ min: 0, max: 1, noNaN: true }),
	del: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 4 }), fc.integer({ min: 5, max: 60 })),
	insert: fc.oneof(
		fc.constant(''),
		fc.constantFrom(...SNIPPETS),
		fc.array(fc.constantFrom(...SNIPPETS), { minLength: 1, maxLength: 4 }).map((a) => a.join('')),
		fc.string({ maxLength: 6 }),
	),
});

const topArb: fc.Arbitrary<TopContextName> = fc.constantFrom(
	'global',
	'global',
	'project',
	'prolog',
);

/**
 * Applies the edits one by one, reparsing incrementally each time with `reparse`, and checks each
 * step against a fresh parse. Where neither the previous nor the new tree has error nodes, plain
 * Lezer fragments must give the same tree too.
 */
function check(file: string, top: TopContextName, edits: readonly Edit[]): void {
	const parser = tjpParser(top);
	let text = TEXTS.get(file) ?? '';
	let tree: Tree = parser.parse(text);
	let fragments: readonly TreeFragment[] = [];
	for (const e of edits) {
		const from = Math.min(text.length, Math.floor(e.at * text.length));
		const to = Math.min(text.length, from + e.del);
		const change = [{ fromA: from, toA: to, fromB: from, toB: from + e.insert.length }];
		const plain = hasErrors(tree)
			? null
			: TreeFragment.applyChanges(TreeFragment.addTree(tree, fragments), change);
		text = text.slice(0, from) + e.insert + text.slice(to);
		({ tree, fragments } = reparse(parser, text, tree, change, fragments));
		const freshTree = parser.parse(text);
		const fresh = serialize(freshTree);
		expect(serialize(tree)).toEqual(fresh);
		if (plain && !hasErrors(freshTree)) {
			expect(serialize(parser.parse(text, plain))).toEqual(fresh);
		}
		expect(tree.length).toBe(text.length);
		expect(printLeaves(tree, text)).toBe(text);
	}
}

function hasErrors(tree: Tree): boolean {
	let found = false;
	tree.iterate({
		enter(n) {
			if (n.type.isError) found = true;
			return !found;
		},
	});
	return found;
}

const RUNS = Number(process.env['GRAMMAR_RUNS'] ?? 300);
/** Per-test timeout: a case takes a few milliseconds, so scale with the run count. */
const TIMEOUT = 10_000 + RUNS * 25;

describe('incremental reparse', () => {
	it(
		'equals a fresh parse after random edits to corpus files',
		() => {
			fc.assert(
				fc.property(
					fc.constantFrom(...FILES),
					topArb,
					fc.array(editArb, { minLength: 1, maxLength: 4 }),
					check,
				),
				{ numRuns: RUNS },
			);
		},
		TIMEOUT,
	);

	it(
		'equals a fresh parse after many small edits to one file (typing)',
		() => {
			// Character-by-character typing and deleting at one spot, as in the editor.
			fc.assert(
				fc.property(
					fc.constantFrom(...FILES.filter((f) => (TEXTS.get(f)?.length ?? 0) < 20_000)),
					fc.double({ min: 0, max: 1, noNaN: true }),
					fc.constantFrom(...SNIPPETS.filter((s) => s.length > 3)),
					(file, at, typed) => {
						const edits: Edit[] = [];
						for (let i = 0; i < typed.length; i++)
							edits.push({ at, del: 0, insert: typed.charAt(i) });
						check(file, 'global', edits);
					},
				),
				{ numRuns: Math.max(20, RUNS / 10) },
			);
		},
		TIMEOUT,
	);

	it(
		'never throws on random token soup',
		() => {
			fc.assert(
				fc.property(
					fc.array(fc.oneof(fc.constantFrom(...SNIPPETS), fc.string({ maxLength: 3 })), {
						maxLength: 40,
					}),
					topArb,
					(parts, top) => {
						const text = parts.join(' ');
						const tree = tjpParser(top).parse(text);
						expect(printLeaves(tree, text)).toBe(text);
					},
				),
				{ numRuns: RUNS },
			);
		},
		TIMEOUT,
	);
});
