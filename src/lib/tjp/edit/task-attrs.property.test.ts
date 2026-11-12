// SPDX-License-Identifier: GPL-2.0-or-later
// Task attribute intents over the corpora (phase-1.md 9.3 P1, P2, P3, P5, P6, text only): random
// setAttr (values, dates, flags, responsible, milestone), removeAttr, renameTask and declareFlag
// intents on random tasks of every golden plan and T16 fixture (CRLF, lone CR, tabs,
// supplements, scenario prefixes, macros, prefixed includes), some aimed at text-only elements.
// The oracle reads the pre-edit text through its own parse, not through the edit code:
// - P1: an edit changes text only inside its declared targets, and every target lies in a
//   statement the intent edits (the task's top-scenario statements of the attribute; for sizing,
//   of any criterion; for a list, of that list), in a gap between the statements of the task's
//   declaration body (an insertion point), the name token, or, for declareFlag, a file-level
//   `flags` declaration read before the first task or the gap before that task;
// - P2: the new text has no new error nodes; P6: the inverse restores the base byte for byte;
// - P3: a fresh parse of the new text reads the intended value: the last top-scenario statement
//   of the attribute (sizing: every criterion has the new keyword), exactly the requested ids in
//   the task's own lists, no own statement after removeAttr, the new name, the flag declared
//   before the first task;
// - P5: refusals and no-ops change nothing, intents aimed at text-only elements (a task declared
//   only by expansion, a statement written with a macro, a templated name) are always refused,
//   and edits never touch a macro node (touchedMacro).
import type { SyntaxNode } from '@lezer/common';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareParseOrder } from '../../workspace/include-order';
import { createWorkspace, type WorkspaceSnapshot } from '../../workspace/workspace';
import { createFile, syntaxIssues, type TjpFile } from '../document';
import { buildIndex, type SourceRange, type SymbolIndex, type TaskSymbol } from '../index';
import { bodyOf, statementsIn } from '../tree';
import { KEYWORD_VALUE_KIND, parseString, parseValue, sameValue } from '../values';
import { applyIntent } from './apply';
import { touchedMacro } from './oracle';
import {
	attrCorpora,
	intentFor,
	loadCorpus,
	textOnlyTasks,
	type AttrCorpus as Corpus,
} from './task-attrs-testing';
import type { EditIntent, EditResult, Span } from './types';

/**
 * Small plans that the corpora lack: lists over own statements, supplements and ancestors, other
 * scenarios' statements, and direction set by start, end, depends, precedes and scheduling.
 */
const INLINE: Readonly<Record<string, string>> = {
	lists:
		'project p "P" 2026-01-05 +2m\nresource r "R"\nresource q "Q"\nflags hot, cold, warm, urgent\n' +
		'task par "Par" {\n  flags warm\n  responsible q\n  task a "A" {\n    flags hot\n' +
		'    responsible r\n    effort 1d\n    allocate r\n    flags cold\n  }\n' +
		'  task b "B" {\n    start 2026-01-06\n  }\n}\n' +
		'supplement task par.a {\n  flags warm\n  responsible q\n}\n',
	scenarios:
		'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario late "Late"\n  }\n}\n' +
		'resource r "R"\nflags hot\n' +
		'task a "A" {\n  late:priority 800\n  late:start 2026-01-12\n  late:length 2d\n  allocate r\n}\n' +
		'task m "M" {\n  start 2026-01-06\n  late:milestone\n  late:flags hot\n}\n' +
		'task b "B" {\n  start 2026-01-06\n  late:effort 2d\n  allocate r\n}\n',
	direction:
		'project p "P" 2026-01-05 +2m\nresource r "R"\n' +
		'task x "X" { start 2026-01-20 length 1d }\n' +
		'task a "A" {\n  length 2d\n  precedes x\n}\n' +
		'task b "B" {\n  depends x\n  end 2026-02-20\n}\n' +
		'task d "D" {\n  scheduling alap\n  task e "E" {\n    depends x\n    effort 1d\n    allocate r\n  }\n' +
		'  task m "M" {\n    start 2026-01-06\n    milestone\n  }\n}\n' +
		'task k "K" {\n  start 2026-01-05\n  allocate r\n  booking r 2026-01-05-09:00 +2h\n}\n',
};

const GOLDEN = attrCorpora();
const FIRST_INLINE = GOLDEN.length;
const CORPUS = [
	...GOLDEN,
	...Object.entries(INLINE).map(([name, text]) =>
		loadCorpus(`inline:${name}`, 'plan.tjp', { 'plan.tjp': text }),
	),
];
const SIZING = ['effort', 'length', 'duration'];
const TEXT_ONLY = CORPUS.filter((c) => textOnlyTasks(c).length > 0);
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

