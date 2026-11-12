// SPDX-License-Identifier: GPL-2.0-or-later
// Edit core properties over the corpora (phase-1.md 9.3 P1, P2, P5, P6, text only): random ops
// built from the layout helpers on golden plans and T16 fixtures, run through the refusal
// pipeline and buildEdit. For every edit: (a) every changed range lies inside a target region
// computed here, independently of the helpers, from the pre-edit index; (b) the inverse restores
// the base text byte for byte; (c) the new text, parsed from scratch, has no more error nodes
// than the old. Ops whose element is text-only are always refused, and refusals change nothing.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CORPORA, ROOT, readTjp } from '../../../../tests/grammar/corpus';
import { createWorkspace, type WorkspaceSnapshot } from '../../workspace/workspace';
import { createFile, syntaxIssues, type TjpFile } from '../document';
import { buildIndex, type SymbolIndex } from '../index';
import { parseValue, type TypedValue } from '../values';
import { finishPlan } from './apply';
import {
	appendListItem,
	insertStatement,
	removeListItem,
	removeStatement,
	replaceValue,
	type OrderScope,
} from './layout';
import type { EditContext, EditOp, IntentPlan, Span } from './types';

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

type Kind = 'remove' | 'insert' | 'replace' | 'append' | 'removeItem';
const KINDS: readonly Kind[] = ['remove', 'insert', 'replace', 'append', 'removeItem'];

/** One generated case: the op (or a plan from the helper) and its oracle target region. */
interface Case {
	readonly plan: IntentPlan;
	readonly file: string;
	readonly region: Span;
	/** For insertions: the statement text the inserted text must hold. */
	readonly inserted?: string;
}

// --- Oracle helpers, written independently of lines.ts ------------------------------------------

/** From the start of `from`'s line through the break after `to`'s line. */
function lineRegion(text: string, from: number, to: number): Span {
	let a = from;
	while (a > 0 && text[a - 1] !== '\n' && text[a - 1] !== '\r') a--;
	let b = to;
	while (b < text.length && text[b] !== '\n' && text[b] !== '\r') b++;
	if (text.startsWith('\r\n', b)) b += 2;
	else if (b < text.length) b++;
	return { from: a, to: b };
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

/** The candidate cases of one kind in one corpus workspace. */
function candidates(c: Corpus, kind: Kind): Array<() => Case> {
	const out: Array<() => Case> = [];
	const syms = [...c.index.tasks.values(), ...c.index.resources.values()];
	const text = (p: string): string => fileOf(c, p).text.toString();
	if (kind === 'remove' || kind === 'replace') {
		for (const s of syms) {
			for (const a of s.attrs) {
				const f = fileOf(c, a.statement.file);
				if (kind === 'remove') {
					out.push(() => ({
						plan: [removeStatement(f, a.statement)],
						file: f.path,
						region: lineRegion(text(f.path), a.statement.from, a.statement.to),
					}));
					continue;
				}
				const kindName = a.parsed?.kind;
				const next = kindName && NEW_VALUES[kindName];
				if (!a.value || !next || !kindName) continue;
				const v = parseValue(kindName, next);
				if (!v.ok) continue;
				const value = a.value;
				out.push(() => ({
					plan: planOf(replaceValue(f, value, v.value as TypedValue)),
					file: f.path,
					region: value,
				}));
			}
		}
	}
	if (kind === 'insert') {
		const owners: Array<[OrderScope, Span & { file: string }]> = [
			...[...c.index.tasks.values()].map(
				(t) => ['task', t.decl.block] as [OrderScope, typeof t.decl.block],
			),
			...[...c.index.resources.values()].map(
				(r) => ['resource', r.decl.block] as [OrderScope, typeof r.decl.block],
			),
		];
		if (c.index.project) owners.push(['project', c.index.project.decl.block]);
		for (const [scope, block] of owners) {
			const f = fileOf(c, block.file);
			for (const [keyword, stmt] of INSERTS[scope]) {
				out.push(() => ({
					plan: planOf(insertStatement(f, block, stmt, { scope, keyword })),
					file: f.path,
					region: { from: block.from, to: block.to },
					inserted: stmt,
				}));
			}
		}
	}
	if (kind === 'append' || kind === 'removeItem') {
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
			if (kind === 'append') {
				out.push(() => ({
					plan: planOf(appendListItem(f, l.statement, items, 'prop_id')),
					file: f.path,
					region: { from: last.to, to: last.to },
					inserted: ', prop_id',
				}));
				continue;
			}
			items.forEach((item, i) => {
				const op = removeListItem(f, items, i);
				if (!op) return;
				const prev = items[i - 1];
				const next = items[i + 1];
				out.push(() => ({
					plan: [op],
					file: f.path,
					region: {
						from: next ? item.from : (prev?.to ?? item.from),
						to: next ? next.from : item.to,
					},
				}));
			});
		}
	}
	return out;
}

