// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * No silent duplicates (phase-4.md 6.4 rule 3; types.ts): a task or resource that both sides
 * added (or moved) to different places of one file merges as two clean hunks on lines, and the
 * merged file would declare it twice, which TaskJuggler refuses. After the merge, a declaration
 * path (the keys of the declaration and its enclosing ones) that the merged file holds twice while
 * each side holds it once is one `block` conflict: `added-twice` (or `both-edited` when the base
 * had it), held at ours' copy, with theirs' copy taken out of the merged text. Identical new
 * copies keep ours' alone, cleanly; identical moved ones are still a conflict (where it goes).
 *
 * Only a merge where both sides added lines that look like the same declaration is checked
 * (`mayDouble`), so other merges parse nothing more. Declarations in different files are left to
 * the engine, which reports a duplicate id (mergeFile sees one file).
 */
import type { LRParser } from '@lezer/lr';
import type { SyntaxNode, Tree } from '@lezer/common';
import { statementsIn } from '../tree';
import { blockKind, statementKey, type Naming } from './hints';
import { lineStarts, type Region } from './lines';
import type { Pending, Rng } from './out';
import type { Tri } from './emit';

const DECL = /\b(?:task|resource)[ \t]+([A-Za-z_][\w.]*)/g;

function signatures(lines: readonly string[], from: number, to: number, into: Set<string>): void {
	for (let i = from; i < to; i++) {
		for (const m of (lines[i] as string).matchAll(DECL)) into.add(m[0].replace(/\s+/, ' '));
	}
}

/** Whether both sides added lines that look like the same declaration. */
export function mayDouble(lines: Tri<string[]>, regions: readonly Region[]): boolean {
	const ours = new Set<string>();
	const theirs = new Set<string>();
	for (const r of regions) {
		if (r.kind === 'ours' || r.kind === 'conflict') signatures(lines[1], r.a[0], r.a[1], ours);
		if (r.kind === 'theirs' || r.kind === 'conflict') signatures(lines[2], r.b[0], r.b[1], theirs);
	}
	for (const s of ours) if (theirs.has(s)) return true;
	return false;
}

/** Task and resource declarations with a key, by their path of keys. */
function paths(tree: Tree, text: string): Map<string, SyntaxNode[]> {
	const out = new Map<string, SyntaxNode[]>();
	const walk = (node: SyntaxNode, path: string): void => {
		for (const st of statementsIn(node)) {
			const kind = blockKind(st);
			if (!kind || kind === 'project') continue;
			const key = statementKey(st, text);
			if (key === null || (kind !== 'supplement' && !st.getChild('Id'))) continue;
			const p = `${path}/${key}`;
			const list = out.get(p);
			if (list) list.push(st);
			else out.set(p, [st]);
			const body = st.getChild('Body');
			if (body) walk(body, p);
		}
	};
	walk(tree.topNode, '');
	return out;
}

/** The statement's lines when it has them to itself, else the statement. */
function linesOf(text: string, st: SyntaxNode): Rng {
	const ls = text.lastIndexOf('\n', st.from - 1) + 1;
	const nl = text.indexOf('\n', st.to);
	const le = nl < 0 ? text.length : nl + 1;
	const before = text.slice(ls, st.from).trim() === '';
	const after = /^[ \t\r]*(#[^\n]*)?\n?$/.test(text.slice(st.to, le));
	return before && after ? { from: ls, to: le } : { from: st.from, to: st.to };
}

export interface Dedupe {
	readonly parser: LRParser;
	readonly naming: Naming;
	/** Base, ours, theirs; trees are parsed when missing. */
	readonly texts: Tri<string>;
	readonly trees: Tri<Tree | null>;
	readonly lines: Tri<string[]>;
	readonly regions: readonly Region[];
}

/** The merged text and conflicts without silent duplicates (module comment). */
export function dedupe(
	d: Dedupe,
	text: string,
	conflicts: readonly Pending[],
): { text: string; conflicts: Pending[] } {
	const tree = (i: 0 | 1 | 2): Tree => d.trees[i] ?? d.parser.parse(d.texts[i]);
	const [base, ours, theirs] = [
		paths(tree(0), d.texts[0]),
		paths(tree(1), d.texts[1]),
		paths(tree(2), d.texts[2]),
	];
	const merged = paths(d.parser.parse(text), text);
	const cuts: Array<{ cut: Rng; conflict: Pending | null }> = [];
	const busy = (r: Rng): boolean =>
		conflicts.some((c) => c.at.from < r.to && r.from < c.at.to) ||
		cuts.some((c) => c.cut.from < r.to && r.from < c.cut.to);
	for (const [p, copies] of merged) {
		const o = ours.get(p);
		const t = theirs.get(p);
		if (copies.length !== 2 || o?.length !== 1 || t?.length !== 1) continue;
		const os = o[0] as SyntaxNode;
		const ts = t[0] as SyntaxNode;
		const ol = linesOf(d.texts[1], os);
		const tl = linesOf(d.texts[2], ts);
		const oursText = d.texts[1].slice(ol.from, ol.to);
		const theirsText = d.texts[2].slice(tl.from, tl.to);
		const ranges: Rng[] = copies.map((c) => linesOf(text, c));
		const keep = ranges.findIndex((r) => text.slice(r.from, r.to) === oursText);
		if (keep < 0) continue;
		const cut = ranges[1 - keep] as Rng;
		const held = ranges[keep] as Rng;
		if (busy(cut) || busy(held)) continue;
		if (oursText === theirsText && !base.has(p)) {
			cuts.push({ cut, conflict: null });
			continue;
		}
		const so = lineStarts(d.lines[0]);
		const sa = lineStarts(d.lines[1]);
		const line = sa.findIndex((x) => x > ol.from) - 1;
		const reg = d.regions.find((r) => r.a[0] <= line && line < r.a[1]);
		const at0 = reg ? (so[reg.o[0]] as number) : 0;
		cuts.push({
			cut,
			conflict: {
				subject: {
					kind: 'block',
					owner: d.naming.owner(os, d.texts[1]),
					change: base.has(p) ? 'both-edited' : 'added-twice',
				},
				base: null,
				ours: oursText,
				theirs: theirsText,
				at: held,
				atOurs: ol,
				atBase: { from: at0, to: at0 },
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
