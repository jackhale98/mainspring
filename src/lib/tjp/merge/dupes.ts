// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * No silent duplicate declarations (phase-4.md 6.4 rule 3; types.ts). A task or resource both
 * sides added, or moved, to different places in different blocks (or at the top level) merges as
 * separate clean hunks, and the merged file would declare it twice, which TaskJuggler refuses. A
 * declaration path (the keys of the declaration and its enclosing ones; a resource's id alone,
 * as resource ids are global, TjpSyntaxRules.rb 4796-4810) that the merged file holds twice
 * while each side holds it once is one `block` conflict, `added-twice`, or `both-edited` when the
 * base had it (with the base's block), held at ours' copy, with theirs' copy taken out. Identical
 * new copies keep ours' alone, cleanly; an identical moved block is still a conflict (where it
 * goes). Statements said twice in one block are check.ts's (the structural rule).
 *
 * The pass runs whenever both sides added lines (`bothAdded`, which can only err towards
 * running). Declarations in different files are left to the engine, which reports a duplicate id
 * (mergeFile sees one file).
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { statementsIn } from '../tree';
import { blockKind, statementKey, type Naming } from './hints';
import { lineStarts, type Region } from './lines';
import type { Pending, Rng } from './out';
import type { Tri } from './emit';

/**
 * Whether both sides added lines: a declaration in the merge twice needs a copy from each side's
 * added lines (the merge holds each base line at most once), so without additions on both sides
 * there is none. A structural gate: it can only send more merges through the pass.
 */
export function bothAdded(regions: readonly Region[]): boolean {
	const added = (r: Region, x: 'a' | 'b'): boolean => r[x][1] > r[x][0];
	return (
		regions.some((r) => (r.kind === 'ours' || r.kind === 'conflict') && added(r, 'a')) &&
		regions.some((r) => (r.kind === 'theirs' || r.kind === 'conflict') && added(r, 'b'))
	);
}

interface Facts {
	/** Task and resource declarations by path. */
	readonly blocks: Map<string, SyntaxNode[]>;
}

/** Statements walked between two pauses of `factsOf` (types.ts rule 5). */
const WALK_STEP = 300;

const FACTS = new WeakMap<Tree, Facts>();

/** A tree's declarations by path, in steps; kept per tree. */
function* factsOf(tree: Tree, text: string): Generator<void, Facts, void> {
	const kept = FACTS.get(tree);
	if (kept) return kept;
	const blocks = new Map<string, SyntaxNode[]>();
	let walked = 0;
	function* walk(node: SyntaxNode, path: string): Generator<void, void, void> {
		for (const st of statementsIn(node)) {
			if (++walked % WALK_STEP === 0) yield;
			const kind = blockKind(st);
			if (!kind) continue;
			const key = statementKey(st, text);
			const named = kind === 'project' || kind === 'supplement' || !!st.getChild('Id');
			if (key === null || !named) continue;
			const p = kind === 'resource' ? `resource:${key}` : `${path}/${key}`;
			if (kind === 'task' || kind === 'resource') {
				const list = blocks.get(p);
				if (list) list.push(st);
				else blocks.set(p, [st]);
			}
			const body = st.getChild('Body');
			if (body) yield* walk(body, p);
		}
	}
	yield* walk(tree.topNode, '');
	const facts = { blocks };
	FACTS.set(tree, facts);
	return facts;
}

