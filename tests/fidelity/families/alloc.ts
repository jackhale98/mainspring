// SPDX-License-Identifier: GPL-2.0-or-later
// allocate, addAllocation, removeAllocation, replaceAllocation (7.1, 15.19): the task's own plain
// `allocate` lists are reshaped with the fewest edits. Resources a parent gives count as allocated, so
// the semantic is the effective set: own ids plus those an ancestor's statements gave before the task.
import {
	effectiveIds,
	insertZone,
	listEndZone,
	rg,
	stmtZone,
	type Facts,
	type Rg,
	type Sem,
} from '../gen/facts';
import type { Rng } from '../gen/rng';
import type { Drawn, Family, Region } from './types';
import { hasSizing, isLeaf, leafResources, own, parentOf, sorted, task } from './util';

const ownIds = (f: Facts, id: string): string[] =>
	own(task(f, id), 'allocate').flatMap((s) => (s.items ?? []).map((i) => i.target ?? i.written));

function draw(type: string, f: Facts, rng: Rng): Drawn | null {
	const res = leafResources(f);
	const leaves = f.tasks.filter((t) => isLeaf(t) && hasSizing(t) && !t.stmts.some((s) => s.macro));
	if (leaves.length === 0 || res.length === 0) return null;
	if (type === 'allocate') {
		const t = rng.pick(leaves);
		const p = parentOf(f, t);
		const inherited = p ? effectiveIds(f, p, 'allocate', t.seq) : [];
		const extra = rng.sample(res, rng.int(1, 2));
		const wanted = rng.chance(0.85) ? sorted([...inherited, ...extra]) : sorted(extra);
		return { intent: { type: 'allocate', task: t.id, resources: wanted } };
	}
	if (type === 'addAllocation') {
		return {
			intent: { type: 'addAllocation', task: rng.pick(leaves).id, resource: rng.pick(res) },
		};
	}
	const withOwn = leaves.filter((t) => ownIds(f, t.id).length > 0);
	if (withOwn.length === 0) return null;
	const t = rng.pick(withOwn);
	const from = rng.pick(ownIds(f, t.id));
	if (type === 'removeAllocation')
		return { intent: { type: 'removeAllocation', task: t.id, resource: from } };
	const taken = new Set(effectiveIds(f, t, 'allocate'));
	const to = res.filter((r) => !taken.has(r));
	return to.length > 0
		? { intent: { type: 'replaceAllocation', task: t.id, from, to: rng.pick(to) } }
		: null;
}

export const allocFamily: Family = {
	name: 'alloc',
	types: ['allocate', 'addAllocation', 'removeAllocation', 'replaceAllocation'],
	draw: (type, f, _sem, rng) => draw(type, f, rng),
	region(intent, f): Region {
		if (!('task' in intent)) return [];
		const t = task(f, intent.task);
		const a = own(t, 'allocate');
		const last = a[a.length - 1];
		switch (intent.type) {
			case 'allocate':
				return a.length > 0 ? a.flatMap((s) => stmtZone(f, s)) : insertZone(f, t, 'allocate');
			case 'addAllocation':
				return last ? [listEndZone(last)] : insertZone(f, t, 'allocate');
			case 'removeAllocation':
				return a
					.filter((s) => s.items?.some((i) => i.target === intent.resource))
					.flatMap((s) => stmtZone(f, s));
			case 'replaceAllocation':
				return a.flatMap((s) =>
					(s.items ?? [])
						.filter((i) => i.target === intent.from)
						.map((i): Rg => rg(i.at.file, i.at.from, i.at.to)),
				);
			default:
				return [];
		}
	},
	expect(sem, _f, intent): Sem {
		const out = structuredClone(sem);
		if (!('task' in intent)) return out;
		const ts = out.tasks.find((t) => t.id === intent.task);
		if (!ts) return out;
		if (intent.type === 'allocate') ts.allocate = sorted(intent.resources);
		else if (intent.type === 'addAllocation')
			ts.allocate = sorted([...ts.allocate, intent.resource]);
		else if (intent.type === 'removeAllocation')
			ts.allocate = ts.allocate.filter((r) => r !== intent.resource);
		else if (intent.type === 'replaceAllocation')
			ts.allocate = sorted([...ts.allocate.filter((r) => r !== intent.from), intent.to]);
		return out;
	},
};