/** Whether the union of `outer` covers `r` (adjacent changes coalesce into one range). */
function within(r: Span, outer: readonly Span[]): boolean {
	let at = r.from;
	for (const o of [...outer].sort((a, b) => a.from - b.from)) {
		if (o.from <= at && o.to >= at) at = Math.max(at, o.to);
	}
	return at >= r.to && outer.some((o) => o.from <= r.from && r.from <= o.to);
}

/** The syntax node spanning exactly `r`, or null. */
function nodeAt(file: TjpFile, r: Span): SyntaxNode | null {
	for (let n: SyntaxNode | null = file.tree.resolveInner(r.from, 1); n; n = n.parent) {
		if (n.from === r.from && n.to === r.to) return n;
		if (n.from < r.from) break;
	}
	return null;
}

/** One statement of a task body as the oracle reads it from the text. */
interface Stmt {
	readonly keyword: string;
	readonly scenario: string | null;
	readonly value: string;
	readonly at: SourceRange;
}

const STMT = /^(?:([A-Za-z_]\w*):)?([A-Za-z_]\w*)\s*([\s\S]*)$/;

/** The statements of a declaration or supplement body, read from the text. */
function bodyStatements(snap: WorkspaceSnapshot, block: SourceRange): Stmt[] {
	const file = snap.files.get(block.file);
	const node = file && nodeAt(file, block);
	const body = node && bodyOf(node);
	if (!file || !body) return [];
	return statementsIn(body).flatMap((n) => {
		const m = STMT.exec(file.text.sliceString(n.from, n.to));
		if (!m) return [];
		const at = { file: block.file, from: n.from, to: n.to };
		return [{ scenario: m[1] ?? null, keyword: m[2] ?? '', value: m[3]?.trim() ?? '', at }];
	});
}

/** The task's own top-scenario statements of `keywords`, in reading order. */
function own(
	snap: WorkspaceSnapshot,
	index: SymbolIndex,
	sym: TaskSymbol,
	keywords: readonly string[],
): Stmt[] {
	const top = index.scenarios[0]?.id ?? null;
	return [sym.decl.block, ...sym.supplements.map((s) => s.block)]
		.flatMap((b) => bodyStatements(snap, b))
		.filter((s) => keywords.includes(s.keyword) && (s.scenario === null || s.scenario === top));
}

/**
 * Whether a top-scenario statement of `keywords` is read after another scenario's: TaskJuggler
 * then copies the top value over the other scenario's (for criteria and milestones, any of them).
 */
function overwrites(
	snap: WorkspaceSnapshot,
	index: SymbolIndex,
	sym: TaskSymbol,
	keywords: readonly string[],
): boolean {
	const top = index.scenarios[0]?.id ?? null;
	const all = [sym.decl.block, ...sym.supplements.map((s) => s.block)]
		.flatMap((b) => bodyStatements(snap, b))
		.filter((s) => keywords.includes(s.keyword));
	const first = all.findIndex((s) => s.scenario !== null && s.scenario !== top);
	return first >= 0 && all.slice(first).some((s) => s.scenario === null || s.scenario === top);
}

/** The keywords whose statements an intent may rewrite or remove. */
function edited(intent: EditIntent): string[] {
	if (intent.type !== 'setAttr' && intent.type !== 'removeAttr') return [];
	if (SIZING.includes(intent.attr)) return SIZING;
	return [intent.attr];
}

const lines = (text: string, s: Span): Span => {
	let from = s.from;
	while (from > 0 && text[from - 1] !== '\n' && text[from - 1] !== '\r') from--;
	let to = s.to;
	while (to < text.length && text[to] !== '\n' && text[to] !== '\r') to++;
	if (text.startsWith('\r\n', to)) to += 2;
	else if (to < text.length) to++;
	return { from, to };
};

/** The gaps between the statements of a declaration body (or after a header without one). */
function gaps(c: Corpus, block: SourceRange): Span[] {
	const file = c.snap.files.get(block.file);
	const node = file && nodeAt(file, block);
	if (!file || !node) return [];
	const text = file.text.toString();
	const body = bodyOf(node);
	if (!body) return [{ from: block.to, to: lines(text, { from: block.to, to: block.to }).to }];
	const stmts = statementsIn(body);
	const open = body.firstChild?.to ?? body.from;
	const close = body.lastChild?.from ?? body.to;
	const edges = [open, ...stmts.flatMap((s) => [s.from, s.to]), close];
	const out: Span[] = [];
	for (let i = 0; i + 1 < edges.length; i += 2) {
		out.push({ from: edges[i] ?? 0, to: edges[i + 1] ?? 0 });
	}
	return out;
}

