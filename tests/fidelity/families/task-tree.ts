// SPDX-License-Identifier: GPL-2.0-or-later
// addTask, deleteTask, moveTask (7.1, 15.24). A new block goes after sibling `index - 1` (above the first
// sibling at index 0, at the end of the parent's body when it has no children); a delete removes the block
// with its comments, every `depends` and `precedes` item that names the subtree and its supplement blocks; a
// move cuts the block, inserts it at the new place and rewrites every reference whose meaning changes
// (absolute ids into the subtree, relative ids across its edge) and the supplement paths. Moves and adds
// are drawn under parents that give no flags, responsible or allocate list, so the effective lists of the
// moved or new tasks stay as they were.
import type { AttrValue, EditIntent, TaskAttr } from '../../../src/lib/tjp/edit/types';
import {
	normValue,
	removeZone,
	stmtZone,
	type Facts,
	type Sem,
	type TaskF,
	type TaskSem,
} from '../gen/facts';
import type { Rng } from '../gen/rng';
import { gapZoneIn, slotZoneIn, TASK_TREE } from './res-zones';
import type { Drawn, Family, Region } from './types';
import { placeIn, subtreeOf, task } from './util';

const FRESH = ['zed', 'newbie', 'extra1', 'extra2', 'spare'];
const LISTS = ['flags', 'responsible', 'allocate'];

const parentOf = (f: Facts, t: TaskF): TaskF | null =>
	t.parent === null ? null : (f.byId.get(t.parent) ?? null);

/** The task and its ancestors have no own `flags`, `responsible` or `allocate`. */
function plain(f: Facts, t: TaskF | null): boolean {
	for (let x = t; x; x = parentOf(f, x))
		if (x.stmts.some((s) => LISTS.includes(s.key))) return false;
	return true;
}

const subtreeIds = (f: Facts, id: string): string[] => {
	const t = f.byId.get(id);
	return t ? [id, ...t.children.flatMap((c) => subtreeIds(f, c))] : [];
};

const siblingsOf = (f: Facts, parent: TaskF | null): TaskF[] =>
	(parent
		? parent.children.map((id) => f.byId.get(id))
		: f.tasks.filter((t) => t.parent === null)
	).filter((t): t is TaskF => t !== undefined);

function draw(type: string, f: Facts, rng: Rng): Drawn | null {
	const any = (): TaskF => rng.pick(f.tasks);
	if (type === 'addTask') {
		const containers = f.tasks.filter((t) => t.children.length > 0);
		const parent = rng.chance(0.3)
			? null
			: containers.length > 0 && rng.chance(0.7)
				? rng.pick(containers)
				: any();
		if (!plain(f, parent)) return null;
		const sibs = siblingsOf(f, parent);
		const taken = new Set(f.tasks.map((t) => t.id));
		const prefix = parent ? `${parent.id}.` : '';
		const clash = sibs.length > 0 && rng.chance(0.08);
		const id = clash
			? (sibs[0] as TaskF).id.slice(prefix.length)
			: FRESH.find((x) => !taken.has(prefix + x));
		if (!id) return null;
		const attrs: Array<readonly [TaskAttr, AttrValue]> = [['duration', `${rng.int(2, 12)}h`]];
		if (rng.chance(0.4)) attrs.push(['priority', String(rng.int(1, 999))]);
		if (rng.chance(0.3)) attrs.push(['note', '"added by an intent"']);
		return {
			intent: {
				type,
				parent: parent?.id ?? null,
				index: rng.int(0, sibs.length),
				id,
				name: 'New task',
				attrs,
			},
		};
	}
	if (type === 'deleteTask') return { intent: { type, task: any().id } };
	const t = any();
	const inside = new Set(subtreeIds(f, t.id));
	const outside = f.tasks.filter((x) => !inside.has(x.id));
	const parent = outside.length === 0 || rng.chance(0.25) ? null : rng.pick(outside);
	if (!plain(f, parent) || !plain(f, parentOf(f, t))) return null;
	const n = siblingsOf(f, parent).filter((x) => x.id !== t.id).length;
	return {
		intent: { type: 'moveTask', task: t.id, parent: parent?.id ?? null, index: rng.int(0, n) },
	};
}

