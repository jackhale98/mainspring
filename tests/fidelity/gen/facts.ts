// SPDX-License-Identifier: GPL-2.0-or-later
// The oracle's view of a plan: the ranges and values of every element that the edit intents (phase-1.md
// 7.1) read or change. Two sources fill it in: the printer (gen/printer.ts) records it while it writes a
// generated plan, and tests/fidelity/oracle.ts reads it from the symbol index and the tree for corpus
// plans. Nothing here imports the edit code; the zones below are written from 7.1 and 7.2.

/** A range of one file, in the text it was recorded for. */
export interface Rg {
	readonly file: string;
	readonly from: number;
	readonly to: number;
}

/** One element of a declaration body: a statement or a child declaration. */
export interface Elem {
	readonly kind: 'stmt' | 'block';
	/** The statement's keyword; null for macro calls and statements the canonical order skips. */
	readonly key: string | null;
	readonly from: number;
	readonly to: number;
	/** `from`, or the start of the comment lines directly above it. */
	readonly start: number;
	/** Written with a scenario prefix. */
	readonly scoped?: boolean;
}

export interface BodyF {
	readonly file: string;
	/** Offset just after `{`. */
	readonly open: number;
	/** Offset of `}`. */
	readonly close: number;
	readonly elems: readonly Elem[];
}

export interface Gap {
	readonly kind: 'gapduration' | 'gaplength';
	readonly value: string;
}

/** A list item: a dependency, an allocation, a flag or a responsible resource. */
export interface ItemF {
	readonly written: string;
	/** The task or resource id it names, resolved; null when unknown. */
	readonly target: string | null;
	/** The reference token. */
	readonly at: Rg;
	/** The item with its `{ … }` body. */
	readonly range: Rg;
	readonly gap: Gap | null;
}

export interface StmtF {
	readonly key: string;
	readonly scenario: string | null;
	readonly site: 'decl' | 'supp';
	/** Reading order across files. */
	readonly seq: number;
	readonly range: Rg;
	readonly value: Rg | null;
	/** The value as written, trimmed. */
	readonly text: string;
	readonly items: readonly ItemF[] | null;
	/** Written with a macro call, so text-only (X3). */
	readonly macro: boolean;
	/** The body the statement sits in (null for a supplement's or other bodies we do not use). */
	readonly body: BodyF | null;
}

export interface TaskF {
	readonly id: string;
	readonly parent: string | null;
	readonly children: readonly string[];
	/** The name's string content, unquoted; null when the name is templated. */
	readonly name: string | null;
	readonly nameAt: Rg | null;
	readonly nameMacro: boolean;
	readonly seq: number;
	readonly block: Rg;
	/** The block's start including comment lines directly above. */
	readonly start: number;
	readonly body: BodyF | null;
	/** Own statements of the declaration and its supplements, in reading order. */
	readonly stmts: readonly StmtF[];
	/** Words of the macros called as statements in the declaration bodies. */
	readonly macroWords: ReadonlySet<string>;
}

/** The project header as facts: a task-like record, plus the tokens of its interval. */
export interface ProjF extends TaskF {
	readonly frameAt: { readonly start: Rg; readonly end: Rg } | null;
}

export interface Facts {
	readonly entry: string;
	readonly texts: Readonly<Record<string, string>>;
	readonly tasks: readonly TaskF[];
	readonly byId: ReadonlyMap<string, TaskF>;
	/** Resources in declaration order, with the same facts as a task (attributes, body, items). */
	readonly resTree: readonly TaskF[];
	readonly resById: ReadonlyMap<string, TaskF>;
	/** The project header: name, interval tokens, body and its statements. */
	readonly project: ProjF | null;
	/** File-level `leaves` and `vacation` statements, in reading order. */
	readonly globalLeaves: readonly StmtF[];
	/** Dates may be written without regard to a time zone (a generated plan runs in UTC). */
	readonly frameDates: boolean;
	readonly flagDecls: readonly StmtF[];
	/** The statements at file level, per file. */
	readonly topElems: Readonly<Record<string, readonly Elem[]>>;
	/** Macro bodies and calls: no edit may change text inside them. */
	readonly macroRanges: readonly Rg[];
	/** Text that `format` must not touch: strings and comments that span lines, macro bodies. */
	readonly noTouch: readonly Rg[];
	/** The project frame in epoch seconds, when known (dates an intent writes must lie inside it). */
	readonly frame: { readonly start: number; readonly end: number } | null;
}

/** Canonical statement order of 7.2 (tasks): lower ranks first. */
export const RANK: Readonly<Record<string, number>> = {
	note: 0,
	flags: 1,
	priority: 2,
	responsible: 3,
	start: 4,
	end: 5,
	minstart: 6,
	maxend: 7,
	scheduling: 8,
	milestone: 9,
	effort: 10,
	duration: 10,
	length: 10,
	depends: 11,
	precedes: 12,
	allocate: 13,
	complete: 14,
};
/** Canonical order of resource statements (7.2). */
export const RES_RANK: Readonly<Record<string, number>> = {
	email: 0,
	managers: 1,
	efficiency: 2,
	rate: 3,
	workinghours: 4,
	leaves: 5,
	vacation: 6,
};
/** Canonical order of project header statements (7.2). */
export const PROJ_RANK: Readonly<Record<string, number>> = {
	timezone: 0,
	timeformat: 1,
	currency: 2,
	now: 3,
	dailyworkinghours: 4,
	weekstartsmonday: 5,
	workinghours: 6,
};
export const SIZING = ['effort', 'length', 'duration'] as const;

