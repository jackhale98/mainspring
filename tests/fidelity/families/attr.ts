// SPDX-License-Identifier: GPL-2.0-or-later
// setAttr and removeAttr (phase-1.md 7.1 rows 1 to 5 and `removeAttr`, 15.20). A value is rewritten in
// its last own unprefixed site, or inserted at its rank; milestone and removals delete statements.
import type { AttrValue, EditIntent, IntentOf, TaskAttr } from '../../../src/lib/tjp/edit/types';
import {
	effectiveIds,
	insertZone,
	normValue,
	RANK,
	rg,
	SIZING,
	stmtZone,
	type Facts,
	type Rg,
	type Sem,
	type StmtF,
	type TaskF,
} from '../gen/facts';
import type { Rng } from '../gen/rng';
import type { Drawn, Family, Region } from './types';
import {
	allocated,
	dateValue,
	declaredFlags,
	frameEnd,
	hoursValue,
	isLeaf,
	leafResources,
	own,
	parentOf,
	sorted,
	task,
} from './util';

const LISTS = new Set<TaskAttr>(['flags', 'responsible']);
/** The attributes setAttr and removeAttr accept (6.5). */
const TASK_ATTRS = new Set<string>([
	'effort',
	'duration',
	'length',
	'start',
	'end',
	'minstart',
	'maxend',
	'scheduling',
	'milestone',
	'priority',
	'note',
	'complete',
	'flags',
	'responsible',
]);
const macroStmt = (t: ReturnType<typeof task>): StmtF | undefined =>
	t.stmts.find((s) => s.macro && s.scenario === null && TASK_ATTRS.has(s.key));
const isSizing = (a: TaskAttr): boolean => (SIZING as readonly string[]).includes(a);

/** Where a new statement may go: its rank, or before another scenario's statement of the same kind (15.20). */
export function insertZones(
	f: Facts,
	t: TaskF,
	key: string,
	kinds: readonly string[],
	table: Readonly<Record<string, number>> = RANK,
): Rg[] {
	const zones = insertZone(f, t, key, table);
	const b = t.body;
	if (b) {
		const i = b.elems.findIndex(
			(e) => e.scoped === true && e.key !== null && kinds.includes(e.key),
		);
		const e = b.elems[i];
		if (e) zones.push(rg(b.file, i > 0 ? (b.elems[i - 1]?.to ?? b.open) : b.open, e.start));
	}
	return zones;
}

const kindsOf = (attr: TaskAttr): readonly string[] =>
	isSizing(attr) || attr === 'milestone' ? [...SIZING, 'milestone'] : [attr];

const NOTES = ['"rough estimate"', '"it\'s fine"', '"see the spec"', '"needs a review"'];

/** A value that passes validation for `attr`, so that only the text-only rule can refuse it. */
function validValue(attr: TaskAttr, f: Facts, rng: Rng): AttrValue {
	if (isSizing(attr)) return hoursValue(rng);
	if (attr === 'priority') return '700';
	if (attr === 'complete') return '40';
	if (attr === 'note') return '"a note"';
	if (attr === 'scheduling') return 'asap';
	if (attr === 'milestone') return true;
	if (LISTS.has(attr)) return [];
	return dateValue(rng, f) ?? '2026-02-02';
}

