// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Tree fragments for an incremental reparse (spec 6.1, `updateFile`).
 *
 * Lezer's error recovery can reuse old nodes next to an error and then recover differently from a
 * fresh parse, so the trees would differ in erroneous text. `reuseFragments` therefore drops the
 * old tree's error regions (plus a margin) from the reusable fragments before applying the edit;
 * text near an error is reparsed from scratch. Error-free text is reused as usual. With this, an
 * incremental reparse gives exactly the tree of a fresh parse (parser.property.test.ts).
 */
import { TreeFragment, type ChangedRange, type Tree } from '@lezer/common';

/** Code units around an error node that are reparsed too. */
const ERROR_MARGIN = 256;

/** The old tree's error regions, widened and merged, as same-length "changes". */
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
