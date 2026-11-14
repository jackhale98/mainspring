// SPDX-License-Identifier: GPL-2.0-or-later
// gapToTask (phase-3.md 6.5): a successor's `depends` item with one gap becomes a new waiting task just
// before the successor, lasting the gap (gaplength -> length, gapduration -> duration) and depending on the
// target; the item then names the new task, without its gap. The new block may go where addTask puts
// child number `index` of the parent; the item may change in place.
import type { EditIntent } from '../../../src/lib/tjp/edit/types';
import {
	effectiveIdsIn,
	normValue,
	type Facts,
	type ItemF,
	type Rg,
	type Sem,
	type StmtF,
	type TaskF,
	type TaskSem,
} from '../gen/facts';
import type { Rng } from '../gen/rng';
import { siblingsIn, slotZoneIn, TASK_TREE } from './res-zones';
import type { Drawn, Family, Region } from './types';
import { own, placeIn } from './util';

type GapIntent = Extract<EditIntent, { type: 'gapToTask' }>;

const FRESH = ['wait', 'waiting', 'gap_wait', 'hold'];

interface Link {
	readonly succ: TaskF;
	readonly stmt: StmtF;
	readonly item: ItemF;
}

/** Own unprefixed `depends` items with a gap, naming a task. */
function gapLinks(f: Facts): Link[] {
	return f.tasks.flatMap((succ) =>
		own(succ, 'depends')
			.filter((s) => !s.macro)
			.flatMap((stmt) =>
				(stmt.items ?? [])
					.filter((i) => i.gap !== null && i.target !== null && f.byId.has(i.target))
					.map((item) => ({ succ, stmt, item })),
			),
	);
}

function linkOf(f: Facts, intent: GapIntent): Link | null {
	return (
		gapLinks(f).find((l) => l.succ.id === intent.task && l.item.target === intent.target) ?? null
	);
}

const parentOf = (f: Facts, t: TaskF): TaskF | null =>
	t.parent === null ? null : (f.byId.get(t.parent) ?? null);

const indexOf = (f: Facts, t: TaskF): number =>
	siblingsIn(TASK_TREE, f, parentOf(f, t)).findIndex((x) => x.id === t.id);

function draw(f: Facts, rng: Rng): Drawn | null {
	const links = gapLinks(f);
	if (links.length === 0) return null;
	const { succ, item } = rng.pick(links);
	const parent = parentOf(f, succ);
	const prefix = parent ? `${parent.id}.` : '';
	const clash = rng.chance(0.08) ? succ.id.slice(prefix.length) : null;
	const id = clash ?? FRESH.find((x) => !f.byId.has(prefix + x));
	if (!id) return null;
	const intent: GapIntent = {
		type: 'gapToTask',
		task: succ.id,
		target: item.target as string,
		name: rng.pick(['Wait', 'Waiting time', 'Cure']),
		id,
	};
	return { intent };
}

export const gapTaskFamily: Family = {
	name: 'gap-task',
	types: ['gapToTask'],
	draw: (_type, f, _sem, rng, aim) => (aim ? null : draw(f, rng)),
	region(intent, f): Region {
		if (intent.type !== 'gapToTask') return [];
		const link = linkOf(f, intent);
		if (!link) return [];
		const parent = parentOf(f, link.succ);
		const slot = slotZoneIn(TASK_TREE, f, parent?.id ?? null, indexOf(f, link.succ));
		return [...slot, link.item.range as Rg];
	},
	expect(sem, f, intent): Sem {
		const out = structuredClone(sem);
		if (intent.type !== 'gapToTask') return out;
		const link = linkOf(f, intent);
		const gap = link?.item.gap;
		if (!link || !gap) return out;
		const parent = parentOf(f, link.succ);
		const id = `${parent ? `${parent.id}.` : ''}${intent.id ?? ''}`;
		// The new task inherits what the successor inherits from the parent (it is declared just before
		// it): the parent's lists read before the successor.
		const inherited = (key: string): string[] =>
			parent ? effectiveIdsIn((x) => f.byId.get(x), parent, key, link.succ.seq).sort() : [];
		const item: TaskSem = {
			id,
			parent: parent?.id ?? null,
			name: intent.name,
			attrs: { [gap.kind === 'gaplength' ? 'length' : 'duration']: [normValue(gap.value)] },
			flags: inherited('flags'),
			responsible: inherited('responsible'),
			allocate: inherited('allocate'),
		};
		out.tasks = placeIn(out.tasks, item, parent?.id ?? null, indexOf(f, link.succ));
		const old = `${link.succ.id}<-${intent.target}||${gap.kind} ${gap.value}`;
		const at = out.deps.indexOf(old);
		if (at >= 0) out.deps.splice(at, 1);
		out.deps.push(`${link.succ.id}<-${id}||`, `${id}<-${intent.target}||`);
		out.deps.sort();
		return out;
	},
};