/** The statements anywhere that have an item naming one of `ids` (dependencies). */
const referencing = (f: Facts, ids: ReadonlySet<string>): ReturnType<typeof stmtZone> =>
	f.tasks.flatMap((t) =>
		t.stmts
			.filter(
				(s) =>
					['depends', 'precedes'].includes(s.key) &&
					s.items?.some((i) => i.target !== null && ids.has(i.target)),
			)
			.flatMap((s) => stmtZone(f, s)),
	);

const suppZones = (f: Facts, ids: Iterable<string>): ReturnType<typeof removeZone> =>
	[...ids].flatMap((id) =>
		(f.byId.get(id)?.suppBlocks ?? []).flatMap((b) => removeZone(f, { range: b })),
	);

const mapDep = (e: string, map: (id: string) => string): string => {
	const [link = '', scn = '', gap = ''] = e.split('|');
	const [succ = '', pred = ''] = link.split('<-');
	return `${map(succ)}<-${map(pred)}|${scn}|${gap}`;
};

export const taskTreeFamily: Family = {
	name: 'task-tree',
	types: ['addTask', 'deleteTask', 'moveTask'],
	draw: (type, f, _sem, rng, aim) => (aim ? null : draw(type, f, rng)),
	region(intent: EditIntent, f: Facts): Region {
		if (intent.type === 'addTask') return slotZoneIn(TASK_TREE, f, intent.parent, intent.index);
		if (intent.type === 'deleteTask') {
			const ids = new Set(subtreeIds(f, intent.task));
			return [
				gapZoneIn(TASK_TREE, f, task(f, intent.task)),
				...referencing(f, ids),
				...suppZones(f, ids),
			];
		}
		if (intent.type === 'moveTask') {
			const t = task(f, intent.task);
			const ids = new Set(subtreeIds(f, t.id));
			// Relative references inside the block that leave it are rewritten too.
			const inner = [...ids].flatMap((id) =>
				task(f, id)
					.stmts.filter((s) => s.items?.some((i) => i.written.startsWith('!')))
					.flatMap((s) => stmtZone(f, s)),
			);
			return [
				gapZoneIn(TASK_TREE, f, t),
				...slotZoneIn(TASK_TREE, f, intent.parent, intent.index, t.id),
				...referencing(f, ids),
				...inner,
				...suppZones(f, ids),
			];
		}
		return [];
	},
	expect(sem, _f, intent): Sem {
		const out = structuredClone(sem);
		if (intent.type === 'addTask') {
			const attrs: Record<string, string[]> = {};
			for (const [k, v] of intent.attrs ?? []) attrs[k] = [normValue(String(v))];
			const id = `${intent.parent ? `${intent.parent}.` : ''}${intent.id ?? ''}`;
			const item: TaskSem = {
				id,
				parent: intent.parent,
				name: intent.name,
				attrs,
				flags: [],
				responsible: [],
				allocate: [],
			};
			out.tasks = placeIn(out.tasks, item, intent.parent, intent.index);
		} else if (intent.type === 'deleteTask') {
			const gone = new Set(subtreeOf(out.tasks, intent.task));
			out.tasks = out.tasks.filter((t) => !gone.has(t.id));
			out.deps = out.deps.filter((e) => {
				const [link = ''] = e.split('|');
				const [succ = '', pred = ''] = link.split('<-');
				return !gone.has(succ) && !gone.has(pred);
			});
		} else if (intent.type === 'moveTask') {
			const old = intent.task;
			const local = old.slice(old.lastIndexOf('.') + 1);
			const root = `${intent.parent ? `${intent.parent}.` : ''}${local}`;
			const map = (id: string): string =>
				id === old || id.startsWith(`${old}.`) ? root + id.slice(old.length) : id;
			out.tasks = out.tasks.map((t) => ({
				...t,
				id: map(t.id),
				parent: t.parent === null ? null : map(t.parent),
			}));
			out.deps = out.deps.map((e) => mapDep(e, map));
			const item = out.tasks.find((t) => t.id === root);
			if (item)
				out.tasks = placeIn(
					out.tasks,
					{ ...item, parent: intent.parent },
					intent.parent,
					intent.index,
				);
		}
		return out;
	},
};
