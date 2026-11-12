// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Incremental reparsing (spec 6.1, `updateFile`).
 *
 * Lezer's error recovery can reuse old nodes next to an error and then recover differently from a
 * fresh parse, so the trees would differ in erroneous text. Two steps keep them equal:
 * - `reuseFragments` drops the old tree's error regions (plus a margin) from the reusable
 *   fragments before applying the edit, so text near an old error is reparsed from scratch;
 * - `reparse` also catches errors that the edit creates where the old tree had none: when the
 *   new tree has an error inside a region that was still offered for reuse, it cuts that region
 *   too and parses again. Each round only removes fragments, so it ends; in practice one round
 *   suffices, and an error-free result needs none.
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

/** At most this many extra rounds; each strictly removes fragments, so it is a safety net. */
const MAX_ROUNDS = 8;

/**
 * Reparses `text` (the text of `tree` after `changes`) incrementally. Returns the new tree, equal
 * to `parser.parse(text)`, and the fragments it was parsed with (the `previous` of the next
 * call).
 */
export function reparse(
	parser: LRParser,
	text: string,
	tree: Tree,
	changes: readonly ChangedRange[],
	previous?: readonly TreeFragment[],
): { tree: Tree; fragments: readonly TreeFragment[] } {
	let fragments = reuseFragments(tree, changes, previous);
	for (let round = 0; round <= MAX_ROUNDS; round++) {
		const next = parser.parse(text, fragments);
		const reused = errorRanges(next).filter((r) =>
			fragments.some((f) => f.from < r.toA && f.to > r.fromA),
		);
		if (reused.length === 0) return { tree: next, fragments };
		fragments = TreeFragment.applyChanges(fragments, reused);
	}
	return { tree: parser.parse(text), fragments: [] };
}
