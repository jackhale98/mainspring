// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the task tree intents: a fast-check generator of small plans printed with
 * varied layout (indent unit, line breaks, blank lines, comments, a second file, relative and
 * absolute dependency ids), the corpus of golden plans and T16 fixtures, and the tree oracle the
 * property tests check results against (written from phase-1.md 7.1, without the edit code).
 */
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { CORPORA, ROOT, readTjp } from '../../../../tests/grammar/corpus';
import { createWorkspace, type WorkspaceSnapshot } from '../../workspace/workspace';
import { buildIndex, type SymbolIndex } from '../index';
import type { EditIntent } from './types';

export interface Plan {
	readonly entry: string;
	readonly files: Record<string, string>;
	/** For a generated plan: the tree and dependencies of its model (the oracle's input). */
	readonly model?: Shape;
}

interface Node {
	readonly parent: number;
	readonly depends: readonly number[];
	readonly comment: boolean;
	readonly blank: boolean;
	readonly second: boolean;
}

const ancestors = (nodes: readonly Node[], i: number): number[] => {
	const out: number[] = [];
	for (let p = nodes[i]?.parent ?? -1; p >= 0; p = nodes[p]?.parent ?? -1) out.push(p);
	return out;
};

function fullId(nodes: readonly Node[], i: number): string {
	return [...ancestors(nodes, i).reverse(), i].map((x) => `t${x}`).join('.');
}

/** `!…` from `from`'s body to `to` when `relative` and possible, else the absolute id. */
function refText(nodes: readonly Node[], from: number, to: number, relative: boolean): string {
	const target = fullId(nodes, to);
	if (!relative) return target;
	const up = ancestors(nodes, from);
	for (let k = 1; k <= up.length; k++) {
		const base = up[k - 1] as number;
		const prefix = `${fullId(nodes, base)}.`;
		if (target.startsWith(prefix)) return '!'.repeat(k) + target.slice(prefix.length);
	}
	return '!'.repeat(up.length + 1) + target;
}

export interface Layout {
	readonly unit: string;
	readonly eol: string;
	readonly relative: boolean;
}

/** Prints a generated plan; leaves get `effort`, `allocate r` and depends on earlier leaves. */
export function printPlan(nodes: readonly Node[], layout: Layout): Plan {
	const { unit, eol } = layout;
	const kids = (p: number): number[] => nodes.flatMap((n, i) => (n.parent === p ? [i] : []));
	const leaf = (i: number): boolean => kids(i).length === 0;
	const block = (i: number, depth: number): string[] => {
		const n = nodes[i] as Node;
		const ind = unit.repeat(depth);
		const out: string[] = [];
		if (n.blank) out.push('');
		if (n.comment) out.push(`${ind}# about t${i}`);
		const deps = [...new Set(n.depends)].filter(
			(j) => j < i && leaf(j) && !ancestors(nodes, i).includes(j),
		);
		const body: string[] = [];
		if (leaf(i)) body.push(`${ind}${unit}effort ${1 + (i % 3)}d`, `${ind}${unit}allocate r`);
		if (deps.length > 0 && leaf(i)) {
			const refs = deps.map((j) => refText(nodes, i, j, layout.relative));
			body.push(`${ind}${unit}depends ${refs.join(', ')}`);
		}
		for (const c of kids(i)) body.push(...block(c, depth + 1));
		out.push(`${ind}task t${i} "T ${i}" {`, ...body, `${ind}}`);
		return out;
	};
	const roots = kids(-1);
	const main = ['project p "P" 2026-01-05 +3m', 'resource r "R"', ''];
	const ordered = [
		...roots.filter((r) => !nodes[r]?.second),
		...roots.filter((r) => nodes[r]?.second),
	];
	const other: string[] = [];
	for (const r of roots) ((nodes[r] as Node).second ? other : main).push(...block(r, 0));
	const files: Record<string, string> = {};
	if (other.length > 0) {
		main.push('include "more.tji"');
		files['more.tji'] = other.join(eol) + eol;
	}
	files['plan.tjp'] = main.join(eol) + eol;
	return { entry: 'plan.tjp', files, model: modelShape(nodes, ordered, leaf) };
}

/** The tree and dependencies the model gives, as printPlan writes it (the generated oracle). */
function modelShape(
	nodes: readonly Node[],
	roots: readonly number[],
	leaf: (i: number) => boolean,
): Shape {
	const parent = new Map<string, string | null>();
	const deps: string[] = [];
	nodes.forEach((n, i) => {
		parent.set(fullId(nodes, i), n.parent < 0 ? null : fullId(nodes, n.parent));
		if (!leaf(i)) return;
		for (const j of new Set(n.depends)) {
			if (j < i && leaf(j) && !ancestors(nodes, i).includes(j)) {
				deps.push(`${fullId(nodes, j)} -> ${fullId(nodes, i)}`);
			}
		}
	});
	const children = (p: string | null): string[] => {
		if (p === null) return roots.map((r) => fullId(nodes, r));
		return nodes.flatMap((n, i) =>
			n.parent >= 0 && fullId(nodes, n.parent) === p ? [fullId(nodes, i)] : [],
		);
	};
	return { parent, children, deps: deps.sort() };
}

