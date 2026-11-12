// SPDX-License-Identifier: GPL-2.0-or-later
// addResource, deleteResource, moveResource, renameResource, setResourceAttr, removeResourceAttr
// (7.1, 15.22). Resource ids are global, so a move changes no references; a delete removes the
// `allocate`, `responsible` and `managers` items that name the subtree and its supplement blocks;
// attributes are written like a task's, at their rank in the resource order of 7.2.
import type { AttrValue, EditIntent, ResourceAttr } from '../../../src/lib/tjp/edit/types';
import {
	effectiveManagers,
	normValue,
	RES_RANK,
	removeZone,
	stmtZone,
	type Facts,
	type ResSem,
	type Sem,
	type TaskF,
} from '../gen/facts';
import type { Rng } from '../gen/rng';
import { insertZones } from './attr';
import { gapZone, slotZone } from './res-zones';
import type { Drawn, Family, Region } from './types';
import { own, sorted } from './util';

const NAMES = ['Gus Gray', "Hal O'Neil", 'Ida', 'Joe "J" Kim', 'Kim'];
const FRESH = ['gus', 'hal', 'ida', 'joe', 'kim', 'lou'];
const UNSAFE = ['cost ${x}', 'two\nlines'];

const res = (f: Facts, id: string): TaskF => {
	const r = f.resById.get(id);
	if (!r) throw new Error(`no resource ${id}`);
	return r;
};

const subtree = (f: Facts, id: string): string[] => {
	const r = f.resById.get(id);
	return r ? [id, ...r.children.flatMap((c) => subtree(f, c))] : [];
};
const subtreeSem = (list: readonly ResSem[], id: string): string[] => [
	id,
	...list.filter((r) => r.parent === id).flatMap((r) => subtreeSem(list, r.id)),
];

