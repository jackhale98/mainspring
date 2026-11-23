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
import { reparse, tjpParser } from '../grammar/parser';
import { Naming, OTHER } from './hints';
import { lineStarts, trueConflict, type Region } from './lines';
import { Out, idKey, type Pending } from './out';
import { lined, mergeSpan } from './refine';
import { dedupe, mayDouble } from './dupes';
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

/**
 * A tree from a recent merge, or `parse()`'s. While a conflict waits its base and theirs are fixed
 * and the merge is computed again from newer ours (types.ts), so only ours is parsed again. The
 * cache is invisible to callers: a tree depends on its text and context alone.
 */
function remembered(top: string, text: string, parse: () => Tree): Tree {
	const key = `${top}\u0000${text}`;
	const hit = TREES.get(key);
	if (hit) {
		TREES.delete(key);
		TREES.set(key, hit);
		return hit;
	}
	const tree = parse();
	TREES.set(key, tree);
	if (TREES.size > KEEP) TREES.delete(TREES.keys().next().value as string);
	return tree;
}

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

/** The merge of a file all three sides have (module comment). */
export function mergeTexts(
	file: WorkspacePath,
	base: string,
	ours: string,
	theirs: string,
	ctx: MergeContext,
): FileMerge {
	if (ours === theirs || theirs === base) return { text: ours, conflicts: [] };
	if (ours === base) return { text: theirs, conflicts: [] };
	const pre = lined([base, ours, theirs]);
	const [o, a, b] = pre.lines;
	const parser = tjpParser(ctx.includes.tops.get(file) ?? 'global');
	const naming = new Naming(file, ctx.includes);
	let text: string;
	let pending: Pending[];
	let trees: Tri<Tree | null> = [null, null, null];
	if (!pre.regions.some((r) => trueConflict(r, a, b))) {
		const parts: string[] = [];
		for (const r of pre.regions) {
			const [side, ix] = r.kind === 'same' ? [o, r.o] : r.kind === 'theirs' ? [b, r.b] : [a, r.a];
			for (let i = ix[0]; i < ix[1]; i++) parts.push(side[i] as string);
		}
		text = parts.join('');
		pending = [];
	} else {
		const top = ctx.includes.tops.get(file) ?? 'global';
		const baseTree = remembered(top, base, () => parser.parse(base));
		const so = lineStarts(o);
		const reuse = (t: string, side: 'a' | 'b', lines: string[]): Tree =>
			remembered(
				top,
				t,
				() => reparse(parser, t, baseTree, changes(pre.regions, side, so, lineStarts(lines))).tree,
			);
		trees = [baseTree, reuse(ours, 'a', a), reuse(theirs, 'b', b)];
		const out = new Out();
		const sides: Cx['sides'] = [
			{ text: base, tree: baseTree },
			{ text: ours, tree: trees[1] as Tree },
			{ text: theirs, tree: trees[2] as Tree },
		];
		const cx: Cx = { sides, naming, out, span: (c, spans, parent) => mergeSpan(c, spans, parent) };
		const spans = sides.map((s) => ({ node: s.tree.topNode, from: 0, to: s.text.length }));
		mergeSpan(cx, spans as unknown as Tri<Span>, { owner: OTHER, inBlock: false }, pre);
		text = out.text();
		pending = out.conflicts;
	}
	if (mayDouble(pre.lines, pre.regions)) {
		const texts: Tri<string> = [base, ours, theirs];
		({ text, conflicts: pending } = dedupe(
			{ parser, naming, texts, trees, ...pre },
			text,
			pending,
		));
	}
	return { text, conflicts: finish(file, pending) };
}
