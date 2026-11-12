// SPDX-License-Identifier: GPL-2.0-or-later
// The corpus oracle (phase-1.md 9.3 P1, 9.5): the facts the intent zones are computed from, read from
// the pre-edit symbol index and the tree, written from the 7.1 and 7.2 rules. It never imports the
// edit code. The same zone functions (gen/facts.ts) run over these facts and over the printer's
// record, so a rule is written once. The same reader also rebuilds the facts of the text after an
// edit (P3), where the semantics are compared (semOf).
import type { SyntaxNode } from '@lezer/common';
import { compareParseOrder } from '../../src/lib/workspace/include-order';
import type { WorkspaceSnapshot } from '../../src/lib/workspace/workspace';
import type { ChangeSet } from '@codemirror/state';
import type { ScheduleResult } from '../../src/engine/protocol';
import { hintsFromResult } from '../../src/lib/tjp/index';
import type {
	EngineHints,
	ResourceSymbol,
	SourceRange,
	SymbolIndex,
	TaskSymbol,
} from '../../src/lib/tjp/index';

type PropSymbol = TaskSymbol | ResourceSymbol;
import { bodyOf, statementKeyword, statementsIn } from '../../src/lib/tjp/tree';
import {
	normValue,
	type BodyF,
	type Elem,
	type Facts,
	type Gap,
	type ProjF,
	type ItemF,
	type Rg,
	type StmtF,
	type TaskF,
} from './gen/facts';

const rgOf = (r: SourceRange): Rg => ({ file: r.file, from: r.from, to: r.to });

