// SPDX-License-Identifier: GPL-2.0-or-later
// Edit core properties over the corpora (phase-1.md 9.3 P1, P2, P5, P6, text only): random ops
// built from the layout helpers on golden plans and T16 fixtures (CRLF, lone CR, tabs, CRLF macro
// bodies), run through the refusal pipeline and buildEdit, alone and several at once across files.
// For every edit, checked with the oracles of oracle.ts, not the helpers:
// - locality: every changed range lies in a region computed from the pre-edit index (a statement's
//   lines, a block with its leading comments, a value); an insertion is pure, lands in its block
//   and puts the statement where 7.2 orders it; an append adds exactly `, id` after the last item;
//   a list removal leaves exactly the other items;
// - no change touches or joins a macro node (P5), and ops on text-only elements are refused;
// - the inverse restores the base byte for byte; a fresh parse has no new error nodes.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CORPORA, ROOT, readTjp } from '../../../../tests/grammar/corpus';
import { createWorkspace, type WorkspaceSnapshot } from '../../workspace/workspace';
import { createFile, syntaxIssues, type TjpFile } from '../document';
import { buildIndex, type SymbolIndex } from '../index';
import { statementsIn } from '../tree';
import { parseValue } from '../values';
import { finishPlan } from './apply';
import {
	appendListItem,
	insertStatement,
	removeListItems,
	removeStatement,
	replaceValue,
	type OrderScope,
} from './layout';
import { KEYWORDS } from '../syntax/keywords';
import { inOrder, lineRegion, listItems, nextTokenMacro, touchedMacro } from './oracle';
import {
	isNoop,
	isRefused,
	type EditContext,
	type EditOp,
	type IntentPlan,
	type Span,
} from './types';

interface Corpus {
	readonly name: string;
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
}

function load(root: string, entry: string, files: Record<string, string>): Corpus {
	const snap = createWorkspace({ entry, files }).snapshot();
	return { name: root, snap, index: buildIndex(snap) };
}

