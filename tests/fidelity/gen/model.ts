// SPDX-License-Identifier: GPL-2.0-or-later
// The random plan model (phase-1.md 9.3): 5 to 40 tasks up to 4 levels deep, 1 to 6 resources in groups,
// 1 to 3 files linked by `include` (some with `taskprefix`), whole-hour durations, a horizon of at
// most 6 months and a fixed `now`. The model is valid by construction: dependencies point back in
// declaration order, every effort leaf has an allocation, fixed dates stay early and no hard
// constraints are combined. The printer (printer.ts) turns it into text and records the oracle.
// This file builds the tree, the resources and the files; model-attrs.ts adds the statements.
import {
	macros,
	precedes,
	purges,
	resourceStatements,
	statements,
	supplements,
} from './model-attrs';
import {
	FLAGS,
	IDS,
	RES,
	WORDS,
	COMMENTS,
	type MPlan,
	type MRes,
	type MTask,
	type PlanOpts,
} from './model-types';
import type { Rng } from './rng';

export * from './model-types';

export function genPlan(rng: Rng, opts: PlanOpts = {}): MPlan {
	const rich = opts.rich ?? rng.chance(0.4);
	// Engine time is mostly fixed cost plus about 4 ms per task, and twice that with two scenarios, so plans
	// are mostly small (5 to 40 tasks in all; phase-1.md 9.3: smaller, not fewer, when runs are slow).
	const scenarios = rich && rng.chance(0.5);
	const roll = rng.next();
	const size = roll < 0.9 ? rng.int(5, 16) : roll < 0.98 ? rng.int(17, 28) : rng.int(29, 40);
	const n = Math.max(opts.minTasks ?? 5, scenarios ? Math.min(size, 16) : size);
	const resources = genResources(rng);
	const leafRes = flatten(resources, (r) => r.kids)
		.filter((r) => r.kids.length === 0)
		.map((r) => r.id);
	const tasks = genTree(rng, n);
	const all = preOrder(tasks);
	const flags = rng.chance(0.15) ? [] : [rng.sample(FLAGS, rng.int(2, 4))];
	const declared = flags.flat();
	const plan: MPlan = {
		seed: 0,
		indent: rng.pick(['\t', '  ', '    ', '  ']),
		eol: rng.chance(0.1) ? '\r\n' : '\n',
		sloppy: opts.sloppy ?? rng.chance(0.2),
		horizon: rng.int(5, 6),
		scenarios,
		headerBody: rng.chance(0.4),
		files: [{ path: 'plan.tjp', prefix: null, plain: false }],
		macros: [],
		flagDecls: flags,
		globalLeaves: [],
		projectStmts: [],
		resources,
		tasks,
		resourceLeaves: leafRes,
	};
	resourceStatements(rng, plan);
	statements(rng, all, leafRes, declared, plan.scenarios);
	precedes(rng, all);
	if (rich || rng.chance(0.25)) supplements(rng, all, leafRes, declared);
	if (rich || rng.chance(0.3)) macros(rng, plan, all);
	if (opts.purge) purges(rng, all, plan.scenarios);
	assignFiles(rng, plan, opts.minTasks === undefined && rng.chance(0.45) ? 2 : 0);
	return plan;
}

function genResources(rng: Rng): MRes[] {
	const count = rng.int(1, 6);
	const ids = RES.slice(0, count);
	const mkRes = (id: string): MRes => ({
		id,
		name: id[0]?.toUpperCase() + id.slice(1),
		kids: [],
		stmts: [],
	});
	if (count < 3 || rng.chance(0.3)) return ids.map(mkRes);
	const group = (id: string, kids: string[]): MRes => ({
		...mkRes(id),
		id,
		name: `Team ${id}`,
		kids: kids.map(mkRes),
	});
	const g = Math.min(count - 1, rng.int(2, 3));
	const out: MRes[] = [group('team', ids.slice(0, g))];
	for (const id of ids.slice(g)) out.push(mkRes(id));
	return out;
}

function flatten<T>(roots: readonly T[], kids: (t: T) => readonly T[]): T[] {
	return roots.flatMap((t) => [t, ...flatten(kids(t), kids)]);
}
export const preOrder = (roots: readonly MTask[]): MTask[] => flatten(roots, (t) => t.kids);

function genTree(rng: Rng, n: number): MTask[] {
	const roots: MTask[] = [];
	const nodes: MTask[] = [];
	const depth = (t: MTask): number => (t.parent ? depth(t.parent) + 1 : 1);
	for (let i = 0; i < n; i++) {
		const candidates = nodes.filter((t) => depth(t) < 4);
		const parent = nodes.length === 0 || rng.chance(0.2) ? null : rng.pick(candidates);
		const siblings = parent ? parent.kids : roots;
		const used = new Set(siblings.map((s) => s.local));
		let local = rng.pick(IDS.filter((x) => !used.has(x)));
		if (!local) local = `t${i}`;
		const name = rng.chance(0.15) ? rng.pick(WORDS) : `${local[0]?.toUpperCase()}${local.slice(1)}`;
		const t: MTask = {
			local,
			id: parent ? `${parent.id}.${local}` : local,
			name,
			nameMacro: false,
			quote: rng.chance(0.15) ? "'" : '"',
			kids: [],
			file: 0,
			parent,
			stmts: [],
			supp: [],
			calls: [],
			oneLine: false,
			blankBefore: rng.chance(0.4),
			lead: rng.chance(0.15) ? { text: rng.pick(COMMENTS), attached: rng.chance(0.7) } : null,
			trailing: rng.chance(0.1) ? rng.pick(COMMENTS) : null,
		};
		siblings.push(t);
		nodes.push(t);
	}
	return roots;
}

/** Moves part of the task tree into up to `extra` included files (at most 3 files in all). */
function assignFiles(rng: Rng, plan: MPlan, extraHint: number): void {
	const extra = extraHint > 0 ? rng.int(0, extraHint) : 0;
	const setFile = (t: MTask, f: number): void => {
		t.file = f;
		t.kids.forEach((k) => setFile(k, f));
	};
	for (let i = 0; i < extra; i++) {
		const k = plan.files.length;
		const used = (t: MTask): boolean => t.file !== 0 || t.kids.some(used);
		const prefixed = plan.tasks.filter(
			(t) =>
				t.file === 0 &&
				t.kids.filter((c) => c.file === 0).length > 0 &&
				!t.kids.some((c) => c.file !== 0),
		);
		if (rng.chance(0.5) && prefixed.length > 0) {
			const p = rng.pick(prefixed);
			const moved = p.kids.slice(p.kids.length === 1 ? 0 : rng.int(1, p.kids.length - 1));
			moved.forEach((c) => setFile(c, k));
			plan.files.push({ path: `lib/part${k}.tji`, prefix: p.id, plain: false });
		} else {
			const free = plan.tasks.slice(1).filter((t) => !used(t));
			const idx = free.length > 0 ? plan.tasks.indexOf(rng.pick(free)) : -1;
			if (idx < 1) continue;
			let end = idx;
			while (end + 1 < plan.tasks.length && rng.chance(0.4) && !used(plan.tasks[end + 1] as MTask))
				end++;
			plan.tasks.slice(idx, end + 1).forEach((t) => setFile(t, k));
			plan.files.push({ path: `part${k}.tji`, prefix: null, plain: true });
		}
	}
}

export { RES as RESOURCE_POOL };
