// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Grammar-aware refinement of a line merge (phase-4.md 6.4 rule 2; types.ts "Refinement").
 *
 * `mergeSpan` merges one span per side, the content of the same parent (a file's top level, or a
 * task, resource or project body): first on lines. Each conflicting hunk is then widened, on every
 * side, to whole elements of the parent (elements.ts: statements with their leading comments),
 * pulling in the neighbouring line regions it overlaps until the widened hunk starts and ends on
 * element boundaries on all three sides, and until a statement whose key is unique in the span
 * is inside the hunk on every side or on none (a line diff can see a moved block as deleted in
 * one place and added in another). Hunks that end up overlapping are one. Each widened hunk
 * is merged statement by statement (keyed.ts), which enters a block edited on both sides by
 * calling `mergeSpan` on its body again. Everything outside the hunks is the line merge's, except
 * the changed regions inside a block both sides changed statements of (`Cx.forced`, blocks.ts),
 * which are hunks too; a body with a plan (check.ts) is one hunk, split into its statements.
 *
 * A hunk where any side has an error node among the parent's statements stays a line conflict
 * (emit.ts `lineMerge`); errors inside a nested body are checked when the merge enters it.
 * `mergeSpan` is a generator: it pauses after the line diff of a large span (types.ts rule 5).
 */
import type { SyntaxNode } from '@lezer/common';
import { cover, declsOf, elementAt, elementsOf, unitsOf, type Element } from './elements';
import {
	emit,
	lineMerge,
	wholeConflict,
	SIDES,
	type Cx,
	type Parent,
	type SideIx,
	type Span,
	type Tri,
	type Step,
} from './emit';
import { keyedMerge } from './keyed';
import {
	diff3Regions,
	diff3RegionsSteps,
	lineStarts,
	splitLines,
	trueConflict,
	type Region,
} from './lines';
import type { Rng } from './out';

/** Whether `node` has an error node below it, not counting what lies inside nested bodies. */
function errorOutsideBodies(node: SyntaxNode): boolean {
	for (let c = node.firstChild; c; c = c.nextSibling) {
		if (c.type.isError) return true;
		if (c.name !== 'Body' && c.firstChild && errorOutsideBodies(c)) return true;
	}
	return false;
}

/**
 * Whether the children of `parent` touching [from, to] hold an error node, outside the bodies of
 * nested blocks: those are checked when the merge enters them (the module comment), and a block
 * it does not enter is taken whole from one side.
 */
export function hasError(parent: SyntaxNode, from: number, to: number): boolean {
	for (let c = parent.firstChild; c; c = c.nextSibling) {
		if (c.to < from || c.from > to) continue;
		if (c.type.isError) return true;
		if (c.name !== 'Body' && c.firstChild && errorOutsideBodies(c)) return true;
	}
	return false;
}

/** A line merge of the spans, computed by the caller when it already has one (file.ts). */
export interface Lined {
	readonly lines: Tri<string[]>;
	readonly regions: readonly Region[];
}

/** `lined` in steps: it pauses after splitting large texts and during the line merge. */
export function* linedSteps(texts: Tri<string>): Generator<void, Lined, void> {
	const lines = texts.map(splitLines) as unknown as Tri<string[]>;
	if (texts[0].length > BIG) yield;
	return { lines, regions: yield* diff3RegionsSteps(lines[0], lines[1], lines[2]) };
}

export function lined(texts: Tri<string>): Lined {
	const lines = texts.map(splitLines) as unknown as Tri<string[]>;
	return { lines, regions: diff3Regions(lines[0], lines[1], lines[2]) };
}

/** Merges three spans of one parent into `cx.out` (module comment). */
/** Spans longer than this (UTF-16 units) pause after their line diff (rule 5). */
const BIG = 20_000;

