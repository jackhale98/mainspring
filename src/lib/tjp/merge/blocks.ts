// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which blocks both sides changed statements of (the structural rule; types.ts G1, G2; check.ts).
 *
 * A **block** is any brace body the grammar parses (a `Body` node: task, resource, project and
 * supplement bodies, but also `shift`, `account`, report and `extend` bodies, `limits`, the bodies
 * of `depends a { … }` and `allocate r { … }`, and every other `{ … }`), owned by the node it
 * belongs to (its parent: a statement or an item). A task, resource, project or supplement
 * declaration without a body is a block with an empty body at its end, where a side may add one.
 * The file's **top level** is a block too.
 *
 * Each changed line region of the line merge is mapped, by its range in the base, to the base
 * tree's blocks, whatever the layout: the innermost block whose braces hold the range (the top
 * level when none does), and every block whose body the range reaches into without being held in
 * it, also one the range holds whole (a one-line block changed on its line; this errs towards
 * checking). A block around the innermost one is not touched: its changed statement is the inner
 * block, which is checked itself when both sides change inside it. A region both sides changed (a
 * conflict, also an identical change) touches for both. A block one side's regions touch and the
 * other's too is forced: refine.ts merges it statement by statement, and check.ts decides, for the
 * kinds its keyword table knows (task, resource, project and supplement bodies, the top level),
 * whether the changes are independent; any other forced block is one conflict (statement.ts: the
 * statement that owns it is one `attribute` conflict). Nothing here reads text: no layout can hide
 * a block.
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { blockKind } from './hints';
import type { Region } from './lines';
import type { Rng } from './out';

/** A body's content, between its braces; null when it is not closed. */
function content(body: SyntaxNode): Rng | null {
	const open = body.firstChild;
	const close = body.lastChild;
	return open?.name === 'OpenBrace' && close?.name === 'CloseBrace'
		? { from: open.to, to: close.from }
		: null;
}

/** The empty body a declaration without one has at its end (module comment). */
function bodyless(n: SyntaxNode): Rng | null {
	return blockKind(n) && !n.getChild('Body') ? { from: n.to, to: n.to } : null;
}

/** The blocks a base range [from, to) changes statements of (module comment). */
export interface Touched {
	/** The blocks' owners (a statement, or an item such as `depends a { … }`). */
	readonly owners: SyntaxNode[];
	/** The file's top level. */
	readonly top: boolean;
}

export function blocksTouched(tree: Tree, from: number, to: number): Touched {
	const owners: SyntaxNode[] = [];
	const holds = (c: Rng | null): boolean => !!c && c.from <= from && to <= c.to;
	let top = true;
	for (let n: SyntaxNode | null = tree.resolveInner(from, 1); n; n = n.parent) {
		const owner = n.name === 'Body' ? n.parent : bodyless(n) ? n : null;
		if (owner && holds(n.name === 'Body' ? content(n) : bodyless(n))) {
			owners.push(owner);
			top = false;
			break;
		}
	}
	if (to > from) {
		tree.iterate({
			from,
			to,
			enter: (n) => {
				const body = n.name === 'Body';
				const c = body ? content(n.node) : bodyless(n.node);
				const owner = body ? n.node.parent : n.node;
				if (!c || !owner || holds(c) || c.from > to || from > c.to) return undefined;
				if (!owners.some((x) => x.from === owner.from && x.to === owner.to)) owners.push(owner);
				return undefined;
			},
		});
	}
	return { owners, top };
}

/** What both sides changed statements of: the owners' base ranges, sorted, and the top level. */
export interface Forced {
	readonly blocks: Rng[];
	readonly top: boolean;
}

/** The blocks both sides changed statements of (module comment). */
export function touchedByBoth(
	tree: Tree,
	regions: readonly Region[],
	starts: readonly number[],
): Forced {
	const ours = new Map<string, Rng>();
	const theirs = new Map<string, Rng>();
	let topOurs = false;
	let topTheirs = false;
	for (const r of regions) {
		if (r.kind === 'same') continue;
		const from = starts[r.o[0]] as number;
		const to = starts[r.o[1]] as number;
		const t = blocksTouched(tree, from, to);
		for (const n of t.owners) {
			const rng = { from: n.from, to: n.to };
			const key = `${n.from}:${n.to}`;
			if (r.kind !== 'theirs') ours.set(key, rng);
			if (r.kind !== 'ours') theirs.set(key, rng);
		}
		if (t.top && r.kind !== 'theirs') topOurs = true;
		if (t.top && r.kind !== 'ours') topTheirs = true;
	}
	const blocks = [...ours.entries()]
		.filter(([k]) => theirs.has(k))
		.map(([, x]) => x)
		.sort((x, y) => x.from - y.from || y.to - x.to);
	return { blocks, top: topOurs && topTheirs };
}
