// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What a task's people did in one window (6.3 rules 2 and 4): each person's time in the window,
 * classified from the engine's intervals, and the `busy`, `leave` and `off-hours` causes that
 * partition it. Used for the wait before a task's anchor (explain.ts) and for the gaps inside an
 * effort bar.
 *
 * - **Classes.** A slot of a person is `free` (in `PersonAvailability.free`, or booked on this very
 *   task), `busy` (booked on another task), `leave` (v3 `leaves`, by type) or `off` (none of these:
 *   outside their working hours). Slots under two or more global leaves are in neither `working`
 *   nor `leaves` (ADR-0014 amendment 2026-11-16); they read as leave of the global type the
 *   scoreboard holds there (the later leave), not as off hours.
 * - **One cause per stretch.** A busy or leave stretch runs from its first slot to its last: the
 *   off hours between two busy stretches, or between two stretches of the same leave type, are
 *   part of it, so a fortnight on another task is one cause, not one per day. A busy cause lists
 *   the tasks the person was booked on in it and their minutes (booked minutes, not the window).
 * - **The project calendar.** Where every person is off and the project has no working time, or
 *   every person has the same leave type and a global leave of that type covers it, the cause is
 *   the project's (`resource: null`), once, not once per person.
 * - **Partition.** For each person, their own causes and the project's tile the window exactly,
 *   without overlap, and nothing extends outside it (the property test checks it).
 */
// T10: the stretch rule is a display reading of the T2 ruling that "the nights and weekends inside
// a leave read as `off-hours`": they are off hours on the scoreboard, and a stretch's minutes count
// only its booked or leave slots, but 9.7's causes ("Dev 1 is on annual leave, Mon 16 to Fri 20
// Mar") are one sentence per stretch.
// T10: the T2 ruling reads `resource: null` as the project's own calendar. A stretch is the
// project's only where it is the same for every person asked for and the project calendar says so
// too (no project working time, or a global leave of that type); a part-timer's afternoon is theirs.
// T10: slots under two global leaves (in neither `workingTime` nor `leaves`) read as the later
// leave, the type the scoreboard holds there (ResourceScenario#initScoreboard), not as off hours.
import type { EngineLeaveType, Minutes } from '../../engine/protocol';
import type { ResourceId, TaskId } from '../tjp/index';
import { minutesIn, overlaps, subtract } from '../workload/intervals';
import type { IntervalSet, PersonAvailability } from '../workload/types';
import type { Cause } from './explain-types';
import { clip, globalTypeAt, type GlobalPiece, type Prep } from './explain-prep';

export type SlotClass = 'busy' | 'leave' | 'off' | 'free';

export interface Segment {
	readonly from: Minutes;
	readonly to: Minutes;
	readonly cls: SlotClass;
	/** The leave type for `leave`, else null. */
	readonly type: EngineLeaveType | null;
}

type Pair = readonly [Minutes, Minutes];

/** A person's time in [from, to), as ascending segments that tile it. */
export function segmentsOf(
	person: PersonAvailability,
	own: IntervalSet,
	from: Minutes,
	to: Minutes,
	prep: Pick<Prep, 'overlaps' | 'global'>,
): Segment[] {
	const pieces: Segment[] = [];
	const add = (set: Iterable<Pair>, cls: SlotClass, type: EngineLeaveType | null): void => {
		for (const [a, b] of set) if (b > a) pieces.push({ from: a, to: b, cls, type });
	};
	const booked = clip(person.booked, from, to);
	const mine = clip(own, from, to);
	add(subtract(booked, mine), 'busy', null);
	add(mine, 'free', null);
	add(clip(person.free, from, to), 'free', null);
	for (const l of person.leave) add(clip(l.intervals, from, to), 'leave', l.type);
	pieces.sort((x, y) => x.from - y.from);

	const out: Segment[] = [];
	let t = from;
	const gap = (a: Minutes, b: Minutes): void => {
		if (b > a) for (const s of offOrOverlap(a, b, prep)) out.push(s);
	};
	for (const s of pieces) {
		gap(t, s.from);
		out.push(s);
		t = s.to;
	}
	gap(t, to);
	return out;
}

/** Off hours in [a, b), except slots under two global leaves, which read as the later leave. */
function offOrOverlap(a: Minutes, b: Minutes, prep: Pick<Prep, 'overlaps' | 'global'>): Segment[] {
	const out: Segment[] = [];
	let t = a;
	for (const [x0, y] of clip(prep.overlaps, a, b)) {
		let x = x0;
		if (x > t) out.push({ from: t, to: x, cls: 'off', type: null });
		for (const g of globalIn(prep.global, x, y)) {
			if (g.from > x) out.push({ from: x, to: g.from, cls: 'off', type: null });
			out.push({ from: g.from, to: g.to, cls: 'leave', type: g.type });
			x = g.to;
		}
		if (y > x) out.push({ from: x, to: y, cls: 'off', type: null });
		t = y;
	}
	if (b > t) out.push({ from: t, to: b, cls: 'off', type: null });
	return out;
}