function drawSet(f: Facts, sem: Sem, rng: Rng): Drawn | null {
	const tasks = f.tasks;
	const leaves = tasks.filter(isLeaf);
	const pick = <T>(xs: readonly T[]): T | null => (xs.length > 0 ? rng.pick(xs) : null);
	// Text-only targets: a statement written with a macro (X3), and a keyword a statement-level macro
	// call in the body writes (macro-in-body). Both kinds are drawn when the plan has them.
	if (rng.chance(0.15)) {
		const hit = tasks.find((t) => macroStmt(t));
		const stmt = hit && macroStmt(hit);
		const call = tasks.find((t) => t.macroWords.has('priority'));
		const options: Drawn[] = [];
		if (hit && stmt) {
			const attr = stmt.key as TaskAttr;
			options.push({
				intent: { type: 'setAttr', task: hit.id, attr, value: validValue(attr, f, rng) },
				mustRefuse: ['text-only', 'macro-in-body'],
			});
		}
		if (call) {
			options.push({
				intent: { type: 'setAttr', task: call.id, attr: 'priority', value: '640' },
				mustRefuse: ['macro-in-body', 'text-only'],
			});
		}
		if (options.length > 0) return rng.pick(options);
	}
	const kind = rng.pick([
		'sizing',
		'sizing',
		'priority',
		'note',
		'complete',
		'start',
		'minstart',
		'maxend',
		'scheduling',
		'milestone',
		'flags',
		'responsible',
	]);
	const set = (t: ReturnType<typeof task>, attr: TaskAttr, value: AttrValue): Drawn => ({
		intent: { type: 'setAttr', task: t.id, attr, value },
	});
	switch (kind) {
		case 'sizing': {
			const t = pick(
				leaves.filter(
					(x) => own(x, ...SIZING).length > 0 && !own(x, ...SIZING).some((s) => s.macro),
				),
			);
			if (!t) return null;
			const old = own(t, ...SIZING).pop()?.key as TaskAttr;
			const hasRes = allocated(f, t).length > 0;
			const attr = rng.chance(0.5)
				? old
				: rng.pick(
						(hasRes ? ['effort', 'length', 'duration'] : ['length', 'duration']) as TaskAttr[],
					);
			return set(t, attr, hoursValue(rng));
		}
		case 'priority': {
			const t = pick(tasks);
			return t && set(t, 'priority', String(rng.int(1, 999)));
		}
		case 'note': {
			const t = pick(tasks);
			return t && set(t, 'note', rng.pick(NOTES));
		}
		case 'complete': {
			const t = pick(
				leaves.filter((x) => own(x, 'effort').length > 0 && !own(x, 'effort').some((s) => s.macro)),
			);
			return t && set(t, 'complete', String(rng.int(0, 99)));
		}
		case 'start': {
			const t = pick(
				leaves.filter(
					(x) =>
						own(x, 'depends').length === 0 &&
						own(x, 'end', 'precedes').length === 0 &&
						parentOf(f, x) !== undefined,
				),
			);
			const d = dateValue(rng, f);
			return t && d ? set(t, 'start', d) : null;
		}
		case 'minstart': {
			const t = pick(leaves);
			const d = dateValue(rng, f);
			return t && d ? set(t, 'minstart', d) : null;
		}
		case 'maxend': {
			const t = pick(leaves);
			const d = frameEnd(f);
			return t && d ? set(t, 'maxend', d) : null;
		}
		case 'scheduling': {
			const t = pick(leaves);
			return t && set(t, 'scheduling', 'asap');
		}
		case 'milestone': {
			const t = pick(
				leaves.filter((x) => own(x, 'milestone').length > 0 || !own(x, ...SIZING).length),
			);
			if (!t) return null;
			return set(t, 'milestone', own(t, 'milestone').length === 0);
		}
		case 'flags': {
			const flags = declaredFlags(sem);
			const t = pick(leaves);
			if (!t || flags.length === 0) return null;
			const value = sorted([...effectiveIds(f, t, 'flags'), ...rng.sample(flags, rng.int(0, 2))]);
			return set(t, 'flags', value);
		}
		default: {
			const res = leafResources(f);
			const t = pick(leaves);
			if (!t || res.length === 0) return null;
			return set(
				t,
				'responsible',
				sorted([...effectiveIds(f, t, 'responsible'), ...rng.sample(res, rng.int(0, 1))]),
			);
		}
	}
}

const REMOVABLE: readonly TaskAttr[] = [
	'priority',
	'note',
	'complete',
	'start',
	'minstart',
	'maxend',
	'scheduling',
	'flags',
	'responsible',
];

