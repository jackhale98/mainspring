// SPDX-License-Identifier: GPL-2.0-or-later
// setWorkingHours, addLeave, updateLeave, removeLeave (7.1, 15.22). A working-hours statement whose day set
// equals the intent's is rewritten, else a new one goes at the end of the scope's group (later statements
// override earlier ones). A leave is added to the scope's last `leaves` list, else a new `leaves`
// statement is inserted; updating or removing works on one item of a list.
import type { EditIntent, LeaveSpec, LeaveType } from '../../../src/lib/tjp/edit/types';
import {
	insertZone,
	listEndZone,
	normLeave,
	normWorkingHours,
	PROJ_RANK,
	RES_RANK,
	rg,
	stmtZone,
	type Facts,
	type ItemF,
	type Rg,
	type Sem,
	type StmtF,
	type TaskF,
} from '../gen/facts';
import type { Rng } from '../gen/rng';
import type { Drawn, Family, Region } from './types';
import { own } from './util';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const dayKey = (norm: string): string => norm.split('|')[0] ?? '';
const ownerOf = (f: Facts, scope: { kind: string; resource?: string }): TaskF | null =>
	scope.kind === 'resource' ? (f.resById.get(scope.resource ?? '') ?? null) : f.project;

/** The normalised `workinghours` entries of a scope, in reading order. */
const whOf = (t: TaskF): Array<{ s: StmtF; norm: string }> =>
	own(t, 'workinghours').map((s) => ({ s, norm: normWorkingHours(s.text) }));

function nextStart(t: TaskF, s: StmtF): number {
	const b = t.body;
	const e = b?.elems.find((x) => x.from > s.range.from);
	return e ? e.start : (b?.close ?? s.range.to);
}

const hoursNorm = (hours: ReadonlyArray<readonly [string, string]> | 'off'): string =>
	hours === 'off'
		? 'off'
		: (normWorkingHours(`mon ${hours.map(([a, b]) => `${a} - ${b}`).join(', ')}`).split('|')[1] ??
			'');

/**
 * What setWorkingHours does to a scope (15.22): later statements override earlier ones day by day, so the
 * last statement with the same day set is rewritten unless a later one sets one of its days; in the
 * project, a `timezone` or `timingresolution` resets the hours, so only statements after the last one
 * count. Otherwise a new statement goes after the last counted statement, or after the reset statement,
 * or at its rank.
 */
function whPlan(
	t: TaskF,
	project: boolean,
	days: string,
): { rewrite: StmtF | null; after: StmtF | null; index: number } {
	const all = whOf(t);
	const resets = project ? own(t, 'timezone', 'timingresolution') : [];
	const reset = resets[resets.length - 1] ?? null;
	const counted = all.filter((x) => !reset || x.s.seq > reset.seq);
	const set = new Set(days.split(',').filter(Boolean));
	const at = counted.map((x) => dayKey(x.norm)).lastIndexOf(days);
	const later = at >= 0 ? counted.slice(at + 1) : [];
	if (
		at >= 0 &&
		!later.some((x) =>
			dayKey(x.norm)
				.split(',')
				.some((d) => set.has(d)),
		)
	) {
		const hit = counted[at] as { s: StmtF; norm: string };
		return { rewrite: hit.s, after: null, index: all.findIndex((x) => x.s === hit.s) };
	}
	const last = counted[counted.length - 1]?.s ?? reset;
	const index = last ? all.filter((x) => x.s.seq <= last.seq).length : all.length;
	return { rewrite: null, after: last, index };
}

const sortDays = (days: readonly string[]): string =>
	[...days].sort((a, b) => DAYS.indexOf(a as never) - DAYS.indexOf(b as never)).join(',');

interface Leave {
	scope: 'global' | string;
	stmt: StmtF;
	item: ItemF;
	index: number;
}