// ---- text helpers (independent of edit/lines.ts) ----

export const lineStartOf = (t: string, p: number): number => {
	let i = p;
	while (i > 0 && t[i - 1] !== '\n' && t[i - 1] !== '\r') i--;
	return i;
};
export const lineEndOf = (t: string, p: number): number => {
	let i = p;
	while (i < t.length && t[i] !== '\n' && t[i] !== '\r') i++;
	return i;
};
const breakAt = (t: string, p: number): number =>
	t[p] === '\r' && t[p + 1] === '\n' ? 2 : t[p] === '\n' || t[p] === '\r' ? 1 : 0;
const breakBefore = (t: string, p: number): number =>
	t[p - 1] === '\n' && t[p - 2] === '\r' ? 2 : t[p - 1] === '\n' || t[p - 1] === '\r' ? 1 : 0;
const isHws = (c: string | undefined): boolean => c === ' ' || c === '\t';

export const rg = (file: string, from: number, to: number): Rg => ({ file, from, to });
const textOf = (f: Facts, file: string): string => f.texts[file] ?? '';

// ---- zones: where an edit of each kind may change text ----

/**
 * Where a new statement of `key` may go in `t`'s declaration (7.2): after the last ranked statement
 * of equal or lower rank, before the next ranked statement of higher rank or child, never between a
 * comment and the statement below it. Statements the canonical order skips are passed over. A task
 * without a body gets one at the end of its header.
 */
export function insertZone(f: Facts, t: TaskF, key: string, table = RANK): Rg[] {
	const file = t.block.file;
	if (!t.body) {
		const text = textOf(f, file);
		const end = lineEndOf(text, t.block.to);
		return [rg(file, t.block.to, end + breakAt(text, end))];
	}
	return [bodyInsertZone(t.body, table[key] ?? 99, table)];
}

export function bodyInsertZone(b: BodyF, rank: number, table = RANK): Rg {
	const ranked = (e: Elem): number | null =>
		e.kind === 'stmt' && e.key !== null ? (table[e.key] ?? null) : null;
	let last = -1;
	b.elems.forEach((e, i) => {
		const r = ranked(e);
		if (r !== null && r <= rank) last = i;
	});
	const from = last >= 0 ? (b.elems[last] as Elem).to : b.open;
	const next = b.elems.slice(last + 1).find((e) => e.kind === 'block' || (ranked(e) ?? -1) > rank);
	return rg(b.file, from, next ? next.start : b.close);
}

/** Where removing statement `s` may change text: the statement, its horizontal space, its line. */
export function removeZone(f: Facts, s: StmtF): Rg[] {
	const file = s.range.file;
	const text = textOf(f, file);
	let from = s.range.from;
	let to = s.range.to;
	while (isHws(text[from - 1])) from--;
	while (isHws(text[to])) to++;
	const out = [rg(file, from, to)];
	const ls = lineStartOf(text, s.range.from);
	const le = lineEndOf(text, s.range.to);
	if (
		/^[ \t]*$/.test(text.slice(ls, s.range.from)) &&
		/^[ \t]*$/.test(text.slice(s.range.to, le))
	) {
		out.push(rg(file, Math.max(0, ls - breakBefore(text, ls)), le + breakAt(text, le)));
	}
	return out;
}

/** Everything inside a list statement an item edit may change: the statement and its removal. */
export function stmtZone(f: Facts, s: StmtF): Rg[] {
	return [s.range, ...removeZone(f, s)];
}

/** After the last item of a list statement, up to the end of the statement. */
export function listEndZone(s: StmtF): Rg {
	const last = s.items?.[s.items.length - 1];
	return rg(s.range.file, last ? last.range.to : s.range.to, s.range.to);
}

/** The flags declaration `declareFlag` appends to, or the gap before the first task. */
export function declareFlagZone(f: Facts): Rg[] {
	const first = firstTask(f);
	if (!first) return [];
	const before = f.flagDecls.filter((d) => d.seq < first.seq);
	const last = before[before.length - 1];
	if (last) return [listEndZone(last)];
	const file = first.block.file;
	const tops = (f.topElems[file] ?? []).filter((e) => e.to <= first.start);
	const prev = tops[tops.length - 1];
	return [rg(file, prev ? prev.to : 0, first.start)];
}

export function firstTask(f: Facts): TaskF | null {
	return f.tasks.reduce<TaskF | null>((a, t) => (a === null || t.seq < a.seq ? t : a), null);
}

export * from './sem';