/** The first task's declaration, by reading order. */
function firstTask(c: { index: SymbolIndex }): TaskSymbol | undefined {
	return c.index.tasks.get(c.index.taskRoots[0] ?? '');
}

/** The regions an intent may change, per file, from the pre-edit text (module comment). */
function regions(c: Corpus, intent: EditIntent): Map<string, Span[]> {
	const out = new Map<string, Span[]>();
	const add = (file: string, s: Span, whole = true): void => {
		const text = c.snap.files.get(file)?.text.toString() ?? '';
		out.set(file, [...(out.get(file) ?? []), whole ? lines(text, s) : s]);
	};
	if (intent.type === 'declareFlag') {
		const first = firstTask(c);
		for (const f of c.index.globalFlags) {
			const early = !first || compareParseOrder(c.snap.includes, f.statement, first.decl.block) < 0;
			if (early) add(f.statement.file, f.statement);
		}
		if (first) {
			const b = first.decl.block;
			const top = c.snap.files.get(b.file)?.tree.topNode;
			let p = 0;
			for (let n = top?.firstChild; n && n.to <= b.from; n = n.nextSibling) {
				if (n.name.endsWith('Statement')) p = n.to;
			}
			add(b.file, { from: p, to: b.from }, false);
		}
		return out;
	}
	if (!('task' in intent)) return out;
	const sym = c.index.tasks.get(intent.task);
	if (!sym) return out;
	if (intent.type === 'renameTask') {
		if (sym.decl.name) add(sym.decl.name.file, sym.decl.name, false);
		return out;
	}
	if (intent.type !== 'setAttr' && intent.type !== 'removeAttr') return out;
	for (const s of own(c.snap, c.index, sym, edited(intent))) add(s.at.file, s.at);
	if (intent.type === 'setAttr') {
		for (const g of gaps(c, sym.decl.block)) add(sym.decl.block.file, g, false);
	}
	return out;
}

/** Whether the intent is aimed at a text-only element (P5). */
function textOnlyTarget(c: Corpus, intent: EditIntent): boolean {
	if (!('task' in intent)) return false;
	const sym = c.index.tasks.get(intent.task);
	if (!sym) return false;
	if (sym.expandedOnly) return true;
	if (intent.type === 'renameTask') {
		const n = sym.decl.name;
		return n !== null && c.index.blocking(n.file, n.from, n.to) !== null;
	}
	if (intent.type !== 'setAttr' && intent.type !== 'removeAttr') return false;
	const top = c.index.scenarios[0]?.id ?? null;
	const keys = edited(intent);
	return sym.attrs.some(
		(a) => keys.includes(a.keyword) && (a.scenario === null || a.scenario === top) && a.textOnly,
	);
}

/** Ids of a list value as written (`a, b` → [a, b]). */
const ids = (value: string): string[] =>
	value
		.split(',')
		.map((x) => x.trim())
		.filter((x) => x !== '');

/** P3: the fresh parse of the new text reads what the intent asked for. */
function readBack(c: Corpus, intent: EditIntent, snap: WorkspaceSnapshot): void {
	const index = buildIndex(snap);
	if (intent.type === 'declareFlag') {
		const at = index.flags.get(intent.flag);
		const first = firstTask({ index });
		expect(at).toBeDefined();
		if (at && first) {
			expect(compareParseOrder(snap.includes, at, first.decl.block)).toBeLessThan(0);
		}
		return;
	}
	if (!('task' in intent)) return;
	const sym = index.tasks.get(intent.task);
	expect(sym, `${c.name} ${intent.task}`).toBeDefined();
	if (!sym) return;
	if (intent.type === 'renameTask') {
		const n = sym.decl.name;
		const written = n && snap.files.get(n.file)?.text.sliceString(n.from, n.to);
		const parsed = written ? parseString(written) : null;
		expect(parsed?.ok && parsed.value).toBe(intent.name);
		return;
	}
	if (intent.type !== 'setAttr' && intent.type !== 'removeAttr') return;
	const label = `${c.name} ${JSON.stringify(intent)}`;
	const pre = c.index.tasks.get(intent.task);
	const guard = [...SIZING, 'milestone'].includes(intent.attr)
		? [...SIZING, 'milestone']
		: [intent.attr];
	if (intent.type === 'setAttr' && pre && !overwrites(c.snap, c.index, pre, guard)) {
		expect(overwrites(snap, index, sym, guard), `${label} other scenarios`).toBe(false);
	}
	const stmts = own(snap, index, sym, [intent.attr]);
	if (intent.type === 'removeAttr' || intent.value === false) {
		expect(stmts, label).toEqual([]);
		return;
	}
	const last = stmts[stmts.length - 1];
	expect(last, label).toBeDefined();
	if (!last) return;
	if (Array.isArray(intent.value)) {
		const got = new Set(stmts.flatMap((s) => ids(s.value)));
		expect([...got].sort(), label).toEqual([...new Set(intent.value)].sort());
		return;
	}
	if (typeof intent.value !== 'string') return;
	const kind = KEYWORD_VALUE_KIND[intent.attr];
	const want = kind ? parseValue(kind, intent.value) : null;
	const got = kind ? parseValue(kind, last.value) : null;
	expect(want?.ok && got?.ok && sameValue(want.value, got.value), label).toBe(true);
	if (SIZING.includes(intent.attr)) {
		const sizing = own(snap, index, sym, SIZING);
		expect(
			sizing.every((s) => s.keyword === intent.attr),
			label,
		).toBe(true);
	}
}

