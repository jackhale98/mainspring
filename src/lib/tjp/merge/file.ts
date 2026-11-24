// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The three-way merge of one file that all three sides have (types.ts; sync/merge.ts handles the
 * files some side lacks). A file one side alone changed is that side's. Otherwise lines first,
 * then the three texts are parsed (the base fully, or from ours' tree when the workspace passes
 * it; ours and theirs reusing the base's tree where they did not change; recent trees are kept,
 * so a merge computed again from newer ours parses ours alone). Refinement (refine.ts) runs on
 * the line merge's conflicts and on every block both sides changed statements of (blocks.ts, the
 * structural rule: such a block is clean only when check.ts proves the changes independent).
 * Each side is parsed in the top context ours' include graph gives the file; a side whose region
 * does not parse in it has error nodes there, which keeps that hunk a conflict.
 */
import type { ChangedRange, Tree } from '@lezer/common';
import type { WorkspacePath } from '../../workspace/paths';
import { parseSteps, reparseSteps, tjpParser } from '../grammar/parser';
import { Naming, OTHER } from './hints';
import { touchedByBoth } from './blocks';
import { declsOf } from './elements';
import {
	diff3RegionsSteps,
	drive,
	lineStarts,
	splitLines,
	trueConflict,
	type Region,
} from './lines';
import { Out, idKey, type Pending } from './out';
import { linedSteps, mergeSpan, type Lined } from './refine';
import { bothAdded, dedupeSteps } from './dupes';
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
interface Kept {
	readonly top: string;
	readonly text: string;
	readonly tree: Tree;
}
const TREES: Kept[] = [];
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

export { drive };

/** The changed ranges from ours to the merged text (a line diff), to reparse it from ours' tree. */
function* oursToMerged(
	ours: readonly string[],
	merged: string,
): Generator<void, ChangedRange[], void> {
	const m = splitLines(merged);
	const sa = lineStarts(ours);
	const sm = lineStarts(m);
	const regions = yield* diff3RegionsSteps(ours, m, ours);
	return regions
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

/**
 * A tree kept from a recent merge, or the steps' result (then kept). Looked up by top context and
 * text, compared directly: a key made of the text would cost a copy and a hash of the whole file.
 */
function* rememberedSteps(
	top: string,
	text: string,
	parse: () => Generator<void, Tree, void>,
): Generator<void, Tree, void> {
	const i = TREES.findIndex(
		(e) => e.top === top && e.text.length === text.length && e.text === text,
	);
	if (i >= 0) {
		const [hit] = TREES.splice(i, 1) as [Kept];
		TREES.push(hit);
		return hit.tree;
	}
	const tree = yield* parse();
	TREES.push({ top, text, tree });
	if (TREES.length > KEEP) TREES.shift();
	return tree;
}

/** Ours' tree from the workspace when its text is ours' text (types.ts `MergeContext.files`). */
function givenTree(ctx: MergeContext, file: WorkspacePath, ours: string): Tree | null {
	const f = ctx.files?.get(file);
	if (!f) return null;
	if (typeof f.text === 'string') return f.text === ours ? f.tree : null;
	return f.text.length === ours.length && f.text.toString() === ours ? f.tree : null;
}

/** Whether ours declares a task or resource `key` in another of its files (a move there). */
function elsewhereOf(ctx: MergeContext, file: WorkspacePath): (key: string) => boolean {
	let keys: Set<string> | null = null;
	return (key) => {
		if (!keys) {
			keys = new Set();
			for (const [path, f] of ctx.files ?? []) {
				if (path === file) continue;
				const text = typeof f.text === 'string' ? f.text : f.text.toString();
				for (const k of declsOf(f.tree, text, true).keys()) keys.add(k);
			}
		}
		return keys.has(key);
	};
}

/**
 * The merge of a file all three sides have (module comment), in steps (types.ts rule 5): it
 * pauses during the line merge (on large chunks), during each parse (grammar/fragments.ts
 * `parseSteps`), between the declaration indexes, during refinement (after each large line diff
 * and element list) and during the duplicate pass.
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
	const pre = yield* linedSteps([base, ours, theirs]);
	yield;
	const [o, a, b] = pre.lines;
	const top = ctx.includes.tops.get(file) ?? 'global';
	const parser = tjpParser(top);
	const naming = new Naming(file, ctx.includes);
	const so = lineStarts(o);
	const toOurs = changes(pre.regions, 'a', so, lineStarts(a));
	const oursGiven = givenTree(ctx, file, ours);
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
	// The structural rule (check.ts): blocks both sides changed statements of, from the tree.
	const forced = touchedByBoth(baseTree, pre.regions, so);
	const conflicted = pre.regions.some((r) => trueConflict(r, a, b));
	let text: string;
	let pending: Pending[];
	if (conflicted || forced.length > 0) {
		const sides: Cx['sides'] = [
			{ text: base, tree: baseTree },
			{ text: ours, tree: oursTree },
			{ text: theirs, tree: theirsTree },
		];
		for (const s of sides) {
			declsOf(s.tree, s.text);
			yield;
		}
		const out = new Out();
		const cx: Cx = {
			sides,
			naming,
			out,
			span: (c, spans, parent) => mergeSpan(c, spans, parent),
			forced,
			elsewhere: elsewhereOf(ctx, file),
		};
		const spans = sides.map((s) => ({ node: s.tree.topNode, from: 0, to: s.text.length }));
		yield* mergeSpan(cx, spans as unknown as Tri<Span>, { owner: OTHER, inBlock: false }, pre);
		text = out.text();
		pending = out.conflicts;
		yield;
	} else {
		text = assemble(pre);
		pending = [];
	}
	if (bothAdded(pre.regions)) {
		const ranges = yield* oursToMerged(a, text);
		const merged = yield* reparseSteps(parser, text, oursTree, ranges);
		const texts: Tri<string> = [base, ours, theirs];
		({ text, conflicts: pending } = yield* dedupeSteps(
			{ naming, texts, trees, ...pre },
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