/** The statement's lines when it has them to itself, else the statement. */
function linesOf(text: string, st: { from: number; to: number }): Rng {
	const ls = text.lastIndexOf('\n', st.from - 1) + 1;
	const nl = text.indexOf('\n', st.to);
	const le = nl < 0 ? text.length : nl + 1;
	const before = text.slice(ls, st.from).trim() === '';
	const after = /^[ \t\r]*(#[^\n]*)?\n?$/.test(text.slice(st.to, le));
	return before && after ? { from: ls, to: le } : { from: st.from, to: st.to };
}

export interface Dedupe {
	readonly naming: Naming;
	/** Base, ours, theirs, with their trees. */
	readonly texts: Tri<string>;
	readonly trees: Tri<Tree>;
	readonly lines: Tri<string[]>;
	readonly regions: readonly Region[];
}

const slice = (t: string, r: { from: number; to: number }): string => t.slice(r.from, r.to);

/** The merged text (with its tree) and conflicts without silent duplicates (module comment), in steps. */
export function* dedupeSteps(
	d: Dedupe,
	text: string,
	tree: Tree,
	conflicts: readonly Pending[],
): Generator<void, { text: string; conflicts: Pending[] }, void> {
	const facts: Facts[] = [];
	for (const i of [0, 1, 2] as const) {
		facts.push(yield* factsOf(d.trees[i], d.texts[i]));
		yield;
	}
	const [base, ours, theirs] = facts as [Facts, Facts, Facts];
	const merged = yield* factsOf(tree, text);
	yield;
	const cuts: Array<{ cut: Rng; conflict: Pending | null }> = [];
	const busy = (r: Rng): boolean =>
		conflicts.some((c) => c.at.from < r.to && r.from < c.at.to) ||
		cuts.some(
			(c) =>
				(c.cut.from < r.to && r.from < c.cut.to) ||
				(c.conflict && c.conflict.at.from < r.to && r.from < c.conflict.at.to),
		);
	/** The base offset where ours' text at `pos` came from (its line region's start). */
	const baseAt = (pos: number): Rng => {
		const so = lineStarts(d.lines[0]);
		const sa = lineStarts(d.lines[1]);
		const line = sa.findIndex((x) => x > pos) - 1;
		const reg = d.regions.find((r) => r.a[0] <= line && line < r.a[1]);
		const at0 = reg ? (so[reg.o[0]] as number) : 0;
		return { from: at0, to: at0 };
	};

	for (const [p, copies] of merged.blocks) {
		const o = ours.blocks.get(p);
		const t = theirs.blocks.get(p);
		if (copies.length !== 2 || o?.length !== 1 || t?.length !== 1) continue;
		const os = o[0] as SyntaxNode;
		const ol = linesOf(d.texts[1], os);
		const oursText = slice(d.texts[1], ol);
		const theirsText = slice(d.texts[2], linesOf(d.texts[2], t[0] as SyntaxNode));
		const ranges: Rng[] = copies.map((c) => linesOf(text, c));
		const keep = ranges.findIndex((r) => slice(text, r) === oursText);
		if (keep < 0) continue;
		const cut = ranges[1 - keep] as Rng;
		const held = ranges[keep] as Rng;
		if (busy(cut) || busy(held)) continue;
		const had = base.blocks.get(p);
		if (oursText === theirsText && !had) {
			cuts.push({ cut, conflict: null });
			continue;
		}
		const bl = had?.length === 1 ? linesOf(d.texts[0], had[0] as SyntaxNode) : null;
		cuts.push({
			cut,
			conflict: {
				subject: {
					kind: 'block',
					owner: d.naming.owner(os, d.texts[1]),
					change: had ? 'both-edited' : 'added-twice',
				},
				base: bl ? slice(d.texts[0], bl) : null,
				ours: oursText,
				theirs: theirsText,
				at: held,
				atOurs: ol,
				atBase: bl ?? baseAt(ol.from),
				both: false,
			},
		});
	}

	if (cuts.length === 0) return { text, conflicts: [...conflicts] };
	const removed = cuts.map((c) => c.cut).sort((x, y) => x.from - y.from);
	const shift = (pos: number): number =>
		pos - removed.reduce((n, r) => n + (r.to <= pos ? r.to - r.from : 0), 0);
	let out = '';
	let at = 0;
	for (const r of removed) {
		out += text.slice(at, r.from);
		at = r.to;
	}
	out += text.slice(at);
	const all = [...conflicts, ...cuts.flatMap((c) => (c.conflict ? [c.conflict] : []))]
		.map((c) => ({ ...c, at: { from: shift(c.at.from), to: shift(c.at.to) } }))
		.sort((x, y) => x.at.from - y.at.from);
	return { text: out, conflicts: all };
}
