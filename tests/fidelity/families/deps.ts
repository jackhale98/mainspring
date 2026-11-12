// SPDX-License-Identifier: GPL-2.0-or-later
// addDepends, removeDepends, setDependsGap (7.1, 15.19). `task` is the successor. A new item is
// appended to the last own `depends`, else a statement is inserted at its rank; a removal edits the
// statements holding the link (the successor's `depends`, the predecessor's `precedes`); a gap is
// written in the item's body.
import type { EditIntent } from '../../../src/lib/tjp/edit/types';
import {
	insertZone,
	listEndZone,
	stmtZone,
	type Facts,
	type Rg,
	type Sem,
	type StmtF,
} from '../gen/facts';
import type { Rng } from '../gen/rng';
import type { Aim, Drawn, Family, Region } from './types';
import { isLeaf, own, task } from './util';

type LinkIntent = Extract<EditIntent, { type: 'addDepends' | 'removeDepends' | 'setDependsGap' }>;

const ancestorIds = (f: Facts, id: string): Set<string> => {
	const out = new Set<string>();
	for (let p = f.byId.get(id)?.parent ?? null; p; p = f.byId.get(p)?.parent ?? null) out.add(p);
	return out;
};

/** Own unprefixed `depends` statements of `succ` with an item naming `pred`. */
const holding = (f: Facts, succ: string, pred: string): StmtF[] =>
	own(task(f, succ), 'depends').filter((s) => s.items?.some((i) => i.target === pred));

const holdingPrecedes = (f: Facts, succ: string, pred: string): StmtF[] =>
	f.byId.has(pred)
		? own(task(f, pred), 'precedes').filter((s) => s.items?.some((i) => i.target === succ))
		: [];

function drawLink(type: LinkIntent['type'], f: Facts, rng: Rng, aim?: Aim): Drawn | null {
	const order = f.tasks;
	if (type === 'addDepends') {
		// A successor whose `depends` is written with a macro is text-only: no item can be added to it.
		const macroDep = order.find((t) => own(t, 'depends').some((s) => s.macro));
		if (aim && !(macroDep && type === 'addDepends')) return null;
		if (macroDep && (aim || rng.chance(0.2))) {
			const idx = order.indexOf(macroDep);
			const anc = ancestorIds(f, macroDep.id);
			// Not a task another scenario's `depends` already names: that is a conflict of its own.
			const named = new Set(
				macroDep.stmts
					.filter((x) => x.key === 'depends')
					.flatMap((x) => (x.items ?? []).map((i) => i.target)),
			);
			const prior = order.slice(0, idx).filter((p) => !anc.has(p.id) && !named.has(p.id));
			if (prior.length > 0) {
				return {
					intent: { type, task: macroDep.id, target: rng.pick(prior).id },
					mustRefuse: ['text-only', 'macro-in-body'],
				};
			}
		}
		const succs = order.filter(
			(t) =>
				isLeaf(t) &&
				own(t, 'start', 'end', 'precedes').length === 0 &&
				!t.stmts.some((s) => s.macro),
		);
		if (succs.length === 0) return null;
		const succ = rng.pick(succs);
		const idx = order.indexOf(succ);
		const anc = ancestorIds(f, succ.id);
		if (rng.chance(0.15)) {
			const linked = own(succ, 'depends')
				.flatMap((s) => s.items ?? [])
				.map((i) => i.target)
				.filter((x): x is string => x !== null && f.byId.has(x));
			if (linked.length > 0) return { intent: { type, task: succ.id, target: rng.pick(linked) } };
		}
		const prior = order.slice(0, idx).filter((p) => !anc.has(p.id));
		return prior.length > 0
			? { intent: { type, task: succ.id, target: rng.pick(prior).id } }
			: null;
	}
	const links = order.flatMap((t) =>
		own(t, 'depends').flatMap((s) =>
			(s.items ?? [])
				.filter((i) => i.target !== null && f.byId.has(i.target) && s.scenario === null)
				.map((i) => [t.id, i.target as string] as const),
		),
	);
	if (links.length === 0) return null;
	const [succ, pred] = rng.pick(links);
	if (type === 'removeDepends') {
		if (rng.chance(0.1)) return { intent: { type, task: succ, target: rng.pick(order).id } };
		return { intent: { type, task: succ, target: pred } };
	}
	const gap = rng.chance(0.3)
		? null
		: { kind: rng.pick(['gapduration', 'gaplength'] as const), value: `${rng.int(1, 8)}h` };
	return { intent: { type, task: succ, target: pred, gap } };
}

const entry = (succ: string, pred: string, scn = '', gap = ''): string =>
	`${succ}<-${pred}|${scn}|${gap}`;

export const depsFamily: Family = {
	name: 'deps',
	types: ['addDepends', 'removeDepends', 'setDependsGap'],
	draw: (type, f, _sem, rng, aim) => drawLink(type as LinkIntent['type'], f, rng, aim),
	region(intent, f): Region {
		if (intent.type === 'addDepends') {
			const t = task(f, intent.task);
			const d = own(t, 'depends');
			const last = d[d.length - 1];
			return last ? [listEndZone(last)] : insertZone(f, t, 'depends');
		}
		if (intent.type === 'removeDepends') {
			return [
				...holding(f, intent.task, intent.target),
				...holdingPrecedes(f, intent.task, intent.target),
			].flatMap((s) => stmtZone(f, s));
		}
		if (intent.type === 'setDependsGap') {
			return holding(f, intent.task, intent.target).flatMap((s) =>
				(s.items ?? []).filter((i) => i.target === intent.target).map((i): Rg => i.range),
			);
		}
		return [];
	},
	expect(sem, _f, intent): Sem {
		const out = structuredClone(sem);
		if (intent.type === 'addDepends') {
			const e = entry(intent.task, intent.target);
			if (!out.deps.includes(e)) out.deps = [...out.deps, e].sort();
		} else if (intent.type === 'removeDepends') {
			const head = `${intent.task}<-${intent.target}|`;
			out.deps = out.deps.filter((d) => !d.startsWith(head));
		} else if (intent.type === 'setDependsGap') {
			const head = `${intent.task}<-${intent.target}||`;
			const gap = intent.gap ? `${intent.gap.kind} ${intent.gap.value}` : '';
			out.deps = out.deps.map((d) => (d.startsWith(head) ? head + gap : d)).sort();
		}
		return out;
	},
};
