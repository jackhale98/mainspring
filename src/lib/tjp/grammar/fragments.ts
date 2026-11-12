// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Incremental reparsing (spec 6.1, `updateFile`).
 *
 * Lezer's error recovery can reuse old nodes next to an error and then recover differently from a
 * fresh parse, so the trees would differ in erroneous text. Two steps keep them equal:
 * - `reuseFragments` drops the old tree's error regions (plus a margin) from the reusable
 *   fragments before applying the edit, so text near an old error is reparsed from scratch;
 * - `reparse` also catches errors that the edit creates where the old tree had none: when the
 *   new tree has an error within reach of text that was offered for reuse, recovery there may
 *   have used old nodes, so it cuts those regions too and parses incrementally again. After
 *   MAX_ROUNDS incremental parses it parses the file afresh. Edits in the middle of a word are
 *   often briefly erroneous, so a fresh parse on every error would cost a full parse per
 *   keystroke; one cut round almost always suffices. An error-free result is kept as it is.
 * Error-free text is reused as usual (parser.property.test.ts checks equality with fresh parses).
 */
import { TreeFragment, type ChangedRange, type Tree } from '@lezer/common';
import type { LRParser } from '@lezer/lr';

/** Code units around an error node that are reparsed too. */
const ERROR_MARGIN = 256;

/** A tree's error regions, widened and merged, as same-length "changes". */
function errorRanges(tree: Tree): ChangedRange[] {
	const out: ChangedRange[] = [];
	tree.iterate({
		enter(n) {
			if (!n.type.isError) return;
			const from = Math.max(0, n.from - ERROR_MARGIN);
			const to = Math.min(tree.length, n.to + ERROR_MARGIN);
			const last = out[out.length - 1];
			if (last && from <= last.toA) {
				last.toA = Math.max(last.toA, to);
				last.toB = last.toA;
			} else {
				out.push({ fromA: from, toA: to, fromB: from, toB: to });
			}
			return false;
		},
	});
	return out;
}

/**
 * The fragments to pass to `parser.parse(newText, fragments)` after `changes` (in the old
 * tree's coordinates, sorted, as CodeMirror's `ChangeSet.iterChangedRanges` gives them) turned
 * the text of `tree` into the new text. `previous` are the fragments `tree` was parsed with.
 * Prefer `reparse`, which also handles errors the edit introduces.
 */
export function reuseFragments(
	tree: Tree,
	changes: readonly ChangedRange[],
	previous?: readonly TreeFragment[],
): readonly TreeFragment[] {
	let fragments = TreeFragment.addTree(tree, previous);
	const errors = errorRanges(tree);
	if (errors.length > 0) fragments = TreeFragment.applyChanges(fragments, errors);
	return TreeFragment.applyChanges(fragments, changes);
}

/** Incremental parses before `reparse` falls back to a fresh one. */
export const MAX_ROUNDS = 2;

/**
 * Reparses `text` (the text of `tree` after `changes`) incrementally. Returns the new tree, equal
 * to `parser.parse(text)`, and the fragments it was parsed with (the `previous` of the next
 * call). `maxRounds` is for tests.
 */
export function reparse(
	parser: LRParser,
	text: string,
	tree: Tree,
	changes: readonly ChangedRange[],
	previous?: readonly TreeFragment[],
	maxRounds = MAX_ROUNDS,
): { tree: Tree; fragments: readonly TreeFragment[] } {
	let fragments = reuseFragments(tree, changes, previous);
	for (let round = 0; round < maxRounds; round++) {
		const next = parser.parse(text, fragments);
		const nearReuse = errorRanges(next).filter((r) =>
			fragments.some((f) => f.from < r.toA && f.to > r.fromA),
		);
		if (nearReuse.length === 0) return { tree: next, fragments };
		fragments = TreeFragment.applyChanges(fragments, nearReuse);
	}
	return { tree: parser.parse(text), fragments: [] };
}