/** First non-blank offset of the comment lines (`#`, `//`) directly above `from`, else `from`. */
export function attachedFrom(text: string, from: number): number {
	let start = from;
	let ls = from;
	while (ls > 0 && text[ls - 1] !== '\n' && text[ls - 1] !== '\r') ls--;
	// A statement that shares its line with something else has no comment lines of its own.
	if (!/^[ \t]*$/.test(text.slice(ls, from))) return from;
	for (;;) {
		if (ls === 0) return start;
		let pe = ls - 1;
		if (text[pe] === '\n' && text[pe - 1] === '\r') pe--;
		let ps = pe;
		while (ps > 0 && text[ps - 1] !== '\n' && text[ps - 1] !== '\r') ps--;
		const m = /^([ \t]*)(#|\/\/)/.exec(text.slice(ps, pe));
		if (!m) return start;
		start = ps + (m[1]?.length ?? 0);
		ls = ps;
	}
}

const BLOCKS = new Set([
	'TaskStatement',
	'ResourceStatement',
	'SupplementStatement',
	'ProjectStatement',
]);

function elemsOf(text: string, node: SyntaxNode): Elem[] {
	return statementsIn(node).map((n): Elem => {
		const block = BLOCKS.has(n.name);
		const key = block ? null : statementKeyword(n, text);
		const scoped = n.firstChild?.name === 'ScenarioPrefix';
		return {
			kind: block ? 'block' : 'stmt',
			key,
			from: n.from,
			to: n.to,
			start: attachedFrom(text, n.from),
			scoped,
		};
	});
}

function nodeAt(snap: WorkspaceSnapshot, r: SourceRange): SyntaxNode | null {
	const file = snap.files.get(r.file);
	if (!file) return null;
	for (let n: SyntaxNode | null = file.tree.resolveInner(r.from, 1); n; n = n.parent) {
		if (n.from === r.from && n.to === r.to) return n;
		if (n.from < r.from) break;
	}
	return null;
}

function bodyFacts(
	snap: WorkspaceSnapshot,
	texts: Record<string, string>,
	decl: SourceRange,
): BodyF | null {
	const node = nodeAt(snap, decl);
	const body = node && bodyOf(node);
	if (!body) return null;
	return {
		file: decl.file,
		open: body.from + 1,
		close: body.to - 1,
		elems: elemsOf(texts[decl.file] ?? '', body),
	};
}

const inside = (outer: SourceRange, r: SourceRange): boolean =>
	outer.file === r.file && outer.from <= r.from && r.to <= outer.to;

/** The gap of a `{ gapduration 2h }` item body, as the plan says it. */
export function gapOf(text: string): Gap | null {
	const m = /\b(gapduration|gaplength)\s+(\S+)/.exec(text);
	return m ? { kind: m[1] as Gap['kind'], value: m[2] as string } : null;
}

/** The facts of the workspace as the index sees it (the index must have been built from `snap`). */
export function factsFromIndex(snap: WorkspaceSnapshot, index: SymbolIndex): Facts {
	const texts: Record<string, string> = {};
	for (const [path, file] of snap.files) texts[path] = file.text.toString();
	const text = (r: SourceRange): string => (texts[r.file] ?? '').slice(r.from, r.to);

	// Reading order of every positioned thing.
	const positions: Array<{ file: string; from: number }> = [];
	const note = (r: SourceRange): void => void positions.push({ file: r.file, from: r.from });
	const seqs = new Map<string, number>();
	const key = (r: { file: string; from: number }): string => `${r.file}:${r.from}`;

	const itemsFor = (t: PropSymbol, stmt: SourceRange, kw: string): ItemF[] | null => {
		const mk = (
			written: string,
			target: string | null,
			at: SourceRange,
			range: SourceRange,
			gap: Gap | null,
		): ItemF => ({
			written,
			target,
			at: rgOf(at),
			range: rgOf(range),
			gap,
		});
		if (kw === 'depends' || kw === 'precedes') {
			return index.dependencies
				.filter(
					(d) =>
						d.form === kw && inside(stmt, d.item) && (kw === 'depends' ? d.succ : d.pred) === t.id,
				)
				.map((d) =>
					mk(
						d.written,
						(kw === 'depends' ? d.pred : d.succ) ?? d.written,
						d.ref,
						d.item,
						d.body ? gapOf(text(d.body)) : null,
					),
				);
		}
		if (kw === 'allocate') {
			return index.allocations
				.filter((a) => a.task === t.id && inside(stmt, a.item))
				.map((a) => mk(a.written, a.resource ?? a.written, a.ref, a.item, null));
		}
		if (kw === 'leaves' || kw === 'vacation') {
			return index.leaves
				.filter((l) => l.attr.statement.file === stmt.file && l.attr.statement.from === stmt.from)
				.flatMap((l) => l.items.map((i) => mk(text(i).trim(), text(i).trim(), i, i, null)));
		}
		if (kw === 'flags' || kw === 'responsible' || kw === 'managers') {
			return index.references
				.filter((r) => r.via === kw && inside(stmt, r.at))
				.map((r) => mk(r.written, r.target ?? r.written, r.at, r.at, null));
		}
		return null;
	};

	const stmtOf = (
		t: PropSymbol | null,
		a: PropSymbol['attrs'][number],
		body: BodyF | null,
	): StmtF => {
		const items = t ? itemsFor(t, a.statement, a.keyword) : null;
		note(a.statement);
		return {
			key: a.keyword,
			scenario: a.scenario,
			site: a.site === 'supplement' ? 'supp' : 'decl',
			seq: 0,
			range: rgOf(a.statement),
			value: a.value ? rgOf(a.value) : null,
			text: a.value ? text(a.value).trim() : '',
			items,
			macro: a.textOnly !== null,
			body: a.site === 'decl' ? body : null,
		};
	};

	const itemsOf = (st: StmtF): ItemF[] =>
		index.leaves
			.filter(
				(l) => l.attr.statement.file === st.range.file && l.attr.statement.from === st.range.from,
			)
			.flatMap((l) =>
				l.items.map((i) => ({
					written: text(i).trim(),
					target: text(i).trim(),
					at: rgOf(i),
					range: rgOf(i),
					gap: null,
				})),
			);
	const tasks: TaskF[] = [];
	const macros = (words: Set<string>, t: TaskSymbol): void => {
		for (const call of t.bodyMacroCalls) {
			const name = /\$\{\s*([A-Za-z_]\w*)/.exec(text(call))?.[1];
			for (const def of (name && index.macros.get(name)) || [])
				for (const w of def.words) words.add(w);
		}
	};
	for (const t of index.tasks.values()) {
		if (t.expandedOnly) continue;
		const body = bodyFacts(snap, texts, t.decl.block);
		note(t.decl.block);
		const words = new Set<string>();
		macros(words, t);
		const nameAt = t.decl.name ? rgOf(t.decl.name) : null;
		const nameMacro = nameAt ? index.blocking(nameAt.file, nameAt.from, nameAt.to) !== null : false;
		tasks.push({
			id: t.id,
			parent: t.parent,
			children: [...t.children],
			name: nameAt && !nameMacro ? normValue(text(nameAt)) : null,
			nameAt,
			nameMacro,
			seq: 0,
			block: rgOf(t.decl.block),
			start: t.decl.leadingComments
				? t.decl.leadingComments.from
				: attachedFrom(texts[t.decl.block.file] ?? '', t.decl.block.from),
			body,
			stmts: t.attrs.map((a) => stmtOf(t, a, body)),
			suppBlocks: t.supplements.map((d) => rgOf(d.block)),
			macroWords: words,
		});
	}
	const resTreeRaw: TaskF[] = [];
	for (const r of index.resources.values()) {
		if (r.expandedOnly) continue;
		const body = bodyFacts(snap, texts, r.decl.block);
		note(r.decl.block);
		const nameAt = r.decl.name ? rgOf(r.decl.name) : null;
		const nameMacro = nameAt ? index.blocking(nameAt.file, nameAt.from, nameAt.to) !== null : false;
		resTreeRaw.push({
			id: r.id,
			parent: r.parent,
			children: [...r.children],
			name: nameAt && !nameMacro ? normValue(text(nameAt)) : null,
			nameAt,
			nameMacro,
			seq: 0,
			block: rgOf(r.decl.block),
			start: r.decl.leadingComments
				? r.decl.leadingComments.from
				: attachedFrom(texts[r.decl.block.file] ?? '', r.decl.block.from),
			body,
			stmts: r.attrs.map((a) => stmtOf(r, a, body)),
			suppBlocks: r.supplements.map((d) => rgOf(d.block)),
			macroWords: new Set(),
		});
	}
	const pj = index.project;
	let projectRaw: ProjF | null = null;
	if (pj) {
		const body = bodyFacts(snap, texts, pj.decl.block);
		note(pj.decl.block);
		const nameAt = pj.decl.name ? rgOf(pj.decl.name) : null;
		let frameAt: ProjF['frameAt'] = null;
		if (pj.interval) {
			const m = /^(\S+)\s+(\S[\s\S]*)$/.exec(text(pj.interval));
			if (m) {
				const f0 = pj.interval.from;
				frameAt = {
					start: { file: pj.interval.file, from: f0, to: f0 + (m[1] as string).length },
					end: {
						file: pj.interval.file,
						from: pj.interval.to - (m[2] as string).length,
						to: pj.interval.to,
					},
				};
			}
		}
		projectRaw = {
			id: 'project',
			parent: null,
			children: [],
			name: nameAt ? normValue(text(nameAt)) : null,
			nameAt,
			nameMacro: pj.textOnly !== null,
			seq: 0,
			block: rgOf(pj.decl.block),
			start: attachedFrom(texts[pj.decl.block.file] ?? '', pj.decl.block.from),
			body,
			stmts: pj.attrs.map((a) => stmtOf(null, a, body)),
			macroWords: new Set(),
			frameAt,
		};
	}
	const globalLeavesRaw: StmtF[] = index.leaves
		.filter((l) => l.scope.kind === 'global')
		.map((l) => stmtOf(null, l.attr, null))
		.map((st) => ({ ...st, items: itemsOf(st) }));
	const flagDecls: StmtF[] = index.globalFlags.map((a) => {
		note(a.statement);
		// A global declaration names flags; it is not a reference, so read the ids from the value.
		const items: ItemF[] = [];
		if (a.value) {
			for (const m of text(a.value).matchAll(/[A-Za-z_][\w]*/g)) {
				const at = {
					file: a.value.file,
					from: a.value.from + (m.index ?? 0),
					to: a.value.from + (m.index ?? 0) + m[0].length,
				};
				items.push({ written: m[0], target: m[0], at: rgOf(at), range: rgOf(at), gap: null });
			}
		}
		return {
			key: 'flags',
			scenario: a.scenario,
			site: 'decl',
			seq: 0,
			range: rgOf(a.statement),
			value: a.value ? rgOf(a.value) : null,
			text: a.value ? text(a.value) : '',
			items,
			macro: a.textOnly !== null,
			body: null,
		};
	});

	positions.sort((x, y) => compareParseOrder(snap.includes, x, y));
	positions.forEach((p, i) => seqs.set(key(p), i));
	const seqOf = (r: Rg): number => seqs.get(key(r)) ?? 0;
	const withSeq = <T extends { range?: Rg; block?: Rg }>(x: T): number =>
		seqOf((x.range ?? x.block) as Rg);
	const fix = (s: StmtF): StmtF => ({ ...s, seq: withSeq(s) });
	const seqd = (t: TaskF): TaskF => ({ ...t, seq: seqOf(t.block), stmts: t.stmts.map(fix) });
	const fixed: TaskF[] = tasks.map(seqd);
	const resTree = resTreeRaw.map(seqd);
	const project = projectRaw ? { ...seqd(projectRaw), frameAt: projectRaw.frameAt } : null;

	const topElems: Record<string, Elem[]> = {};
	const macroRanges: Rg[] = [];
	const noTouch: Rg[] = [];
	for (const [path, file] of snap.files) {
		topElems[path] = elemsOf(texts[path] ?? '', file.tree.topNode);
		for (const r of index.textOnly(path)) {
			if (r.reason === 'macro-body' || r.reason === 'macro-call' || r.reason === 'env-var')
				macroRanges.push(rgOf(r.at));
			if (
				r.reason !== 'syntax-error' &&
				r.reason !== 'opaque' &&
				r.reason !== 'macro-id' &&
				r.reason !== 'auto-id'
			)
				noTouch.push(rgOf(r.at));
		}
		file.tree.iterate({
			enter(n) {
				const multi =
					(n.name === 'String' ||
						n.name === 'TemplateString' ||
						n.name === 'BlockComment' ||
						n.name === 'MacroBody') &&
					/[\r\n]/.test((texts[path] ?? '').slice(n.from, n.to));
				if (multi) noTouch.push({ file: path, from: n.from, to: n.to });
			},
		});
	}
	return {
		entry: snap.entry,
		texts,
		tasks: fixed,
		byId: new Map(fixed.map((t) => [t.id, t])),
		resTree,
		resById: new Map(resTree.map((r) => [r.id, r])),
		project,
		globalLeaves: globalLeavesRaw.map(fix),
		frameDates: false,
		flagDecls: flagDecls.map(fix),
		topElems,
		macroRanges,
		noTouch,
		frame:
			index.project && index.project.start !== null && index.project.end !== null
				? { start: index.project.start, end: index.project.end }
				: null,
	};
}

/**
 * The engine's hints for a plan (ids the text cannot name: macros, automatic ids), from the golden result of
 * the text that was scheduled. For the text after an edit, `changes` maps each hint's line through the edit;
 * a line the edit touched loses its hint, and a hint is only used while its line reads as it was scheduled.
 */
export function goldenHints(
	result: Omit<ScheduleResult, 'revision' | 'timings'>,
	before: WorkspaceSnapshot,
	after?: { snap: WorkspaceSnapshot; changes: Readonly<Record<string, ChangeSet>> },
): EngineHints {
	const lines = (snap: WorkspaceSnapshot, file: string): string[] =>
		snap.files.get(file)?.text.toString().split('\n') ?? [];
	const mapLine = (file: string, line: number): number | null => {
		if (!after) return line;
		const cs = after.changes[file];
		if (!cs) return line;
		const old = lines(before, file);
		let touched = false;
		const from = old.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
		const to = from + (old[line - 1]?.length ?? 0);
		cs.iterChangedRanges((a, b) => {
			if (a <= to && b >= from) touched = true;
		});
		if (touched) return null;
		const pos = cs.mapPos(from, 1);
		return after.snap.files.get(file)?.text.lineAt(pos).number ?? null;
	};
	return hintsFromResult(
		result as ScheduleResult,
		mapLine,
		(file, line) => lines(before, file)[line - 1] ?? null,
	);
}