/** Every leave item of the plan with its scope and its place in the scope's reading order. */
function leaves(f: Facts): Leave[] {
	const out: Leave[] = [];
	const scan = (scope: string, stmts: readonly StmtF[]): void => {
		let n = 0;
		for (const s of stmts) {
			if (!['leaves', 'vacation'].includes(s.key) || s.macro) continue;
			for (const item of s.items ?? []) out.push({ scope, stmt: s, item, index: n++ });
		}
	};
	scan('global', f.globalLeaves);
	for (const r of f.resTree) scan(r.id, r.stmts);
	return out;
}

const leaveText = (l: LeaveSpec): string =>
	normLeave(
		`${l.type}${l.name ? ` "${l.name}"` : ''} ${l.start}${l.end ? (l.end.startsWith('+') ? ` ${l.end}` : ` - ${l.end}`) : ''}`,
	);

function spec(f: Facts, rng: Rng, global: boolean): LeaveSpec | null {
	const start = f.frame ? new Date((f.frame.start + 86400 * rng.int(14, 60)) * 1000) : null;
	if (!start) return null;
	const day = (d: Date, plus = 0): string =>
		new Date(d.getTime() + plus * 86400000).toISOString().slice(0, 10);
	const end = rng.pick([undefined, day(start, rng.int(1, 4)), `+${rng.int(1, 3)}d`]);
	const type: LeaveType = global ? 'holiday' : rng.pick(['annual', 'sick', 'special', 'unpaid']);
	const name = global || type === 'special' ? rng.pick(['Retreat', 'Offsite Day']) : undefined;
	return { type, ...(name ? { name } : {}), start: day(start), ...(end ? { end } : {}) };
}

function draw(type: string, f: Facts, rng: Rng): Drawn | null {
	if (type === 'setWorkingHours') {
		const resource = f.resTree.filter(
			(r) => r.children.length === 0 && !r.stmts.some((s) => s.macro),
		);
		const useRes = resource.length > 0 && rng.chance(0.5);
		const owner = useRes ? rng.pick(resource) : f.project;
		if (!owner) return null;
		const existing = whOf(owner);
		const reuse = existing.length > 0 && rng.chance(0.4);
		const picked = reuse ? rng.pick(existing).norm : '';
		const days = reuse
			? (dayKey(picked).split(',').filter(Boolean) as (typeof DAYS)[number][])
			: rng.sample(DAYS.slice(1, 6), rng.int(1, 2));
		const hours =
			rng.chance(0.15) && days.length === 1
				? ('off' as const)
				: rng.pick([
						[
							['9:00', '12:00'],
							['13:00', '17:00'],
						],
						[['8:00', '16:00']],
						[['10:00', '15:00']],
					] as const);
		const scope = useRes
			? { kind: 'resource' as const, resource: owner.id }
			: { kind: 'project' as const };
		return { intent: { type: 'setWorkingHours', scope, days, hours } as EditIntent };
	}
	const all = leaves(f);
	if (type === 'addLeave') {
		const res = f.resTree.filter((r) => r.children.length === 0);
		const global = res.length === 0 || rng.chance(0.4);
		const leave = spec(f, rng, global);
		if (!leave) return null;
		return {
			intent: {
				type,
				scope: global ? { kind: 'global' } : { kind: 'resource', resource: rng.pick(res).id },
				leave,
			},
		};
	}
	if (all.length === 0) return null;
	const l = rng.pick(all);
	const item = { file: l.item.range.file, from: l.item.range.from, to: l.item.range.to };
	if (type === 'removeLeave') return { intent: { type, leave: { item } } };
	const to = spec(f, rng, l.scope === 'global');
	return to ? { intent: { type: 'updateLeave', leave: { item }, to } } : null;
}