function check(c: Corpus, intent: EditIntent, r: EditResult): void {
	if (textOnlyTarget(c, intent)) {
		expect(r.status, `${c.name} ${JSON.stringify(intent)} text-only`).toBe('refused');
	}
	if (r.status !== 'edit') return;
	const files = new Map<string, string>();
	const allowed = regions(c, intent);
	for (const [p, f] of c.snap.files) files.set(p, f.text.toString());
	for (const [p, cs] of Object.entries(r.edit.changes)) {
		const file = c.snap.files.get(p);
		if (!file) throw new Error(`edit of unknown file ${p}`);
		const targets = r.edit.targets[p] ?? [];
		const label = `${c.name} ${JSON.stringify(intent)} ${p}`;
		cs.iterChangedRanges((fromA, toA) => {
			expect(within({ from: fromA, to: toA }, targets), `${label} ${fromA}`).toBe(true);
		});
		for (const t of targets) {
			expect(within(t, allowed.get(p) ?? []), `${label} ${t.from}-${t.to}`).toBe(true);
		}
		const next = cs.apply(file.text);
		const inv = r.edit.inverse[p];
		expect(inv?.apply(next).toString()).toBe(file.text.toString());
		const nf = createFile(p, next.toString(), file.top);
		expect(syntaxIssues(nf.tree, nf.text).length).toBeLessThanOrEqual(
			syntaxIssues(file.tree, file.text).length,
		);
		expect(touchedMacro(file.tree, file.text.toString(), nf.tree, cs)).toBeNull();
		files.set(p, next.toString());
	}
	const snap = createWorkspace({
		entry: c.snap.entry,
		files: Object.fromEntries(files),
	}).snapshot();
	readBack(c, intent, snap);
}

describe('task attribute intents on the corpora', () => {
	it('loads golden plans and fixtures', () => {
		expect(CORPUS.length).toBeGreaterThan(40);
	});

	it('edit only their targets, invert exactly, parse, and read back the intended value', () => {
		const counts = new Map<string, number>();
		fc.assert(
			fc.property(
				fc.record({
					// One case in four on the inline plans, which are few but dense.
					ci: fc.oneof(
						{ arbitrary: fc.nat(CORPUS.length - 1), weight: 3 },
						{ arbitrary: fc.integer({ min: FIRST_INLINE, max: CORPUS.length - 1 }), weight: 1 },
					),
					kind: fc.nat(7),
					pick: fc.nat(),
					value: fc.nat(1000),
				}),
				({ ci, kind, pick, value }) => {
					// Aim kind 7 (text-only targets) at plans that have them.
					const c = kind === 7 ? TEXT_ONLY[ci % TEXT_ONLY.length] : CORPUS[ci];
					if (!c) return;
					const intent = intentFor(c, kind, pick, value);
					const r = applyIntent(c.snap, c.index, intent);
					const key = `${intent.type}:${r.status}:${r.status === 'edit' ? '' : r.reason}`;
					counts.set(key, (counts.get(key) ?? 0) + 1);
					check(c, intent, r);
				},
			),
			{ numRuns: Number(process.env['TJP_EDIT_RUNS'] ?? 400), ...SEED },
		);
		console.log(`task attribute intents: ${JSON.stringify([...counts].sort())}`);
		for (const t of ['setAttr', 'removeAttr', 'renameTask', 'declareFlag']) {
			expect(counts.get(`${t}:edit:`) ?? 0, t).toBeGreaterThanOrEqual(5);
		}
		const textOnly = [...counts].filter(([k]) => k.endsWith(':refused:text-only'));
		expect(textOnly.reduce((n, [, v]) => n + v, 0)).toBeGreaterThanOrEqual(5);
	}, 300_000);
});
