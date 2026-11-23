// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * No silent duplicates (phase-4.md 6.4 rule 3; types.ts). Edits both sides made at different
 * lines merge as separate clean hunks, so the merged file can say one thing twice:
 *
 * - **A block** (task, resource) both sides added, or moved, to different places: TaskJuggler
 *   refuses the second declaration. A declaration path (the keys of the declaration and its
 *   enclosing ones; a resource's id alone, as resource ids are global, TjpSyntaxRules.rb 4796-4810)
 *   that the merged file holds twice while each side holds it once is one `block` conflict,
 *   `added-twice`, or `both-edited` when the base had it (with the base's block), held at ours'
 *   copy, with theirs' copy taken out.
 * - **A single-valued statement** (keywords.ts: `priority`, `start`, `rate`, `timezone`, a sizing
 *   criterion …) both sides added at different lines of one block: TaskJuggler keeps the later
 *   one, with at most an `attr_overwrite` warning. A value slot that a merged block holds more
 *   often than either side does is one `attribute` conflict held at ours' statement, theirs' taken
 *   out.
 * - **A repeatable statement** (`depends`, `allocate`, `flags` …) added alike on both sides: the
 *   merged block keeps it once (the user's decision, types.ts rule 3).
 *
 * Identical new copies keep ours' alone, cleanly; an identical moved block is still a conflict
 * (where it goes). Only a merge where both sides added lines with a common declaration or keyword
 * in the same block (by a quick brace scan) is checked (`mayDouble`), so other merges parse
 * nothing more. Declarations in different files
 * are left to the engine, which reports a duplicate id (mergeFile sees one file).
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { statementsIn } from '../tree';
import { attrName, blockKind, statementKey, type Naming } from './hints';
import { keywordOf, repeatable, slotOf } from './keywords';
import { lineStarts, type Region } from './lines';
import type { Pending, Rng } from './out';
import type { Tri } from './emit';

const DECL = /\b(?:task|resource)[ \t]+[A-Za-z_][\w.]*/g;
const WORD = /(?:^|[\s{;,])((?:[A-Za-z_]\w*:)?[a-z]+)\b/g;
const SIZING = /(^|:)(effort|duration|length|milestone)$/;

function signatures(
	lines: readonly string[],
	from: number,
	to: number,
	block: (line: number) => string,
	into: Set<string>,
): void {
	for (let i = from; i < to; i++) {
		const l = lines[i] as string;
		for (const m of l.matchAll(DECL)) into.add(`\u0001${m[0].replace(/\s+/, ' ')}`);
		const b = block(i);
		for (const m of l.matchAll(WORD)) {
			into.add(`${b}|${(m[1] as string).replace(SIZING, '$1sizing')}`);
		}
	}
}

/**
 * For each line, the line where the innermost `{` open at its start is (-1 at the top level). A
 * quick scan, not a parse: strings, comments and macro bodies (`[ … ]`) are skipped; a scan that
 * does not come out balanced gives null.
 */
export function openBraces(lines: readonly string[]): number[] | null {
	const out: number[] = [];
	const stack: number[] = [];
	let quote = '';
	let block = false;
	let macro = 0;
	lines.forEach((line, n) => {
		out.push(stack[stack.length - 1] ?? -1);
		for (let i = 0; i < line.length; i++) {
			const ch = line[i] as string;
			if (block) {
				if (ch === '*' && line[i + 1] === '/') {
					block = false;
					i++;
				}
			} else if (quote) {
				if (ch === '\\') i++;
				else if (ch === quote) quote = '';
			} else if (ch === '#' || (ch === '/' && line[i + 1] === '/')) break;
			else if (ch === '/' && line[i + 1] === '*') {
				block = true;
				i++;
			} else if (ch === '"' || ch === "'") quote = ch;
			else if (ch === '[') macro++;
			else if (ch === ']') macro = Math.max(0, macro - 1);
			else if (macro > 0) continue;
			else if (ch === '{') stack.push(n);
			else if (ch === '}') stack.pop();
		}
	});
	return stack.length === 0 && !quote && !block && macro === 0 ? out : null;
}

/** The block each line of a side lies in, named by its header's first two words ('' on top). */
function blocksOf(lines: readonly string[]): (line: number) => string {
	const braces = openBraces(lines);
	if (!braces) return () => '?';
	return (line) => {
		const at = braces[line] ?? -1;
		if (at < 0) return '';
		return (lines[at] as string).trim().split(/\s+/).slice(0, 2).join(' ');
	};
}

/**
 * Whether both sides added lines with a declaration in common, or with a keyword in common in
 * blocks of the same header (module comment). Lines both sides added to different blocks cannot
 * say one thing twice in a block, so such merges parse nothing more.
 */
/** What the duplicate pass looks at (`mayDouble`): declarations, and blocks by their header. */
export interface Doubt {
	readonly decls: boolean;
	/** Header names (`task a`; '' for the top level) of blocks both sides added keywords to. */
	readonly blocks: ReadonlySet<string>;
}

export function mayDouble(lines: Tri<string[]>, regions: readonly Region[]): Doubt | null {
	const ours = new Set<string>();
	const theirs = new Set<string>();
	const inOurs = blocksOf(lines[1]);
	const inTheirs = blocksOf(lines[2]);
	for (const r of regions) {
		if (r.kind === 'ours' || r.kind === 'conflict') {
			signatures(lines[1], r.a[0], r.a[1], inOurs, ours);
		}
		if (r.kind === 'theirs' || r.kind === 'conflict') {
			signatures(lines[2], r.b[0], r.b[1], inTheirs, theirs);
		}
	}
	let decls = false;
	const blocks = new Set<string>();
	for (const x of ours) {
		if (!theirs.has(x)) continue;
		if (x.startsWith('\u0001')) decls = true;
		else blocks.add(x.slice(0, x.lastIndexOf('|')));
	}
	return decls || blocks.size > 0 ? { decls, blocks } : null;
}

interface Facts {
	/** Task and resource declarations by path. */
	readonly blocks: Map<string, SyntaxNode[]>;
	/** Per block path ('' for the file), its direct statements by value slot. */
	readonly slots: Map<string, Map<string, SyntaxNode[]>>;
	/** The block of each path (null for the file). */
	readonly owners: Map<string, SyntaxNode | null>;
}

/** The header name of a block statement, as `blocksOf` reads it from its `{` line. */
function headerOf(st: SyntaxNode, text: string): string {
	const open = st.getChild('Body')?.firstChild;
	if (!open) return '';
	const from = text.lastIndexOf('\n', open.from - 1) + 1;
	return text.slice(from, open.from).trim().split(/\s+/).slice(0, 2).join(' ');
}

/** The facts the pass needs: block paths when declarations are in doubt, slots of doubted blocks. */
function factsOf(tree: Tree, text: string, doubt: Doubt): Facts {
	const blocks = new Map<string, SyntaxNode[]>();
	const slots = new Map<string, Map<string, SyntaxNode[]>>();
	const owners = new Map<string, SyntaxNode | null>([['', null]]);
	const all = doubt.blocks.has('?');
	const push = <K, V>(m: Map<K, V[]>, k: K, v: V): void => {
		const list = m.get(k);
		if (list) list.push(v);
		else m.set(k, [v]);
	};
	const walk = (node: SyntaxNode, path: string, header: string): void => {
		const wanted = all || doubt.blocks.has(header);
		const mine = new Map<string, SyntaxNode[]>();
		if (wanted) slots.set(path, mine);
		for (const st of statementsIn(node)) {
			const kind = blockKind(st);
			if (!kind) {
				if (!wanted) continue;
				const slot = slotOf(st, text);
				if (slot !== null) push(mine, slot, st);
				continue;
			}
			const body = st.getChild('Body');
			if (!doubt.decls && !body) continue;
			const key = statementKey(st, text);
			const named = kind === 'project' || kind === 'supplement' || !!st.getChild('Id');
			if (key === null || !named) continue;
			const p = kind === 'resource' ? `resource:${key}` : `${path}/${key}`;
			if (doubt.decls && (kind === 'task' || kind === 'resource')) push(blocks, p, st);
			owners.set(p, st);
			if (body) walk(body, p, headerOf(st, text));
		}
	};
	walk(tree.topNode, '', '');
	return { blocks, slots, owners };
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
	doubt: Doubt,
	text: string,
	tree: Tree,
	conflicts: readonly Pending[],
): Generator<void, { text: string; conflicts: Pending[] }, void> {
	const facts: Facts[] = [];
	for (const i of [0, 1, 2] as const) {
		facts.push(factsOf(d.trees[i], d.texts[i], doubt));
		yield;
	}
	const [base, ours, theirs] = facts as [Facts, Facts, Facts];
	const merged = factsOf(tree, text, doubt);
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

	for (const [p, mine] of merged.slots) {
		for (const [slot, copies] of mine) {
			const o = ours.slots.get(p)?.get(slot) ?? [];
			const t = theirs.slots.get(p)?.get(slot) ?? [];
			if (copies.length <= Math.max(o.length, t.length)) continue;
			const first = copies[0] as SyntaxNode;
			const said = (n: SyntaxNode, from: string): string => slice(from, n);
			if (repeatable(keywordOf(first, text))) {
				// Identical additions collapse to one; different ones add to each other.
				const seen = new Map<string, number>();
				const most = (s: string): number =>
					Math.max(
						o.filter((n) => said(n, d.texts[1]) === s).length,
						t.filter((n) => said(n, d.texts[2]) === s).length,
					);
				for (const c of copies) {
					const s = said(c, text);
					const n = (seen.get(s) ?? 0) + 1;
					seen.set(s, n);
					const cut = linesOf(text, c);
					if (n > most(s) && !busy(cut)) cuts.push({ cut, conflict: null });
				}
				continue;
			}
			if (o.length !== 1 || t.length !== 1 || copies.length !== 2) continue;
			const os = o[0] as SyntaxNode;
			const ts = t[0] as SyntaxNode;
			const oursText = said(os, d.texts[1]);
			const theirsText = said(ts, d.texts[2]);
			const keep = copies.findIndex((c) => said(c, text) === oursText);
			if (keep < 0) continue;
			const held = copies[keep] as SyntaxNode;
			const cut = linesOf(text, copies[1 - keep] as SyntaxNode);
			if (busy(cut) || busy(held)) continue;
			if (oursText === theirsText) {
				cuts.push({ cut, conflict: null });
				continue;
			}
			const had = base.slots.get(p)?.get(slot);
			const bs = had?.length === 1 ? (had[0] as SyntaxNode) : null;
			const names = [attrName(os, d.texts[1]), attrName(ts, d.texts[2])].sort();
			const owner = ours.owners.get(p) ?? null;
			cuts.push({
				cut,
				conflict: {
					subject: {
						kind: 'attribute',
						owner: d.naming.owner(owner, d.texts[1]),
						attr:
							names[0] === names[1]
								? (names[0] as string)
								: bs
									? attrName(bs, d.texts[0])
									: (names[0] as string),
					},
					base: bs ? said(bs, d.texts[0]) : null,
					ours: oursText,
					theirs: theirsText,
					at: { from: held.from, to: held.to },
					atOurs: { from: os.from, to: os.to },
					atBase: bs ? { from: bs.from, to: bs.to } : baseAt(os.from),
					both: false,
				},
			});
		}
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