/** Plans of 2 to 9 tasks, up to 3 levels, printed with a random layout. */
export function arbPlan(): fc.Arbitrary<Plan> {
	const node = (i: number): fc.Arbitrary<Node> =>
		fc.record({
			parent: fc.integer({ min: -1, max: i - 1 }),
			depends: fc.array(fc.integer({ min: 0, max: Math.max(0, i - 1) }), { maxLength: 2 }),
			comment: fc.boolean(),
			blank: fc.boolean(),
			second: fc.boolean(),
		});
	const nodes = fc
		.integer({ min: 2, max: 9 })
		.chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => node(i))))
		.map((list) =>
			list.map((n, i, all) =>
				ancestors(all.slice(0, i + 1), i).length > 2 ? { ...n, parent: -1 } : n,
			),
		)
		.map((list) => list.map((n, i) => (i === 0 ? { ...n, parent: -1 } : n)));
	const layout = fc.record({
		unit: fc.constantFrom('  ', '    ', '\t'),
		eol: fc.constantFrom('\n', '\r\n'),
		relative: fc.boolean(),
	});
	return fc.tuple(nodes, layout).map(([n, l]) => printPlan(n, l));
}

/** A random intent for a plan, from the tasks the index knows. */
export function intentFor(index: SymbolIndex, pick: readonly number[]): EditIntent {
	const ids = [...index.tasks.keys()];
	const at = (k: number): string | null => {
		const x = pick[k] ?? 0;
		return x % (ids.length + 1) === ids.length ? null : (ids[x % (ids.length + 1)] ?? null);
	};
	const task = ids[(pick[1] ?? 0) % Math.max(1, ids.length)] ?? 'none';
	const parent = at(2);
	const n = (parent === null ? index.taskRoots : (index.tasks.get(parent)?.children ?? [])).length;
	const index_ = (pick[3] ?? 0) % (n + 1);
	switch ((pick[0] ?? 0) % 3) {
		case 0:
			return { type: 'addTask', parent, index: index_, name: `Added ${pick[4] ?? 0}` };
		case 1:
			return { type: 'deleteTask', task };
		default:
			return { type: 'moveTask', task, parent, index: Math.max(0, Math.min(index_, n - 1)) };
	}
}

export interface Loaded {
	readonly name: string;
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
}

export function load(name: string, plan: Plan): Loaded {
	const snap = createWorkspace({ entry: plan.entry, files: plan.files }).snapshot();
	return { name, snap, index: buildIndex(snap) };
}

/** Golden plans (with their engine golden) and T16 fixture plans. */
export function corpusPlans(): Array<{ name: string; plan: Plan; golden: string | null }> {
	const manifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/manifest.json'), 'utf8'),
	) as Array<{ id: string; root: string }>;
	const out = manifest.map((p) => {
		const golden = path.join(ROOT, 'engine/golden/expected', `${p.id}.json`);
		const g = JSON.parse(fs.readFileSync(golden, 'utf8')) as { entry: string; files: string[] };
		const files: Record<string, string> = {};
		for (const f of g.files) files[f] = readTjp(`${p.root}/${f}`);
		return { name: p.root, plan: { entry: g.entry, files }, golden: p.id as string | null };
	});
	const all = CORPORA.find((c) => c.name === 'fixtures')?.files ?? [];
	const root = 'tests/fixtures/tjp';
	for (const d of fs.readdirSync(path.join(ROOT, root), { withFileTypes: true })) {
		if (!d.isDirectory()) continue;
		const dir = `${root}/${d.name}`;
		const files: Record<string, string> = {};
		for (const f of all) if (f.startsWith(`${dir}/`)) files[f.slice(dir.length + 1)] = readTjp(f);
		if (files['plan.tjp'] !== undefined) {
			out.push({ name: dir, plan: { entry: 'plan.tjp', files }, golden: null });
		}
	}
	return out;
}

// --- Oracle ------------------------------------------------------------------------------------

/** The task tree and dependency pairs of a snapshot, indexed afresh without hints. */
export interface Shape {
	readonly parent: ReadonlyMap<string, string | null>;
	readonly children: (p: string | null) => readonly string[];
	readonly deps: readonly string[];
}

export function shapeOf(snap: WorkspaceSnapshot): Shape {
	const index = buildIndex(snap);
	const parent = new Map<string, string | null>();
	for (const [id, s] of index.tasks) {
		if (s.idSource === 'text' && !s.expandedOnly) parent.set(id, s.parent);
	}
	const seen = new Set<string>();
	const deps: string[] = [];
	for (const d of index.dependencies) {
		const k = `${d.item.file}:${d.item.from}`;
		if (seen.has(k) || d.pred === null || d.succ === null) continue;
		seen.add(k);
		deps.push(`${d.pred} -> ${d.succ}`);
	}
	return {
		parent,
		children: (p) => (p === null ? index.taskRoots : (index.tasks.get(p)?.children ?? [])),
		deps: deps.sort(),
	};
}

/** Old id → new id of a move (7.1): the subtree's ids follow the task. */
export function movedId(task: string, parent: string | null): (id: string) => string {
	const local = task.slice(task.lastIndexOf('.') + 1);
	const next = parent === null ? local : `${parent}.${local}`;
	return (id) => (id === task || id.startsWith(`${task}.`) ? next + id.slice(task.length) : id);
}
