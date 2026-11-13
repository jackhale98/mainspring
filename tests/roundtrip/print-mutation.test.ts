// SPDX-License-Identifier: GPL-2.0-or-later
// The printTree mutation check of phase-1.md 9.1: the round trip must have teeth. With one token dropped from
// the tree, `printTree` must fail (it throws on a gap that holds more than whitespace), and so must the
// round-trip check of a golden file, naming the file and the position of the missing text. The tokens
// dropped are the first one, one inside a nested block, a string, a comment, the middle one and the last one.
import { Tree } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import type { TjpFile } from '../../src/lib/tjp/document';
import { tjpParser } from '../../src/lib/tjp/grammar/parser';
import { CoverageError, printTree } from '../../src/lib/tjp/tree';
import { checkFile, decode } from './check';
import { goldenPlans, readBytes } from './corpus';

interface Leaf {
	from: number;
	to: number;
	name: string;
	/** Number of enclosing `Body` nodes. */
	depth: number;
}

/** The leaf tokens of a tree that `printTree` prints, in order, with their nesting. */
function leaves(tree: Tree): Leaf[] {
	const out: Leaf[] = [];
	const cursor = tree.cursor();
	let body = 0;
	const walk = (): void => {
		if (cursor.name === 'Body') body++;
		if (cursor.firstChild()) {
			do walk();
			while (cursor.nextSibling());
			cursor.parent();
		} else if (!cursor.type.isError && cursor.to > cursor.from && !cursor.type.isTop) {
			out.push({ from: cursor.from, to: cursor.to, name: cursor.name, depth: body });
		}
		if (cursor.name === 'Body') body--;
	};
	walk();
	return out;
}

/** The same tree with the leaf at `from` left out (rebuilt from a flat buffer of the other nodes). */
function without(file: TjpFile, leaf: Leaf): Tree {
	const { tree } = file;
	const buffer: number[] = [];
	const cursor = tree.cursor();
	const emit = (): void => {
		const start = buffer.length;
		// A wrapper with the leaf's exact range goes too, or it would turn into a leaf and print the text.
		if (cursor.from === leaf.from && cursor.to === leaf.to && !cursor.type.isTop) return;
		const here = { id: cursor.type.id, from: cursor.from, to: cursor.to };
		if (cursor.firstChild()) {
			do emit();
			while (cursor.nextSibling());
			cursor.parent();
		} else if (here.from === leaf.from && here.to === leaf.to && !cursor.type.isTop) return;
		buffer.push(here.id, here.from, here.to, buffer.length - start + 4);
	};
	emit();
	return Tree.build({
		buffer,
		nodeSet: tjpParser(file.top).nodeSet,
		topID: tree.type.id,
		length: tree.length,
	});
}

const PLAN = goldenPlans().find((p) => p.id === 'upstream-tutorial');

describe('printTree mutation (phase-1.md 9.1)', () => {
	it('has the golden plan to work on', () => {
		expect(PLAN).toBeDefined();
	});
	const plan = PLAN;
	if (!plan) return;
	const file = plan.files[0] as string;
	const repoPath = `${plan.root}/${file}`;
	const bytes = readBytes(repoPath);
	const text = decode(bytes);
	const snap = createWorkspace({
		entry: plan.entry,
		files: Object.fromEntries(plan.files.map((f) => [f, decode(readBytes(`${plan.root}/${f}`))])),
	}).snapshot();
	const tjp = snap.files.get(file);

	it('prints the unmodified tree back exactly', () => {
		expect(tjp && printTree(tjp.tree, text)).toBe(text);
	});

	const all = tjp ? leaves(tjp.tree) : [];
	const pick = (f: (l: Leaf) => boolean): Leaf | undefined => all.find(f);
	const cases: Array<[string, Leaf | undefined]> = [
		['the first token', all[0]],
		['a token inside a nested block', pick((l) => l.depth >= 2 && l.name === 'Keyword')],
		['a string', pick((l) => l.name === 'String')],
		['a comment', pick((l) => /Comment$/.test(l.name))],
		['a token in the middle', all[Math.floor(all.length / 2)]],
		['the last token', all[all.length - 1]],
	];

	for (const [what, leaf] of cases) {
		it(`fails when ${what} is dropped`, () => {
			expect(leaf, `no leaf for ${what}`).toBeDefined();
			if (!leaf || !tjp) return;
			const broken = without(tjp, leaf);
			expect(() => printTree(broken, text)).toThrow(CoverageError);
			// The round-trip check of the file reports it, naming the file and the position.
			const row = checkFile(
				{ corpus: 'golden', plan: plan.id, file: repoPath },
				bytes,
				{ ...tjp, tree: broken },
				null,
				false,
			);
			expect(row.file).toBe(repoPath);
			expect(row.problems.length).toBeGreaterThan(0);
			expect(row.problems.join('\n')).toContain('printTree threw: non-whitespace gap at');
			// The gap starts where the previous token ended and runs to the next one, so it holds the dropped text.
			const gap = /non-whitespace gap at (\d+)-(\d+)/.exec(row.problems.join('\n'));
			expect(Number(gap?.[1])).toBeLessThanOrEqual(leaf.from);
			expect(Number(gap?.[2])).toBeGreaterThanOrEqual(leaf.to);
		});
	}

	it('covers a nested block, a string and a comment in this file', () => {
		expect(cases.every(([, l]) => l !== undefined)).toBe(true);
	});
});
