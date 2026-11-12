// SPDX-License-Identifier: GPL-2.0-or-later
// allocate, addAllocation, removeAllocation, replaceAllocation (7.1, 15.19): the task's own plain
// `allocate` lists are reshaped with the fewest edits. Resources a parent gives count as allocated, so
// the semantic is the effective set: own ids plus those an ancestor's statements gave before the task.
import type { EditIntent } from '../../../src/lib/tjp/edit/types';
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
import type { Aim, Drawn, Family, Region } from './types';
import { hasSizing, isLeaf, leafResources, own, parentOf, sorted, task } from './util';

const ownIds = (f: Facts, id: string): string[] =>
	own(task(f, id), 'allocate').flatMap((s) => (s.items ?? []).map((i) => i.target ?? i.written));

function draw(type: string, f: Facts, rng: Rng, aim?: Aim): Drawn | null {
	const res = leafResources(f);
	const leaves = f.tasks.filter((t) => isLeaf(t) && hasSizing(t) && !t.stmts.some((s) => s.macro));
	if (leaves.length === 0 || res.length === 0) return null;
	// A statement-level macro call that writes `allocate` makes the task's allocation text-only.
	const called = leaves.filter((t) => t.macroWords.has('allocate'));
	if (aim && !((type === 'allocate' || type === 'addAllocation') && called.length > 0)) return null;
	if (
		(type === 'allocate' || type === 'addAllocation') &&
		called.length > 0 &&
		(aim || rng.chance(0.25))
	) {
		const t = rng.pick(called);
		const intent: EditIntent =
			type === 'allocate'
				? { type, task: t.id, resources: [rng.pick(res)] }
				: { type, task: t.id, resource: rng.pick(res) };
		return { intent, mustRefuse: ['macro-in-body', 'text-only'] };
	}
	if (type === 'allocate') {
		const t = rng.pick(leaves);
		const p = parentOf(f, t);
		const inherited = p ? effectiveIds(f, p, 'allocate', t.seq) : [];
		const have = new Set(effectiveIds(f, t, 'allocate'));
		const fresh = res.filter((r) => !have.has(r));
		const extra = rng.sample(fresh.length > 0 && rng.chance(0.85) ? fresh : res, rng.int(1, 2));
		const wanted = rng.chance(0.85) ? sorted([...inherited, ...extra]) : sorted(extra);
		return { intent: { type: 'allocate', task: t.id, resources: wanted } };
	}
	if (type === 'addAllocation') {
		const open = leaves.filter((x) => res.some((r) => !effectiveIds(f, x, 'allocate').includes(r)));
		const t = rng.pick(open.length > 0 && rng.chance(0.9) ? open : leaves);
		const have = new Set(effectiveIds(f, t, 'allocate'));
		const fresh = res.filter((r) => !have.has(r));
		const pool = fresh.length > 0 && rng.chance(0.85) ? fresh : res;
		return { intent: { type: 'addAllocation', task: t.id, resource: rng.pick(pool) } };
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
	draw: (type, f, _sem, rng, aim) => draw(type, f, rng, aim),
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
