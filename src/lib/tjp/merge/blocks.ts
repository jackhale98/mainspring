// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which blocks both sides changed statements of (the structural rule; check.ts). Each changed
 * line region of the line merge is mapped, by its range in the base, to the base's blocks (task,
 * resource, project and supplement bodies) from the base tree, whatever the layout: the
 * innermost block whose braces hold the range, and every block whose body the range reaches into
 * without being held in it, also one the range holds whole (a one-line block changed on its line;
 * this errs towards checking). A block around the innermost one is not touched: its changed
 * statement is the inner block, keyed by its id (or its name and position), which no other
 * statement of it can depend on in the keyword table, so checking it there could only find the
 * changes independent; when both sides change inside the inner block, that block is forced. A
 * block one side's regions touch and the other's too is forced:
 * refine.ts merges it statement by statement and check.ts decides whether the changes are
 * independent. A region both sides changed (a conflict, also an identical change) touches for
 * both. Nothing here reads text: no layout (one-line bodies, `{` on its own line, anonymous tasks)
 * can hide a block.
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { blockKind } from './hints';
import type { Region } from './lines';
import type { Rng } from './out';

/** A block's body content (between its braces), or null when it has none. */
function content(n: SyntaxNode): Rng | null {
	const body = n.getChild('Body');
	const open = body?.firstChild;
	const close = body?.lastChild;
	return open?.name === 'OpenBrace' && close?.name === 'CloseBrace'
		? { from: open.to, to: close.from }
		: null;
}

/** The blocks a base range [from, to) changes statements of (module comment). */
export function blocksTouched(tree: Tree, from: number, to: number): SyntaxNode[] {
	const out: SyntaxNode[] = [];
	for (let n: SyntaxNode | null = tree.resolveInner(from, 1); n; n = n.parent) {
		if (!blockKind(n)) continue;
		const c = content(n);
		if (c && c.from <= from && to <= c.to) {
			out.push(n);
			break;
		}
	}
	if (to > from) {
		tree.iterate({
			from,
			to,
			enter: (n) => {
				if (!blockKind(n.node)) return undefined;
				const c = content(n.node);
				const around = c !== null && c.from <= from && to <= c.to;
				if (c && !around && c.from <= to && from <= c.to && !out.some((x) => x.from === n.from)) {
					out.push(n.node);
				}
				return undefined;
			},
		});
	}
	return out;
}

/** The base ranges of the blocks both sides changed statements of, sorted (module comment). */
export function touchedByBoth(
	tree: Tree,
	regions: readonly Region[],
	starts: readonly number[],
): Rng[] {
	const ours = new Map<number, Rng>();
	const theirs = new Map<number, Rng>();
	for (const r of regions) {
		if (r.kind === 'same') continue;
		const from = starts[r.o[0]] as number;
		const to = starts[r.o[1]] as number;
		for (const n of blocksTouched(tree, from, to)) {
			const rng = { from: n.from, to: n.to };
			if (r.kind !== 'theirs') ours.set(n.from, rng);
			if (r.kind !== 'ours') theirs.set(n.from, rng);
		}
	}
	return [...ours.values()].filter((x) => theirs.has(x.from)).sort((x, y) => x.from - y.from);
}