function globalIn(global: readonly GlobalPiece[], a: Minutes, b: Minutes): GlobalPiece[] {
	const out: GlobalPiece[] = [];
	for (const g of global) {
		if (g.to <= a) continue;
		if (g.from >= b) break;
		out.push({ from: Math.max(g.from, a), to: Math.min(g.to, b), type: g.type });
	}
	return out;
}

const same = (x: Segment, y: Segment): boolean => x.cls === y.cls && x.type === y.type;

/** Joins touching segments of one class, and busy or leave stretches across the off hours between. */
export function stretches(segs: readonly Segment[]): Segment[] {
	const out: Segment[] = [];
	for (const s of segs) {
		const last = out[out.length - 1];
		const before = out[out.length - 2];
		if (last && same(last, s)) {
			out[out.length - 1] = { ...last, to: s.to };
		} else if (last?.cls === 'off' && before && same(before, s) && s.cls !== 'free') {
			out.pop();
			out[out.length - 1] = { ...before, to: s.to };
		} else out.push(s);
	}
	return out;
}

/** Whether a person had time the task could have used in [from, to) (rule 2: free time). */
export function hadFree(
	person: PersonAvailability,
	own: IntervalSet,
	from: Minutes,
	to: Minutes,
): boolean {
	return overlaps(person.free, from, to) || overlaps(own, from, to);
}

interface Open {
	resource: ResourceId | null;
	cls: SlotClass;
	type: EngineLeaveType | null;
	from: Minutes;
	to: Minutes;
}

/**
 * The causes that partition [from, to) for these people (none of them free in it), in time order,
 * the project's first at the same instant, then the people in the order given.
 */
export function windowCauses(
	task: TaskId,
	people: ReadonlyArray<{ readonly id: ResourceId; readonly person: PersonAvailability }>,
	from: Minutes,
	to: Minutes,
	prep: Prep,
): Cause[] {
	if (to <= from || people.length === 0) return [];
	const lanes = people.map((p) =>
		stretches(segmentsOf(p.person, prep.own(p.id, task), from, to, prep)),
	);
	const working = clip(prep.projectTime, from, to);
	const cuts = new Set<Minutes>([from, to]);
	for (const lane of lanes) for (const s of lane) cuts.add(s.from);
	for (const [a, b] of working) cuts.add(a).add(b);
	for (const g of globalIn(prep.global, from, to)) cuts.add(g.from).add(g.to);
	const points = [...cuts].sort((x, y) => x - y);

	const done: Open[] = [];
	const open = new Map<ResourceId | null, Open>();
	const put = (resource: ResourceId | null, s: Segment, a: Minutes, b: Minutes): void => {
		const o = open.get(resource);
		if (o && o.to === a && o.cls === s.cls && o.type === s.type) {
			o.to = b;
			return;
		}
		if (o) done.push(o);
		open.set(resource, { resource, cls: s.cls, type: s.type, from: a, to: b });
	};
	const at = lanes.map(() => 0);
	let w = 0;
	for (let k = 0; k + 1 < points.length; k++) {
		const a = points[k] as Minutes;
		const b = points[k + 1] as Minutes;
		const segs = lanes.map((lane, i) => {
			while ((lane[at[i] as number] as Segment).to <= a) at[i] = (at[i] as number) + 1;
			return lane[at[i] as number] as Segment;
		});
		while (w < working.length && (working[w] as Pair)[1] <= a) w++;
		const projectWorks = w < working.length && (working[w] as Pair)[0] <= a;
		const first = segs[0] as Segment;
		const shared =
			segs.every((s) => same(s, first)) &&
			((first.cls === 'off' && !projectWorks) ||
				(first.cls === 'leave' && globalTypeAt(prep.global, a) === first.type));
		if (shared) put(null, first, a, b);
		else segs.forEach((s, i) => put((people[i] as { id: ResourceId }).id, s, a, b));
	}
	done.push(...open.values());

	const order = new Map<ResourceId | null, number>([[null, -1]]);
	people.forEach((p, i) => order.set(p.id, i));
	done.sort(
		(x, y) => x.from - y.from || (order.get(x.resource) ?? 0) - (order.get(y.resource) ?? 0),
	);
	return done.map((o) => causeOf(o, task, people));
}

function causeOf(
	o: Open,
	task: TaskId,
	people: ReadonlyArray<{ readonly id: ResourceId; readonly person: PersonAvailability }>,
): Cause {
	const window: [Minutes, Minutes] = [o.from, o.to];
	if (o.cls === 'leave' && o.type !== null) {
		return { kind: 'leave', resource: o.resource, type: o.type, window };
	}
	if (o.cls === 'busy' && o.resource !== null) {
		const person = people.find((p) => p.id === o.resource)?.person;
		const on: Array<{ task: TaskId; minutes: number }> = [];
		for (const t of person?.tasks ?? []) {
			if (t.task === task) continue;
			const minutes = minutesIn(t.intervals, o.from, o.to);
			if (minutes > 0) on.push({ task: t.task, minutes });
		}
		return { kind: 'busy', resource: o.resource, window, on };
	}
	return { kind: 'off-hours', resource: o.resource, window };
}
