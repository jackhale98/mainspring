// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the refinement steps share: the three sides, the output, and the line merge they fall
 * back to. Sides are indexed 0 (base), 1 (ours), 2 (theirs).
 *
 * `lineMerge` is the plain three-way merge on lines of one range per side: what diff3 proves
 * clean is merged, and every other hunk is a line conflict holding ours. Its subject is
 * `block` `both-edited` of the block the lines lie in (the parent's, or for a file's top level
 * the innermost task, resource or project whose braces hold them), else `text` (with `both`,
 * unless the two sides hold the same task or resource: keeping both would declare it twice).
 * `wholeConflict` is one such conflict over whole elements, without diffing inside them, where
 * refinement cannot split a hunk: a line diff could cut through blocks and pair half of one
 * side's block with the other side's, so a choice would not be well formed.
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { blockKind, statementKey, type Naming } from './hints';
import {
	diff3Regions,
	diff3RegionsSteps,
	lineStarts,
	merge3,
	splitLines,
	trueConflict,
} from './lines';
import type { BlockPlan } from './check';
import type { Out, Rng } from './out';
import type { ConflictSubject, Owner } from './types';

export type Tri<T> = readonly [T, T, T];

/** A piece of merge work that pauses (yields) between steps (types.ts rule 5). */
export type Step = Generator<void, void, void>;
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
	/**
	 * Set for a block both sides changed statements of (refine.ts, the structural rule): its body
	 * is merged as one hunk, statement by statement, following the plan of check.ts.
	 */
	readonly plan?: BlockPlan;
}

export interface Cx {
	readonly sides: Tri<SideText>;
	readonly naming: Naming;
	readonly out: Out;
	/**
	 * Merges a span into `cx.out` (refine.ts `mergeSpan`), for a block edited on both sides, in
	 * steps (types.ts rule 5): it pauses after each line diff of a large span.
	 */
	readonly span: (cx: Cx, spans: Tri<Span>, parent: Parent) => Step;
	/**
	 * The base ranges of the blocks both sides changed statements of (file.ts `touchedByBoth`),
	 * sorted: they and the blocks around them are always merged statement by statement.
	 */
	readonly forced: readonly Rng[];
	/**
	 * Properties whose declaration and supplements in this file are one conflict (supplements.ts):
	 * each side's ranges of their blocks.
	 */
	readonly joint: readonly Tri<readonly Rng[]>[];
	/**
	 * Whether side `s` declares `key` (`task:t`) in the workspace's other files more often than the
	 * base does: a block that side moved to another file (review L4).
	 */
	readonly elsewhere: (s: 1 | 2, key: string) => boolean;
}

/** Whether a forced block lies in (or is) the base range [from, to). */
export function forcedIn(cx: Cx, from: number, to: number): boolean {
	for (const r of cx.forced) {
		if (r.from >= to) break;
		if (r.from >= from && r.from < to) return true;
	}
	return false;
}

/** The forced block that starts at base offset `from`, if any. */
export function isForced(cx: Cx, from: number): boolean {
	return cx.forced.some((r) => r.from === from);
}

export const textOf = (cx: Cx, s: SideIx, r: Rng): string => cx.sides[s].text.slice(r.from, r.to);

/**
 * Appends a side's text. Text that starts a line on its side starts one in the merge too: when
 * the text before it came from the other side without a line end (ours dropped the file's last
 * line break, theirs appended a task), a line break is put between (review L5), the file's own
 * (`\r\n` where that side's line before it has one).
 */
export function emit(cx: Cx, s: SideIx, r: Rng): Rng {
	const text = cx.sides[s].text;
	if (r.to > r.from && r.from > 0 && text[r.from - 1] === '\n' && !cx.out.atLineStart) {
		cx.out.push(text[r.from - 2] === '\r' ? '\r\n' : '\n');
	}
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

/** Whether a line merge of the three ranges is clean, in steps (it pauses inside a large diff). */
export function* linesClean(cx: Cx, r: Tri<Rng>): Generator<void, boolean, void> {
	const l = SIDES.map((s) => splitLines(textOf(cx, s, r[s])));
	const [o, a, b] = l as [string[], string[], string[]];
	const regions = yield* diff3RegionsSteps(o, a, b);
	return !regions.some((g) => trueConflict(g, a, b));
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

/** The keys of the tasks and resources declared in `r` of one side, nested ones too. */
function blocksIn(cx: Cx, s: SideIx, r: Rng): Set<string> {
	const out = new Set<string>();
	const text = cx.sides[s].text;
	cx.sides[s].tree.iterate({
		from: r.from,
		to: r.to,
		enter: (n) => {
			if (n.from < r.from || n.to > r.to) return undefined;
			const k = blockKind(n.node);
			if (k === 'task' || k === 'resource') {
				const key = statementKey(n.node, text);
				if (key) out.add(key);
			}
			return undefined;
		},
	});
	return out;
}

/**
 * Whether ours' and theirs' lines declare a task or resource in common (a block reordered,
 * wrapped or moved): "Keep both" would then declare it twice, so it is not offered (L1).
 */
export function shareBlocks(cx: Cx, r: Tri<Rng>): boolean {
	if (r[1].to <= r[1].from || r[2].to <= r[2].from) return false;
	const mine = blocksIn(cx, 1, r[1]);
	if (mine.size === 0) return false;
	for (const k of blocksIn(cx, 2, r[2])) if (mine.has(k)) return true;
	return false;
}

export function lineSubject(cx: Cx, r: Tri<Rng>, parent: Parent): ConflictSubject {
	if (parent.inBlock) return { kind: 'block', owner: parent.owner, change: 'both-edited' };
	const b = enclosingBlock(cx, r);
	if (!b) return { kind: 'text' };
	const owner = cx.naming.owner(b.stmt, cx.sides[b.side].text);
	return { kind: 'block', owner, change: 'both-edited' };
}

/** The three-way merge on lines of one range per side (module comment). */
/** Both sides' texts of a region are white space only. */
const blank = (cx: Cx, r: Tri<Rng>): boolean =>
	textOf(cx, 1, r[1]).trim() === '' && textOf(cx, 2, r[2]).trim() === '';

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
		else if (blank(cx, ranges)) {
			// Both sides only changed the spacing between the same tokens (statements typed into a
			// one-line body at either end): ours' spacing, or theirs' where ours has none.
			emit(
				cx,
				textOf(cx, 1, ranges[1]) === '' ? 2 : 1,
				ranges[textOf(cx, 1, ranges[1]) === '' ? 2 : 1],
			);
		} else {
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
				both: subject.kind === 'text' && !shareBlocks(cx, ranges),
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
		both: subject.kind === 'text' && !shareBlocks(cx, r),
	});
}