function planOf(x: EditOp | IntentPlan): IntentPlan {
	return 'status' in x ? x : 'file' in x ? [x as EditOp] : x;
}

const cache = new Map<string, Array<() => Case>>();
function cases(ci: number, kind: Kind): Array<() => Case> {
	const key = `${ci}:${kind}`;
	let list = cache.get(key);
	if (!list) {
		const c = CORPUS[ci];
		list = c ? candidates(c, kind) : [];
		cache.set(key, list);
	}
	return list;
}

const INTENT = { type: 'declareFlag', flag: 'property' } as const;

describe('edit core properties on corpus files', () => {
	it('loads the corpora', () => {
		expect(CORPUS.length).toBeGreaterThan(40);
	});

	it('changes only targets, inverts exactly and adds no error nodes', () => {
		const counts = new Map<string, number>();
		const bump = (k: string): void => void counts.set(k, (counts.get(k) ?? 0) + 1);
		fc.assert(
			fc.property(
				fc.nat(CORPUS.length - 1),
				fc.constantFrom(...KINDS),
				fc.nat(),
				(ci, kind, pick) => {
					const list = cases(ci, kind);
					if (list.length === 0) return;
					const make = list[pick % list.length];
					const c = CORPUS[ci];
					if (!make || !c) return;
					const k = make();
					const ctx: EditContext = { ws: c.snap, index: c.index, opts: {} };
					const r = finishPlan(ctx, INTENT, k.plan);
					bump(`${kind}:${r.status}`);
					if (Array.isArray(k.plan)) {
						for (const op of k.plan as EditOp[]) {
							const blocked = c.index.blocking(op.file, op.element.from, op.element.to);
							if (blocked) expect(r.status, `${c.name} ${kind}`).toBe('refused');
						}
					}
					if (r.status !== 'edit') return;
					const e = r.edit;
					expect(Object.keys(e.changes)).toEqual([k.file]);
					const file = fileOf(c, k.file);
					const cs = e.changes[k.file];
					const inv = e.inverse[k.file];
					if (!cs || !inv) throw new Error('missing change set');
					// (a) locality against the oracle region.
					cs.iterChanges((fromA, toA, fromB, toB, ins) => {
						expect(fromA, `${c.name} ${kind}`).toBeGreaterThanOrEqual(k.region.from);
						expect(toA, `${c.name} ${kind}`).toBeLessThanOrEqual(k.region.to);
						if (k.inserted !== undefined) {
							const added = ins.toString();
							expect(toA).toBe(fromA);
							expect(added).toContain(k.inserted.split('\n')[0] ?? '');
							const rest = added.replace(k.inserted.split('\n')[0] ?? '', '');
							expect(rest).toMatch(/^[\s{}a-zA-Z_0-9."]*$/);
						}
						// CRLF files stay CRLF: no bare line feed is added to a file without one.
						const base = file.text.toString();
						if (base.includes('\r\n') && !/(^|[^\r])\n/.test(base)) {
							expect(ins.toString()).not.toMatch(/(^|[^\r])\n/);
						}
						void fromB;
						void toB;
					});
					// (b) the inverse restores the base byte for byte.
					const after = cs.apply(file.text);
					expect(inv.apply(after).toString()).toBe(file.text.toString());
					// (c) a fresh parse has no new error nodes.
					const fresh = createFile(file.path, after.toString(), file.top);
					const before = syntaxIssues(file.tree, file.text).length;
					expect(
						syntaxIssues(fresh.tree, fresh.text).length,
						`${c.name} ${kind}`,
					).toBeLessThanOrEqual(before);
				},
			),
			{ numRuns: 600 },
		);
		for (const kind of KINDS) {
			expect(counts.get(`${kind}:edit`) ?? 0, `${kind} edits`).toBeGreaterThanOrEqual(5);
		}
	});
});
