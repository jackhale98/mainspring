// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The three-way merge of one file that all three sides have (types.ts; sync/merge.ts handles the
 * files some side lacks). Lines first; only when diff3 leaves a real conflict are the three texts
 * parsed (the base fully, ours and theirs reusing its tree where they did not change; recent
 * trees are kept, so a merge computed again from newer ours parses ours alone) and the conflicts
 * refined (refine.ts). Each side is parsed in the top
 * context ours' include graph gives the file; a side whose region does not parse in it has error
 * nodes there, which keeps that hunk a line conflict.
 */
import type { ChangedRange, Tree } from '@lezer/common';
import type { WorkspacePath } from '../../workspace/paths';
import { parseSteps, reparseSteps, tjpParser } from '../grammar/parser';
import { Naming, OTHER } from './hints';
import { diff3Regions, lineStarts, splitLines, trueConflict, type Region } from './lines';
import { Out, idKey, type Pending } from './out';
import { lined, mergeSpan, type Lined } from './refine';
import { dedupeSteps, mayDouble } from './dupes';
import type { Cx, Span, Tri } from './emit';
import type { FileMerge, MergeConflict, MergeContext } from './types';

/** Changed ranges from the base to one side, for an incremental parse. */
function changes(
	regions: readonly Region[],
	side: 'a' | 'b',
	o: number[],
	x: number[],
): ChangedRange[] {
	const out: ChangedRange[] = [];
	for (const r of regions) {
		if (r.kind === 'same' || r.kind === (side === 'a' ? 'theirs' : 'ours')) continue;
		const xr = r[side];
		out.push({
			fromA: o[r.o[0]] as number,
			toA: o[r.o[1]] as number,
			fromB: x[xr[0]] as number,
			toB: x[xr[1]] as number,
		});
	}
	return out;
}

/** Trees of recent merges' texts, by top context and text, most recent last. */
const TREES = new Map<string, Tree>();
const KEEP = 6;

/** Conflict ids (types.ts "Stable ids"): the key, then `~n` for the n-th repeat of it. */
export function finish(file: WorkspacePath, pending: readonly Pending[]): MergeConflict[] {
	const seen = new Map<string, number>();
	return pending.map((c) => {
		const key = idKey(file, c);
		const n = seen.get(key) ?? 0;
		seen.set(key, n + 1);
		return {
			id: n === 0 ? key : `${key}~${n}`,
			file,
			subject: c.subject,
			base: c.base,
			ours: c.ours,
			theirs: c.theirs,
			at: { file, from: c.at.from, to: c.at.to },
			atOurs: { file, from: c.atOurs.from, to: c.atOurs.to },
			both: c.both,
		};
	});
}

/** Runs a step generator to its end. */
export function drive<T>(steps: Generator<void, T, void>): T {
	for (;;) {
		const r = steps.next();
		if (r.done) return r.value;
	}
}

/** The changed ranges from ours to the merged text (a line diff), to reparse it from ours' tree. */
function oursToMerged(ours: readonly string[], merged: string): ChangedRange[] {
	const m = splitLines(merged);
	const sa = lineStarts(ours);
	const sm = lineStarts(m);
	return diff3Regions(ours, m, ours)
		.filter((r) => r.kind !== 'same')
		.map((r) => ({
			fromA: sa[r.o[0]] as number,
			toA: sa[r.o[1]] as number,
			fromB: sm[r.a[0]] as number,
			toB: sm[r.a[1]] as number,
		}));
}

/** The changed ranges from one side back to the base (`changes`, the other way round). */
function back(ranges: readonly ChangedRange[]): ChangedRange[] {
	return ranges.map((c) => ({ fromA: c.fromB, toA: c.toB, fromB: c.fromA, toB: c.toA }));
}

/** A tree kept from a recent merge, or the steps' result (then kept). */
function* rememberedSteps(
	top: string,
	text: string,
	parse: () => Generator<void, Tree, void>,
): Generator<void, Tree, void> {
	const key = `${top}\u0000${text}`;
	const hit = TREES.get(key);
	if (hit) {
		TREES.delete(key);
		TREES.set(key, hit);
		return hit;
	}
	const tree = yield* parse();
	TREES.set(key, tree);
	if (TREES.size > KEEP) TREES.delete(TREES.keys().next().value as string);
	return tree;
}