export function* mergeSpan(cx: Cx, sp: Tri<Span>, parent: Parent, pre?: Lined): Step {
	const { lines, regions } =
		pre ??
		(yield* linedSteps(
			SIDES.map((s) => cx.sides[s].text.slice(sp[s].from, sp[s].to)) as unknown as Tri<string>,
		));
	// A pause after each line diff of a large span (types.ts rule 5).
	if (!pre && sp[0].to - sp[0].from > BIG) yield;
	const starts = lines.map(lineStarts);
	const range = (k: number, s: SideIx): Rng => {
		const g = regions[k] as Region;
		const ix = s === 0 ? g.o : s === 1 ? g.a : g.b;
		const st = starts[s] as number[];
		return { from: sp[s].from + (st[ix[0]] as number), to: sp[s].from + (st[ix[1]] as number) };
	};
	/** A region outside the hunks: the side that changed (ours for a false conflict). */
	const plain = (k: number): void => {
		const kind = (regions[k] as Region).kind;
		const s: SideIx = kind === 'same' ? 0 : kind === 'theirs' ? 2 : 1;
		emit(cx, s, range(k, s));
	};
	// Hunks: real conflicts, and every change in or around a block both sides changed statements
	// of (the structural rule; check.ts), which merges statement by statement even when its line
	// merge is clean. The body of such a block (`parent.plan`) is one hunk.
	const conflicts: number[] = [];
	regions.forEach((g, k) => {
		if (trueConflict(g, lines[1], lines[2])) conflicts.push(k);
		else if (g.kind !== 'same') {
			const r = range(k, 0);
			if (cx.forced.some((f) => f.from <= r.to && r.from <= f.to)) conflicts.push(k);
		}
	});
	if (parent.plan && regions.some((g) => g.kind !== 'same')) {
		conflicts.splice(0, conflicts.length, 0, regions.length - 1);
	}
	if (conflicts.length === 0) {
		for (let k = 0; k < regions.length; k++) plain(k);
		return;
	}
	// In a block both sides changed, statements sharing a line (a one-line body) are elements of
	// their own, so the plan (check.ts) can hold or leave out each.
	const els = SIDES.map((s) => {
		const all = elementsOf(cx.sides[s].text, sp[s].node, sp[s].from, sp[s].to);
		return parent.plan ? all.flatMap((e) => unitsOf(e, cx.sides[s].text)) : all;
	}) as unknown as Tri<Element[]>;
	if (sp[0].to - sp[0].from > BIG) yield;
	// Keys that name one element per side in the span (a statement's key, or a task or resource
	// declared anywhere inside it): such an element must be inside a hunk on every side or on
	// none, else a line diff that saw a move (also into another block) would read it as deleted
	// in one place and added in another.
	const decls = SIDES.map((s) => declsOf(cx.sides[s].tree, cx.sides[s].text));
	/** Keys of elements: their own (unique on every side), and tasks or resources declared once. */
	const counts = new Map<string, number>();
	for (const s of SIDES) {
		const seen = new Map<string, number>();
		for (const e of els[s]) if (e.key !== null) seen.set(e.key, (seen.get(e.key) ?? 0) + 1);
		for (const [key, n] of seen) counts.set(key, Math.max(counts.get(key) ?? 0, n));
	}
	const widen = (lo0: number, hi0: number): [number, number] => {
		let lo = lo0;
		let hi = hi0;
		let changed = true;
		const need = (s: SideIx, from: number, to: number): void => {
			while (range(lo, s).from > from) {
				lo--;
				changed = true;
			}
			while (range(hi, s).to < to) {
				hi++;
				changed = true;
			}
		};
		while (changed) {
			changed = false;
			for (const s of SIDES) {
				const [cf, ct] = cover(els[s], range(lo, s).from, range(hi, s).to);
				need(s, cf, ct);
			}
			if (changed) continue;
			const r = SIDES.map((s) => ({ from: range(lo, s).from, to: range(hi, s).to }));
			const inside = new Set<string>();
			SIDES.forEach((s) => {
				const x = r[s] as Rng;
				for (const e of els[s]) {
					if (e.from >= x.from && e.to <= x.to && e.key !== null && counts.get(e.key) === 1) {
						inside.add(e.key);
					}
				}
				for (const [k, at] of decls[s] as ReadonlyMap<string, number>) {
					if (at >= x.from && at < x.to) inside.add(k);
				}
			});
			if (inside.size === 0) continue;
			SIDES.forEach((s) => {
				const x = r[s] as Rng;
				const out = (at: number): boolean => at < x.from || at >= x.to;
				for (const e of els[s]) {
					if (e.key !== null && inside.has(e.key) && out(e.from) && out(e.to - 1)) {
						need(s, Math.min(e.from, x.from), Math.max(e.to, x.to));
					}
				}
				for (const k of inside) {
					const at = (decls[s] as ReadonlyMap<string, number>).get(k);
					if (at === undefined || !out(at) || at < sp[s].from || at >= sp[s].to) continue;
					const e = els[s][elementAt(els[s], at)];
					if (e) need(s, Math.min(e.from, x.from), Math.max(e.to, x.to));
				}
			});
		}
		return [lo, hi];
	};
	const groups: Array<[number, number]> = [];
	if (parent.plan) groups.push([0, regions.length - 1]);
	for (const k of parent.plan ? [] : conflicts) {
		const last = groups[groups.length - 1];
		if (last && last[1] >= k) continue;
		let [lo, hi] = widen(k, k);
		while (groups.length > 0 && (groups[groups.length - 1] as [number, number])[1] >= lo) {
			lo = Math.min(lo, (groups.pop() as [number, number])[0]);
			[lo, hi] = widen(lo, hi);
		}
		groups.push([lo, hi]);
	}
	let k = 0;
	for (const [lo, hi] of groups) {
		for (; k < lo; k++) plain(k);
		const r = SIDES.map((s) => ({
			from: range(lo, s).from,
			to: range(hi, s).to,
		})) as unknown as Tri<Rng>;
		if (SIDES.some((s) => hasError(sp[s].node, r[s].from, r[s].to))) {
			// A block both sides changed that does not parse cannot be checked: one conflict.
			if (parent.plan || cx.forced.some((f) => f.from <= r[0].to && r[0].from <= f.to)) {
				if (parent.plan) parent.plan.failed = true;
				wholeConflict(cx, r, parent);
				k = hi + 1;
				continue;
			}
			for (; k <= hi; k++) {
				const g = regions[k] as Region;
				if (trueConflict(g, lines[1], lines[2])) {
					lineMerge(cx, [range(k, 0), range(k, 1), range(k, 2)], parent);
				} else plain(k);
			}
			continue;
		}
		const seqs = SIDES.map((s) => ({
			els: els[s].filter((e) => e.from >= r[s].from && e.to <= r[s].to),
			start: r[s].from,
			end: r[s].to,
		})) as unknown as Tri<{ els: Element[]; start: number; end: number }>;
		yield* keyedMerge(cx, seqs, parent);
		k = hi + 1;
	}
	for (; k < regions.length; k++) plain(k);
}