function drawRemove(f: Facts, _sem: Sem, rng: Rng): Drawn | null {
	const rm = (id: string, attr: TaskAttr): Drawn => ({
		intent: { type: 'removeAttr', task: id, attr },
	});
	// A mode with no candidate in this plan returns null, so the case is redrawn on another plan.
	const mode = rng.pick([
		'macro',
		'absent',
		'inherited',
		'multi',
		'multi',
		'plain',
		'plain',
		'plain',
	]);
	if (mode === 'macro') {
		const t = f.tasks.find((x) => macroStmt(x));
		const s = t && macroStmt(t);
		return t && s
			? {
					intent: { type: 'removeAttr', task: t.id, attr: s.key as TaskAttr },
					mustRefuse: ['text-only', 'macro-in-body'],
				}
			: null;
	}
	if (mode === 'absent') {
		const t = rng.pick(f.tasks);
		const absent = REMOVABLE.filter(
			(a) => own(t, a).length === 0 && effectiveIds(f, t, a).length === 0,
		);
		return absent.length > 0 ? rm(t.id, rng.pick(absent)) : null;
	}
	if (mode === 'inherited') {
		const t = f.tasks.find((x) => {
			const p = parentOf(f, x);
			return (
				p !== null &&
				own(x, 'priority').length === 0 &&
				own(p, 'priority').some((s) => s.seq < x.seq && !s.macro)
			);
		});
		return t ? rm(t.id, 'priority') : null;
	}
	const cands = f.tasks.flatMap((t) =>
		REMOVABLE.filter((a) => {
			const s = own(t, a);
			if (s.length === 0 || s.some((x) => x.macro)) return false;
			if (mode === 'multi' && s.length < 2) return false;
			if (LISTS.has(a) && !isLeaf(t)) return false;
			// Dropping the start of a task with no size, no dependency and no other end would leave it underspecified.
			if (
				a === 'start' &&
				(!isLeaf(t) || (own(t, ...SIZING).length === 0 && own(t, 'depends').length === 0))
			)
				return false;
			if (a === 'complete' && own(t, 'effort').length === 0) return false;
			return true;
		}).map((a) => [t.id, a] as const),
	);
	if (cands.length === 0) return null;
	const [id, attr] = rng.pick(cands);
	return rm(id, attr);
}

export const attrFamily: Family = {
	name: 'attr',
	types: ['setAttr', 'removeAttr'],
	draw(type, f, sem, rng) {
		return type === 'setAttr' ? drawSet(f, sem, rng) : drawRemove(f, sem, rng);
	},
	region(intent: EditIntent, f: Facts): Region {
		if (intent.type === 'setAttr') {
			const t = task(f, intent.task);
			const a = intent.attr;
			if (isSizing(a)) {
				const s = own(t, ...SIZING);
				return s.length > 0 ? s.flatMap((x) => stmtZone(f, x)) : insertZones(f, t, a, kindsOf(a));
			}
			if (a === 'milestone') {
				const s = own(t, 'milestone');
				if (intent.value === false) return s.flatMap((x) => stmtZone(f, x));
				return s.length > 0 ? [] : insertZones(f, t, a, kindsOf(a));
			}
			const s = own(t, a);
			if (LISTS.has(a))
				return s.length > 0 ? s.flatMap((x) => stmtZone(f, x)) : insertZones(f, t, a, kindsOf(a));
			const last = s[s.length - 1];
			return last ? [last.range] : insertZones(f, t, a, kindsOf(a));
		}
		if (intent.type === 'removeAttr') {
			const t = task(f, intent.task);
			return own(t, intent.attr).flatMap((x) => stmtZone(f, x));
		}
		return [];
	},
	expect(sem, f, intent): Sem {
		const out = structuredClone(sem);
		if (intent.type === 'setAttr') {
			const ts = out.tasks.find((t) => t.id === intent.task);
			if (!ts) return out;
			const a = intent.attr;
			const v = normValue(String(intent.value));
			if (isSizing(a)) {
				for (const k of SIZING) delete ts.attrs[k];
				ts.attrs[a] = [v];
			} else if (a === 'milestone') {
				if (intent.value === false) delete ts.attrs['milestone'];
				else ts.attrs['milestone'] ??= [''];
			} else if (a === 'flags' || a === 'responsible') {
				ts[a] = sorted(intent.value as readonly string[]);
			} else {
				const arr = ts.attrs[a] ?? [];
				ts.attrs[a] = arr.length > 0 ? [...arr.slice(0, -1), v] : [v];
			}
		} else if (intent.type === 'removeAttr') {
			const ts = out.tasks.find((t) => t.id === intent.task);
			if (!ts) return out;
			const a = intent.attr;
			delete ts.attrs[a];
			if (a === 'flags' || a === 'responsible') {
				const t = task(f, intent.task);
				const p = parentOf(f, t);
				ts[a] = p ? sorted(effectiveIds(f, p, a, t.seq)) : [];
			}
		}
		return out;
	},
};

export type SetAttr = IntentOf<'setAttr'>;