/** The list with `item` placed as child number `index` of `parent`, after removing it from where it was. */
function place(
	list: readonly ResSem[],
	item: ResSem,
	parent: string | null,
	index: number,
): ResSem[] {
	const gone = new Set(subtreeSem(list, item.id));
	const moved = list.filter((r) => gone.has(r.id));
	const rest = list.filter((r) => !gone.has(r.id));
	const sibs = rest.filter((r) => r.parent === parent);
	const block = moved.length > 0 ? moved.map((r) => (r.id === item.id ? item : r)) : [item];
	const end = (id: string): number => {
		const sub = new Set(subtreeSem(rest, id));
		return rest.reduce((n, r, i) => (sub.has(r.id) ? i + 1 : n), 0);
	};
	let at: number;
	const target = sibs[index];
	if (target) at = rest.indexOf(target);
	else {
		const last = sibs[sibs.length - 1];
		const par = parent === null ? undefined : rest.find((r) => r.id === parent);
		at = last ? end(last.id) : par ? rest.indexOf(par) + 1 : rest.length;
	}
	return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

const hasManagers = (f: Facts, r: TaskF | null): boolean => {
	for (let x = r; x; x = x.parent === null ? null : (f.resById.get(x.parent) ?? null)) {
		if (own(x, 'managers').length > 0) return true;
	}
	return false;
};

/** Whether `from` reaches `target` through `managers`. */
function reaches(f: Facts, from: string, target: string, seen = new Set<string>()): boolean {
	if (from === target) return true;
	if (seen.has(from)) return false;
	seen.add(from);
	const r = f.resById.get(from);
	return r ? effectiveManagers(f, r).some((m) => reaches(f, m, target, seen)) : false;
}

const VALUES: Readonly<Record<string, readonly string[]>> = {
	efficiency: ['0.8', '1', '1.2'],
	rate: ['90', '120.5'],
	email: ['"dev@example.org"', '"a.b@example.com"'],
};

function draw(type: string, f: Facts, rng: Rng): Drawn | null {
	if (f.resTree.length === 0 && type !== 'addResource') return null;
	const any = (): TaskF => rng.pick(f.resTree);
	if (type === 'addResource') {
		const taken = new Set(f.resTree.map((r) => r.id));
		const parent = f.resTree.length > 0 && rng.chance(0.5) ? any() : null;
		const n = parent ? parent.children.length : f.resTree.filter((r) => r.parent === null).length;
		const clash = f.resTree.length > 0 && rng.chance(0.08);
		const id = clash ? any().id : rng.pick(FRESH.filter((x) => !taken.has(x)));
		if (!id) return null;
		const attrs: Array<readonly [ResourceAttr, AttrValue]> = [];
		if (rng.chance(0.4)) attrs.push(['email', rng.pick(VALUES['email'] as string[])]);
		if (rng.chance(0.3)) attrs.push(['efficiency', rng.pick(VALUES['efficiency'] as string[])]);
		const intent: EditIntent = {
			type: 'addResource',
			parent: parent?.id ?? null,
			index: rng.int(0, n),
			id,
			name: rng.pick(NAMES),
			...(attrs.length > 0 ? { attrs } : {}),
		};
		return { intent };
	}
	if (type === 'deleteResource') {
		// Half the time a resource nobody allocates, which can go.
		const used = new Set(
			f.tasks.flatMap((t) => t.stmts.flatMap((x) => (x.items ?? []).map((i) => i.target))),
		);
		const free = f.resTree.filter((r) => !subtree(f, r.id).some((id) => used.has(id)));
		return {
			intent: { type, resource: (free.length > 0 && rng.chance(0.5) ? rng.pick(free) : any()).id },
		};
	}
	if (type === 'renameResource') {
		const r = any();
		if (rng.chance(0.12))
			return {
				intent: { type, resource: r.id, name: rng.pick(UNSAFE) },
				mustRefuse: ['unsafe-text'],
			};
		return { intent: { type, resource: r.id, name: rng.pick(NAMES) } };
	}
	if (type === 'moveResource') {
		const r = any();
		const inside = new Set(subtree(f, r.id));
		const targets = [null, ...f.resTree.filter((x) => !inside.has(x.id))];
		const parent = rng.pick(targets);
		if (
			hasManagers(f, r.parent === null ? null : (f.resById.get(r.parent) ?? null)) ||
			hasManagers(f, parent)
		)
			return null;
		if (subtree(f, r.id).some((id) => own(res(f, id), 'managers').length > 0) && parent !== null)
			return null;
		const n = (
			parent ? parent.children : f.resTree.filter((x) => x.parent === null).map((x) => x.id)
		).filter((x) => x !== r.id).length;
		return { intent: { type, resource: r.id, parent: parent?.id ?? null, index: rng.int(0, n) } };
	}
	const attrs = ['efficiency', 'rate', 'email', 'managers'] as ResourceAttr[];
	if (type === 'removeResourceAttr') {
		const cands = f.resTree.flatMap((r) =>
			attrs
				.filter((a) => own(r, a).length > 0 && (a !== 'managers' || r.children.length === 0))
				.map((a) => [r.id, a] as const),
		);
		const [id, attr] =
			cands.length > 0 && rng.chance(0.85)
				? rng.pick(cands)
				: ([any().id, rng.pick(attrs)] as const);
		return { intent: { type, resource: id, attr } };
	}
	const attr = rng.pick(attrs);
	if (attr === 'managers') {
		const leaves = f.resTree.filter((r) => r.children.length === 0);
		const r = rng.pick(leaves);
		const ok = leaves.filter((m) => m.id !== r.id && !reaches(f, m.id, r.id));
		if (ok.length === 0) return null;
		const value = sorted([...effectiveManagers(f, r), rng.pick(ok).id]);
		return { intent: { type: 'setResourceAttr', resource: r.id, attr, value } };
	}
	return {
		intent: {
			type: 'setResourceAttr',
			resource: any().id,
			attr,
			value: rng.pick(VALUES[attr] as string[]),
		},
	};
}

export const resourcesFamily: Family = {
	name: 'resources',
	types: [
		'addResource',
		'deleteResource',
		'moveResource',
		'renameResource',
		'setResourceAttr',
		'removeResourceAttr',
	],
	draw: (type, f, _sem, rng) => draw(type, f, rng),
	region(intent, f): Region {
		switch (intent.type) {
			case 'addResource':
				return slotZone(f, intent.parent, intent.index);
			case 'deleteResource': {
				const ids = new Set(subtree(f, intent.resource));
				const refs = [...f.tasks, ...f.resTree].flatMap((t) =>
					t.stmts
						.filter(
							(s) =>
								['allocate', 'responsible', 'managers'].includes(s.key) &&
								s.items?.some((i) => ids.has(i.target ?? i.written)),
						)
						.flatMap((s) => stmtZone(f, s)),
				);
				const supp = [...ids].flatMap((id) =>
					(res(f, id).suppBlocks ?? []).flatMap((b) => removeZone(f, { range: b })),
				);
				return [gapZone(f, res(f, intent.resource)), ...refs, ...supp];
			}
			case 'moveResource':
				return [
					gapZone(f, res(f, intent.resource)),
					...slotZone(f, intent.parent, intent.index, intent.resource),
				];
			case 'renameResource': {
				const at = res(f, intent.resource).nameAt;
				return at ? [at] : [];
			}
			case 'setResourceAttr': {
				const r = res(f, intent.resource);
				const s = own(r, intent.attr);
				if (intent.attr === 'managers')
					return s.length > 0
						? s.flatMap((x) => stmtZone(f, x))
						: insertZones(f, r, 'managers', ['managers'], RES_RANK);
				const last = s[s.length - 1];
				return last ? [last.range] : insertZones(f, r, intent.attr, [intent.attr], RES_RANK);
			}
			case 'removeResourceAttr':
				return own(res(f, intent.resource), intent.attr).flatMap((x) => stmtZone(f, x));
			default:
				return [];
		}
	},
	expect(sem, f, intent): Sem {
		const out = structuredClone(sem);
		const rs = out.resources;
		const find = (id: string): ResSem | undefined => rs.find((r) => r.id === id);
		if (intent.type === 'addResource') {
			const attrs: Record<string, string[]> = {};
			for (const [k, v] of intent.attrs ?? []) attrs[k] = [normValue(String(v))];
			// A child inherits the managers its parent has when it is created (15.22).
			const inherited = rs.find((r) => r.id === intent.parent)?.managers ?? [];
			const item: ResSem = {
				id: intent.id ?? '',
				parent: intent.parent,
				name: intent.name,
				attrs,
				managers: [...inherited],
				leaves: [],
			};
			out.resources = place(rs, item, intent.parent, intent.index);
		} else if (intent.type === 'deleteResource') {
			const gone = new Set(subtreeSem(rs, intent.resource));
			out.resources = rs.filter((r) => !gone.has(r.id));
			for (const r of out.resources) r.managers = r.managers.filter((m) => !gone.has(m));
			for (const t of out.tasks) {
				t.allocate = t.allocate.filter((x) => !gone.has(x));
				t.responsible = t.responsible.filter((x) => !gone.has(x));
			}
		} else if (intent.type === 'moveResource') {
			const item = find(intent.resource);
			if (item)
				out.resources = place(rs, { ...item, parent: intent.parent }, intent.parent, intent.index);
		} else if (intent.type === 'renameResource') {
			const r = find(intent.resource);
			if (r) r.name = intent.name;
		} else if (intent.type === 'setResourceAttr') {
			const r = find(intent.resource);
			if (!r) return out;
			if (intent.attr === 'managers') r.managers = sorted(intent.value as readonly string[]);
			else {
				const v = normValue(String(intent.value));
				const arr = r.attrs[intent.attr] ?? [];
				r.attrs[intent.attr] = arr.length > 0 ? [...arr.slice(0, -1), v] : [v];
			}
		} else if (intent.type === 'removeResourceAttr') {
			const r = find(intent.resource);
			if (!r) return out;
			if (intent.attr === 'managers') {
				const x = res(f, intent.resource);
				const p = x.parent === null ? undefined : f.resById.get(x.parent);
				r.managers = p ? sorted(effectiveManagers(f, p, x.seq)) : [];
			} else delete r.attrs[intent.attr];
		}
		return out;
	},
};