function corpora(): Corpus[] {
	const manifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/manifest.json'), 'utf8'),
	) as Array<{ id: string; root: string }>;
	const out = manifest.map((plan) => {
		const g = JSON.parse(
			fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${plan.id}.json`), 'utf8'),
		) as { entry: string; files: string[] };
		const files: Record<string, string> = {};
		for (const f of g.files) files[f] = readTjp(`${plan.root}/${f}`);
		return load(plan.root, g.entry, files);
	});
	const all = CORPORA.find((c) => c.name === 'fixtures')?.files ?? [];
	const root = 'tests/fixtures/tjp';
	for (const d of fs.readdirSync(path.join(ROOT, root), { withFileTypes: true })) {
		if (!d.isDirectory()) continue;
		const dir = `${root}/${d.name}`;
		const files: Record<string, string> = {};
		for (const f of all) if (f.startsWith(`${dir}/`)) files[f.slice(dir.length + 1)] = readTjp(f);
		if (files['plan.tjp'] !== undefined) out.push(load(dir, 'plan.tjp', files));
	}
	return out;
}

const CORPUS = corpora();
/** Corpora with several files, so multi-op cases span files. */
const MULTI_FILE = CORPUS.map((c, i) => (c.snap.files.size > 1 ? i : -1)).filter((i) => i >= 0);

type Kind = 'remove' | 'removeBlock' | 'insert' | 'replace' | 'append' | 'removeItems';
const KINDS: readonly Kind[] = [
	'remove',
	'removeBlock',
	'insert',
	'replace',
	'append',
	'removeItems',
];

/** Checks that hold only for the op alone, on the new text of its file. */
type Extra = (newText: string, newTree: TjpFile['tree'], cs: Changes) => void;
type Changes = Array<{ fromA: number; toA: number; inserted: string }>;

/** One case: a plan, its file, the oracle region every change must lie in, and extra checks. */
interface Case {
	readonly plan: IntentPlan;
	readonly file: string;
	readonly region: Span;
	readonly extra?: Extra;
}

const NEW_VALUES: Readonly<Record<string, string>> = {
	duration: '3d',
	integer: '700',
	number: '40',
	string: '"Changed by a property"',
};

const INSERTS: Readonly<Record<OrderScope, ReadonlyArray<readonly [string, string]>>> = {
	task: [
		['note', 'note "Property note"'],
		['priority', 'priority 600'],
		['complete', 'complete 25'],
		['scheduling', 'scheduling asap'],
		['task', 'task prop_child "Property child" {\n\tlength 1d\n}'],
		['note', 'note "Line one\n\tline two, it\'s kept"'],
		['note', "note -8<-\n  It's cut-here text\n  ->8-"],
	],
	resource: [
		['email', 'email "p@example.org"'],
		['efficiency', 'efficiency 0.5'],
		['rate', 'rate 100'],
	],
	project: [['currency', 'currency "EUR"']],
};

function fileOf(c: Corpus, p: string): TjpFile {
	const f = c.snap.files.get(p);
	if (!f) throw new Error(p);
	return f;
}

const plan = (x: readonly EditOp[] | EditOp | IntentPlan): IntentPlan =>
	Array.isArray(x) ? x : isRefused(x) || isNoop(x) ? x : [x as EditOp];

/** The candidate cases of one kind in one corpus workspace. */
function candidates(c: Corpus, kind: Kind, pick: number): Array<() => Case> {
	const out: Array<() => Case> = [];
	const text = (p: string): string => fileOf(c, p).text.toString();
	const syms = [...c.index.tasks.values(), ...c.index.resources.values()];
	if (kind === 'remove' || kind === 'replace') {
		for (const a of syms.flatMap((s) => s.attrs)) {
			const f = fileOf(c, a.statement.file);
			if (kind === 'remove') {
				out.push(() => ({
					plan: [removeStatement(f, a.statement)],
					file: f.path,
					region: lineRegion(text(f.path), a.statement.from, a.statement.to),
				}));
				continue;
			}
			const k = a.parsed?.kind;
			const next = k && NEW_VALUES[k];
			const v = k && next ? parseValue(k, next) : null;
			const value = a.value;
			if (!v?.ok || !value) continue;
			out.push(() => ({
				plan: plan(replaceValue(f, value, v.value)),
				file: f.path,
				region: value,
			}));
		}
	}
	if (kind === 'removeBlock') {
		for (const s of syms) {
			const f = fileOf(c, s.decl.block.file);
			const lead = s.decl.leadingComments;
			const from = lead ? lead.from : s.decl.block.from;
			out.push(() => ({
				plan: [removeStatement(f, s.decl.block, { leading: lead })],
				file: f.path,
				region: lineRegion(text(f.path), from, s.decl.block.to),
			}));
		}
	}
	if (kind === 'insert') {
		const owners: Array<[OrderScope, Span & { file: string }]> = [
			...[...c.index.tasks.values()].map((t): [OrderScope, typeof t.decl.block] => [
				'task',
				t.decl.block,
			]),
			...[...c.index.resources.values()].map((r): [OrderScope, typeof r.decl.block] => [
				'resource',
				r.decl.block,
			]),
		];
		if (c.index.project) owners.push(['project', c.index.project.decl.block]);
		for (const [scope, block] of owners) {
			const f = fileOf(c, block.file);
			for (const [keyword, stmt] of INSERTS[scope]) {
				const first = stmt.split('\n')[0] ?? '';
				out.push(() => ({
					plan: plan(insertStatement(f, block, stmt, { scope, keyword })),
					file: f.path,
					// The block, through a trailing comment on its last line (the body goes after it).
					region: { from: block.from, to: lineRegion(text(f.path), block.from, block.to).to },
					extra: (newText, newTree, cs) => {
						expect(cs.every((x) => x.fromA === x.toA)).toBe(true);
						const host = cs.find((x) => x.inserted.includes(first));
						expect(host, 'the statement is inserted').toBeDefined();
						if (!host) return;
						const before = cs.filter((x) => x.fromA < host.fromA);
						const shift = before.reduce((n, x) => n + x.inserted.length, 0);
						const at = host.fromA + shift + host.inserted.indexOf(first);
						let n = newTree.resolveInner(at, 1);
						while (n.parent && !(n.from === at && n.name.endsWith('Statement'))) n = n.parent;
						expect(n.from).toBe(at);
						const body = n.parent;
						expect(body?.name).toBe('Body');
						expect(body?.parent?.from, 'inserted into its owner').toBe(block.from);
						if (body) expect(inOrder(scope, n, statementsIn(body), newText)).toBe(true);
					},
				}));
			}
		}
	}
	if (kind === 'append' || kind === 'removeItems') {
		const lists = new Map<string, { file: string; statement: Span; items: Span[] }>();
		for (const d of [...c.index.dependencies, ...c.index.allocations]) {
			const key = `${d.statement.file}:${d.statement.from}`;
			const l = lists.get(key) ?? { file: d.statement.file, statement: d.statement, items: [] };
			l.items.push(d.item);
			lists.set(key, l);
		}
		for (const l of lists.values()) {
			const f = fileOf(c, l.file);
			const items = [...l.items].sort((x, y) => x.from - y.from);
			const last = items[items.length - 1];
			if (!last) continue;
			const region = { from: l.statement.from, to: l.statement.to };
			if (kind === 'append') {
				out.push(() => ({
					plan: plan(appendListItem(f, l.statement, items, 'prop_id')),
					file: f.path,
					region: { from: last.to, to: last.to },
					extra: (_t, _tree, cs) =>
						expect(cs).toEqual([{ fromA: last.to, toA: last.to, inserted: ', prop_id' }]),
				}));
				continue;
			}
			if (items.length < 2) continue;
			// A random proper subset of the items, from `pick`.
			const gone = items.map((_, i) => i).filter((i) => ((pick >> i) & 1) === 1);
			if (gone.length === 0 || gone.length === items.length) continue;
			const old = text(f.path);
			const kept = items.filter((_, i) => !gone.includes(i)).map((s) => old.slice(s.from, s.to));
			const r = removeListItems(f, items, gone);
			if (!r) continue;
			out.push(() => ({
				plan: r,
				file: f.path,
				region,
				extra: (newText, newTree) =>
					expect(listItems(newTree, newText, l.statement.from)).toEqual(kept),
			}));
		}
	}
	return out;
}

const KEYWORD_NAMES = new Set(KEYWORDS.map((k) => k.name));

/**
 * Statement-level calls the next-token rule exempts (5.4): the index treats them as safe (no
 * text-only range of theirs lacks a `within`) and their only macro definition starts with a
 * keyword.
 */
function safeCall(c: Corpus, file: string): (from: number) => boolean {
	const text = fileOf(c, file).text.toString();
	return (from) => {
		const at = c.index
			.textOnly(file)
			.filter((r) => r.reason === 'macro-call' && r.at.from === from);
		if (at.length === 0 || at.some((r) => r.within === null)) return false;
		const name = /^\$\{\??\s*(\w+)/.exec(text.slice(from))?.[1] ?? '';
		const defs = c.index.macros.get(name) ?? [];
		const word = defs.length === 1 ? /^\s*(\w+)/.exec(defs[0]?.text ?? '')?.[1] : undefined;
		return word !== undefined && KEYWORD_NAMES.has(word);
	};
}

const INTENT = { type: 'declareFlag', flag: 'property' } as const;
const overlaps = (a: Span, b: Span): boolean => a.from <= b.to && b.from <= a.to;

/** Runs one or several cases together and checks the properties (module comment). */
function check(
	c: Corpus,
	cases: readonly Case[],
	counts: Map<string, number>,
	label: string,
): void {
	const ops = cases.flatMap((k) => (Array.isArray(k.plan) ? (k.plan as EditOp[]) : []));
	const solo = cases.length === 1 ? cases[0] : undefined;
	const ctx: EditContext = { ws: c.snap, index: c.index, opts: {} };
	const r = solo ? finishPlan(ctx, INTENT, solo.plan) : finishPlan(ctx, INTENT, ops);
	counts.set(`${label}:${r.status}`, (counts.get(`${label}:${r.status}`) ?? 0) + 1);
	for (const op of ops) {
		if (c.index.blocking(op.file, op.element.from, op.element.to)) {
			expect(r.status, `${c.name} ${label} text-only element`).toBe('refused');
		}
	}
	if (r.status !== 'edit') return;
	const e = r.edit;
	for (const [p, cs] of Object.entries(e.changes)) {
		const file = fileOf(c, p);
		const inv = e.inverse[p];
		if (!inv) throw new Error('missing inverse');
		const regions = cases.filter((k) => k.file === p).map((k) => k.region);
		const list: Changes = [];
		cs.iterChanges((fromA, toA, _fromB, _toB, ins) => {
			list.push({ fromA, toA, inserted: ins.toString() });
			const inside = regions.some((g) => g.from <= fromA && toA <= g.to);
			expect(inside, `${c.name} ${label}: change ${fromA}-${toA} outside its region`).toBe(true);
		});
		const base = file.text.toString();
		const after = cs.apply(file.text);
		expect(inv.apply(after).toString()).toBe(base);
		const fresh = createFile(file.path, after.toString(), file.top);
		const errors = syntaxIssues(fresh.tree, fresh.text).length;
		expect(errors, `${c.name} ${label}`).toBeLessThanOrEqual(
			syntaxIssues(file.tree, file.text).length,
		);
		expect(touchedMacro(file.tree, base, fresh.tree, cs), `${c.name} ${label}`).toBeNull();
		for (const x of list) {
			if (x.fromA !== x.toA && x.inserted !== '') continue;
			const next = nextTokenMacro(file.tree, base, x.toA, safeCall(c, p));
			expect(next, `${c.name} ${label}: ${x.fromA}-${x.toA} before a macro`).toBeNull();
		}
		if (base.includes('\r\n') && !/(^|[^\r])\n/.test(base)) {
			for (const x of list) expect(x.inserted).not.toMatch(/(^|[^\r])\n/);
		}
		if (solo?.extra) solo.extra(after.toString(), fresh.tree, list);
	}
}

const cache = new Map<string, Array<() => Case>>();
function cases(ci: number, kind: Kind, pick: number): Array<() => Case> {
	const key = `${ci}:${kind}:${kind === 'removeItems' ? pick % 64 : 0}`;
	let list = cache.get(key);
	if (!list) {
		const c = CORPUS[ci];
		list = c ? candidates(c, kind, pick % 64) : [];
		cache.set(key, list);
	}
	return list;
}

describe('edit core properties on corpus files', () => {
	it('loads corpora with CRLF and lone-CR macro bodies', () => {
		expect(CORPUS.length).toBeGreaterThan(40);
		const bodies = CORPUS.flatMap((c) =>
			[...c.snap.files.values()].map((f) => {
				const t = f.text.toString();
				const ends: string[] = [];
				f.tree.iterate({
					enter(n) {
						if (n.name === 'MacroBody') ends.push(t.slice(n.to, n.to + 2));
					},
				});
				return ends;
			}),
		).flat();
		expect(bodies).toContain('\r\n');
	});

	const counts = new Map<string, number>();
	const caseArb = fc.record({
		ci: fc.nat(CORPUS.length - 1),
		kind: fc.constantFrom(...KINDS),
		pick: fc.nat(),
	});

	it('single ops change only targets, invert exactly and add no error nodes', () => {
		fc.assert(
			fc.property(caseArb, ({ ci, kind, pick }) => {
				const list = cases(ci, kind, pick);
				const make = list[pick % Math.max(1, list.length)];
				const c = CORPUS[ci];
				if (make && c) check(c, [make()], counts, kind);
			}),
			{ numRuns: 600 },
		);
		for (const kind of KINDS) {
			expect(counts.get(`${kind}:edit`) ?? 0, `${kind} edits`).toBeGreaterThanOrEqual(5);
		}
	}, 60_000);

	it('several ops at once, across files, keep the same properties', () => {
		let multiFile = 0;
		fc.assert(
			fc.property(
				fc.oneof(fc.nat(CORPUS.length - 1), fc.constantFrom(...MULTI_FILE)),
				fc.array(fc.record({ kind: fc.constantFrom(...KINDS), pick: fc.nat() }), {
					minLength: 2,
					maxLength: 4,
				}),
				(ci, picks) => {
					const c = CORPUS[ci];
					if (!c) return;
					const chosen: Case[] = [];
					for (const { kind, pick } of picks) {
						const list = cases(ci, kind, pick);
						const k = list[pick % Math.max(1, list.length)]?.();
						if (!k || !Array.isArray(k.plan)) continue;
						const clash = chosen.some((o) => o.file === k.file && overlaps(o.region, k.region));
						if (!clash) chosen.push(k);
					}
					if (chosen.length < 2) return;
					if (new Set(chosen.map((k) => k.file)).size > 1) multiFile++;
					check(c, chosen, counts, 'multi');
				},
			),
			{ numRuns: 300 },
		);
		if (process.env['EDIT_PROPERTY_REPORT']) console.info([...counts].sort(), { multiFile });
		expect(counts.get('multi:edit') ?? 0).toBeGreaterThanOrEqual(5);
		expect(multiFile).toBeGreaterThan(0);
	});
});