export const calendarFamily: Family = {
	name: 'calendar',
	types: ['setWorkingHours', 'addLeave', 'updateLeave', 'removeLeave'],
	draw: (type, f, _sem, rng) => draw(type, f, rng),
	region(intent, f): Region {
		if (intent.type === 'setWorkingHours') {
			const t = ownerOf(f, intent.scope);
			if (!t) return [];
			const plan = whPlan(t, intent.scope.kind === 'project', sortDays(intent.days));
			if (plan.rewrite) return stmtZone(f, plan.rewrite);
			if (plan.after)
				return [rg(plan.after.range.file, plan.after.range.to, nextStart(t, plan.after))];
			return insertZone(
				f,
				t,
				'workinghours',
				intent.scope.kind === 'resource' ? RES_RANK : PROJ_RANK,
			);
		}
		if (intent.type === 'addLeave') {
			const global = intent.scope.kind === 'global';
			const stmts = global
				? f.globalLeaves
				: (f.resById
						.get((intent.scope as { resource: string }).resource)
						?.stmts.filter((s) => ['leaves', 'vacation'].includes(s.key)) ?? []);
			// A `vacation` is not a `leaves` list: the item goes to the last `leaves` statement.
			const lists = stmts.filter((s) => s.key === 'leaves');
			const last = lists[lists.length - 1];
			if (last) return [listEndZone(last)];
			if (!global) {
				const r = f.resById.get((intent.scope as { resource: string }).resource);
				return r ? insertZone(f, r, 'leaves', RES_RANK) : [];
			}
			const p = f.project;
			if (!p) return [];
			const next = (f.topElems[p.block.file] ?? []).find((e) => e.from > p.block.from);
			return [
				rg(p.block.file, p.block.to, next ? next.start : (f.texts[p.block.file] ?? '').length),
			];
		}
		const ref = (intent as { leave: { item: Rg } }).leave.item;
		const hit = leaves(f).find(
			(l) => l.item.range.from === ref.from && l.item.range.file === ref.file,
		);
		if (!hit) return [];
		return intent.type === 'updateLeave' ? [hit.item.range] : stmtZone(f, hit.stmt);
	},
	expect(sem, f, intent): Sem {
		const out = structuredClone(sem);
		if (intent.type === 'setWorkingHours') {
			const target =
				intent.scope.kind === 'resource'
					? out.resources.find((r) => r.id === (intent.scope as { resource: string }).resource)
							?.attrs
					: out.project?.attrs;
			if (!target) return out;
			const t = ownerOf(f, intent.scope);
			if (!t) return out;
			const days = sortDays(intent.days);
			const plan = whPlan(t, intent.scope.kind === 'project', days);
			const norm = `${days}|${hoursNorm(intent.hours)}`;
			const list = target['workinghours'] ?? [];
			if (plan.rewrite) list[plan.index] = norm;
			else list.splice(plan.index, 0, norm);
			target['workinghours'] = list;
		} else if (intent.type === 'addLeave') {
			const list =
				intent.scope.kind === 'global'
					? out.leaves
					: out.resources.find((r) => r.id === (intent.scope as { resource: string }).resource)
							?.leaves;
			const stmts =
				intent.scope.kind === 'global'
					? f.globalLeaves
					: (f.resById.get((intent.scope as { resource: string }).resource)?.stmts ?? []);
			const mine = stmts.filter((x) => ['leaves', 'vacation'].includes(x.key));
			const lists = mine.filter((x) => x.key === 'leaves');
			const last = lists[lists.length - 1];
			const index = last
				? mine.filter((x) => x.seq <= last.seq).reduce((n, x) => n + (x.items?.length ?? 0), 0)
				: (list?.length ?? 0);
			list?.splice(index, 0, leaveText(intent.leave));
		} else if (intent.type === 'updateLeave' || intent.type === 'removeLeave') {
			const ref = intent.leave.item;
			const hit = leaves(f).find(
				(l) => l.item.range.from === ref.from && l.item.range.file === ref.file,
			);
			const list = hit
				? hit.scope === 'global'
					? out.leaves
					: out.resources.find((r) => r.id === hit.scope)?.leaves
				: undefined;
			if (!hit || !list) return out;
			if (intent.type === 'updateLeave') list[hit.index] = leaveText(intent.to);
			else list.splice(hit.index, 1);
		}
		return out;
	},
};
