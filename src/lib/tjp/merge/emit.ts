// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the refinement steps share: the three sides, the output, and the line merge they fall
 * back to. Sides are indexed 0 (base), 1 (ours), 2 (theirs).
 *
 * `lineMerge` is the plain three-way merge on lines of one range per side: what diff3 proves
 * clean is merged, and every other hunk is a line conflict holding ours. Its subject is
 * `block` `both-edited` of the block the lines lie in (the parent's, or for a file's top level
 * the innermost task, resource or project whose braces hold them), else `text` (with `both`).
 * `wholeConflict` is one such conflict over whole elements, without diffing inside them, where
 * refinement cannot split a hunk: a line diff could cut through blocks and pair half of one
 * side's block with the other side's, so a choice would not be well formed.
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { blockKind, type Naming } from './hints';
import { diff3Regions, lineStarts, merge3, splitLines, trueConflict } from './lines';
import type { Out, Rng } from './out';
import type { ConflictSubject, Owner } from './types';

export type Tri<T> = readonly [T, T, T];
export type SideIx = 0 | 1 | 2;
export const SIDES: Tri<SideIx> = [0, 1, 2];

export interface SideText {
	readonly text: string;
	readonly tree: Tree;
}

/** The content of a parent on one side: a `File`, or a `Body` between its braces. */
export interface Span {
	readonly node: SyntaxNode;
	readonly from: number;
	readonly to: number;
}

/** The block whose content is being merged (`other` for a file's top level). */
export interface Parent {
	readonly owner: Owner;
	readonly inBlock: boolean;
}

export interface Cx {
	readonly sides: Tri<SideText>;
	readonly naming: Naming;
	readonly out: Out;
	/** Merges a span into `cx.out` (refine.ts `mergeSpan`), for a block edited on both sides. */
	readonly span: (cx: Cx, spans: Tri<Span>, parent: Parent) => void;
}

export const textOf = (cx: Cx, s: SideIx, r: Rng): string => cx.sides[s].text.slice(r.from, r.to);

export function emit(cx: Cx, s: SideIx, r: Rng): Rng {
	return cx.out.push(textOf(cx, s, r));
}

/** Emits the side `merge3` picks for the three ranges; false when both changed differently. */
export function emitMerged(cx: Cx, r: Tri<Rng>): boolean {
	const t = SIDES.map((s) => textOf(cx, s, r[s]));
	const m = merge3(t[0] as string, t[1] as string, t[2] as string);
	if (m === null) return false;
	emit(cx, m === t[1] ? 1 : 2, m === t[1] ? r[1] : r[2]);
	return true;
}

/** Whether a line merge of the three ranges is clean. */
export function linesClean(cx: Cx, r: Tri<Rng>): boolean {
	const l = SIDES.map((s) => splitLines(textOf(cx, s, r[s])));
	const [o, a, b] = l as [string[], string[], string[]];
	return !diff3Regions(o, a, b).some((g) => trueConflict(g, a, b));
}

const orNull = (s: string): string | null => (s === '' ? null : s);

/** The block whose braces hold `r` on the side that has lines there, or null. */
function enclosingBlock(cx: Cx, r: Tri<Rng>): { side: SideIx; stmt: SyntaxNode } | null {
	const side: SideIx = r[1].to > r[1].from ? 1 : r[0].to > r[0].from ? 0 : 2;
	const { from, to } = r[side];
	for (let n: SyntaxNode | null = cx.sides[side].tree.resolveInner(from, 1); n; n = n.parent) {
		if (!blockKind(n)) continue;
		const body = n.getChild('Body');
		const open = body?.firstChild;
		const close = body?.lastChild;
		if (open?.name === 'OpenBrace' && close?.name === 'CloseBrace') {
			if (open.to <= from && to <= close.from) return { side, stmt: n };
		}
	}
	return null;
}

export function lineSubject(cx: Cx, r: Tri<Rng>, parent: Parent): ConflictSubject {
	if (parent.inBlock) return { kind: 'block', owner: parent.owner, change: 'both-edited' };
	const b = enclosingBlock(cx, r);
	if (!b) return { kind: 'text' };
	const owner = cx.naming.owner(b.stmt, cx.sides[b.side].text);
	return { kind: 'block', owner, change: 'both-edited' };
}

/** The three-way merge on lines of one range per side (module comment). */
export function lineMerge(cx: Cx, r: Tri<Rng>, parent: Parent): void {
	const lines = SIDES.map((s) => splitLines(textOf(cx, s, r[s])));
	const [o, a, b] = lines as [string[], string[], string[]];
	const starts = lines.map(lineStarts);
	const abs = (s: SideIx, ix: readonly [number, number]): Rng => {
		const st = starts[s] as number[];
		return { from: r[s].from + (st[ix[0]] as number), to: r[s].from + (st[ix[1]] as number) };
	};
	for (const g of diff3Regions(o, a, b)) {
		const ranges: Tri<Rng> = [abs(0, g.o), abs(1, g.a), abs(2, g.b)];
		if (g.kind === 'same') emit(cx, 0, ranges[0]);
		else if (g.kind === 'theirs') emit(cx, 2, ranges[2]);
		else if (!trueConflict(g, a, b)) emit(cx, 1, ranges[1]);
		else {
			const subject = lineSubject(cx, ranges, parent);
			const at = emit(cx, 1, ranges[1]);
			cx.out.conflict({
				subject,
				base: orNull(textOf(cx, 0, ranges[0])),
				ours: orNull(textOf(cx, 1, ranges[1])),
				theirs: orNull(textOf(cx, 2, ranges[2])),
				at,
				atOurs: ranges[1],
				atBase: ranges[0],
				both: subject.kind === 'text',
			});
		}
	}
}

/**
 * One conflict for whole elements (a hunk, a run, an element), named as a line conflict is: a
 * choice then takes one side's statements whole, so either choice is well formed.
 */
export function wholeConflict(cx: Cx, r: Tri<Rng>, parent: Parent): void {
	const subject = lineSubject(cx, r, parent);
	const t = SIDES.map((s) => textOf(cx, s, r[s]));
	const at = emit(cx, 1, r[1]);
	cx.out.conflict({
		subject,
		base: t[0] || null,
		ours: t[1] || null,
		theirs: t[2] || null,
		at,
		atOurs: r[1],
		atBase: r[0],
		both: subject.kind === 'text',
	});
}