/**
 * The merge of a file all three sides have (module comment), in steps: it pauses (yields) after
 * the line merge, during each parse (grammar/fragments.ts `parseSteps`), after refinement and
 * during the reparse of the merged text, so no step does much more than one of those pieces.
 */
export function* mergeTextSteps(
	file: WorkspacePath,
	base: string,
	ours: string,
	theirs: string,
	ctx: MergeContext,
): Generator<void, FileMerge, void> {
	if (ours === theirs || theirs === base) return { text: ours, conflicts: [] };
	if (ours === base) return { text: theirs, conflicts: [] };
	const pre = lined([base, ours, theirs]);
	const [o, a, b] = pre.lines;
	const conflicted = pre.regions.some((r) => trueConflict(r, a, b));
	const doubled = mayDouble(pre.lines, pre.regions);
	if (!conflicted && !doubled) return { text: assemble(pre), conflicts: [] };
	yield;
	const top = ctx.includes.tops.get(file) ?? 'global';
	const parser = tjpParser(top);
	const naming = new Naming(file, ctx.includes);
	const so = lineStarts(o);
	const toOurs = changes(pre.regions, 'a', so, lineStarts(a));
	// Ours' tree from the workspace when it has one for this text (parsed in the same context).
	const given = ctx.trees?.get(file);
	const oursGiven = given && given.length === ours.length ? given : null;
	const baseTree = yield* rememberedSteps(top, base, () =>
		oursGiven ? reparseSteps(parser, base, oursGiven, back(toOurs)) : parseSteps(parser, base),
	);
	const oursTree =
		oursGiven ??
		(yield* rememberedSteps(top, ours, () => reparseSteps(parser, ours, baseTree, toOurs)));
	const theirsTree = yield* rememberedSteps(top, theirs, () =>
		reparseSteps(parser, theirs, baseTree, changes(pre.regions, 'b', so, lineStarts(b))),
	);
	const trees: Tri<Tree> = [baseTree, oursTree, theirsTree];
	let text: string;
	let pending: Pending[];
	if (conflicted) {
		const out = new Out();
		const sides: Cx['sides'] = [
			{ text: base, tree: baseTree },
			{ text: ours, tree: oursTree },
			{ text: theirs, tree: theirsTree },
		];
		const cx: Cx = { sides, naming, out, span: (c, spans, parent) => mergeSpan(c, spans, parent) };
		const spans = sides.map((s) => ({ node: s.tree.topNode, from: 0, to: s.text.length }));
		yield* mergeSpan(cx, spans as unknown as Tri<Span>, { owner: OTHER, inBlock: false }, pre);
		text = out.text();
		pending = out.conflicts;
		yield;
	} else {
		text = assemble(pre);
		pending = [];
	}
	if (doubled) {
		const merged = yield* reparseSteps(parser, text, oursTree, oursToMerged(a, text));
		const texts: Tri<string> = [base, ours, theirs];
		({ text, conflicts: pending } = yield* dedupeSteps(
			{ naming, texts, trees, ...pre },
			doubled,
			text,
			merged,
			pending,
		));
	}
	return { text, conflicts: finish(file, pending) };
}

/** The clean merge of the line regions. */
function assemble(pre: Lined): string {
	const [o, a, b] = pre.lines;
	const parts: string[] = [];
	for (const r of pre.regions) {
		const [side, ix] = r.kind === 'same' ? [o, r.o] : r.kind === 'theirs' ? [b, r.b] : [a, r.a];
		for (let i = ix[0]; i < ix[1]; i++) parts.push(side[i] as string);
	}
	return parts.join('');
}

/** `mergeTextSteps` run to its end. */
export function mergeTexts(
	file: WorkspacePath,
	base: string,
	ours: string,
	theirs: string,
	ctx: MergeContext,
): FileMerge {
	return drive(mergeTextSteps(file, base, ours, theirs, ctx));
}
