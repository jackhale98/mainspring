// SPDX-License-Identifier: GPL-2.0-or-later
// Semantics: what the index must read from a plan, derived from the facts (gen/facts.ts). The printer's
// record gives the semantics before an edit, the facts read from the index after it give the actual,
// and a family's `expect` gives the model update in between (P3).
import type { Facts, StmtF, TaskF } from './facts';

export const LIST_KEYS = new Set([
	'flags',
	'responsible',
	'depends',
	'precedes',
	'allocate',
	'managers',
]);
const LEAVE_KEYS = new Set(['leaves', 'vacation']);

export interface PropSem {
	id: string;
	parent: string | null;
	name: string | null;
	/** `scenario:keyword` or `keyword` to its values in reading order (lists and leaves excluded). */
	attrs: Record<string, string[]>;
}
export interface TaskSem extends PropSem {
	/** Effective ids: own statements plus those an ancestor's statements read before this task give. */
	flags: string[];
	responsible: string[];
	allocate: string[];
}
export interface ResSem extends PropSem {
	managers: string[];
	/** Normalised leave items (`normLeave`) in reading order. */
	leaves: string[];
}
export interface ProjSem {
	name: string | null;
	/** Start and end in epoch seconds, when known. */
	frame: [number, number] | null;
	attrs: Record<string, string[]>;
}
export interface Sem {
	tasks: TaskSem[];
	resources: ResSem[];
	project: ProjSem | null;
	flags: string[];
	/** `succ<-pred|scenario|gap` for every item of every own `depends` and `precedes`. */
	deps: string[];
	/** Normalised file-level leave items. */
	leaves: string[];
}

/** A value as the plan means it: trimmed, unquoted, escapes undone, whitespace collapsed. */
export function normValue(text: string): string {
	const t = text.trim();
	const m = /^(["'])([\s\S]*)\1$/.exec(t);
	if (m) return (m[2] as string).replace(/\\(["'\\])/g, '$1');
	return t.replace(/\s+/g, ' ');
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** A `workinghours` statement as its day set and its hours: `mon,tue|540-720,780-1020` or `…|off`. */
export function normWorkingHours(text: string): string {
	const cut = text.search(/\d|\boff\b/);
	const dayText = cut < 0 ? text : text.slice(0, cut);
	const days = new Set<number>();
	for (const part of dayText.split(',')) {
		const m = /^\s*([a-z]+)\s*(?:-\s*([a-z]+))?\s*$/.exec(part);
		if (!m) continue;
		const a = DAYS.indexOf(m[1] as string);
		const b = m[2] ? DAYS.indexOf(m[2]) : a;
		if (a < 0 || b < 0) continue;
		for (let d = a; ; d = (d + 1) % 7) {
			days.add(d);
			if (d === b) break;
		}
	}
	const rest = cut < 0 ? '' : text.slice(cut);
	const hours = /\boff\b/.test(rest)
		? 'off'
		: [...rest.matchAll(/(\d{1,2}):(\d\d)\s*-\s*(\d{1,2}):(\d\d)/g)]
				.map((m) => `${Number(m[1]) * 60 + Number(m[2])}-${Number(m[3]) * 60 + Number(m[4])}`)
				.join(',');
	return `${[...days]
		.sort((x, y) => x - y)
		.map((d) => DAYS[d])
		.join(',')}|${hours}`;
}

/** A leave item as `type|name|start|end`, the end as `-date` or `+duration`. */
export function normLeave(text: string): string {
	const m =
		/^\s*(\w+)\s*(?:"([^"]*)")?\s*(\d{4}-\d\d-\d\d(?:-[\d:]+)?)(?:\s*([-+])\s*(\S+))?\s*$/.exec(
			text,
		);
	if (!m) return text.replace(/\s+/g, ' ').trim();
	return `${m[1]}|${m[2] ?? ''}|${m[3]}|${m[4] ? `${m[4]}${m[5]}` : ''}`;
}

/** Ids an owner has in a list attribute: own unprefixed statements before `upto`, then the parent's. */
export function effectiveIdsIn(
	lookup: (id: string) => TaskF | undefined,
	t: TaskF,
	key: string,
	upto = Infinity,
): string[] {
	const own = t.stmts
		.filter((s) => s.key === key && s.scenario === null && s.seq < upto && !s.macro)
		.flatMap((s) => (s.items ?? []).map((i) => i.target ?? i.written));
	const parent = t.parent === null ? undefined : lookup(t.parent);
	const inherited = parent ? effectiveIdsIn(lookup, parent, key, t.seq) : [];
	return [...new Set([...own, ...inherited])];
}

/** Ids a task has in a list attribute (see `effectiveIdsIn`). */
export const effectiveIds = (f: Facts, t: TaskF, key: string, upto = Infinity): string[] =>
	effectiveIdsIn((id) => f.byId.get(id), t, key, upto);

/** Ids a resource has in `managers`. */
export const effectiveManagers = (f: Facts, t: TaskF, upto = Infinity): string[] =>
	effectiveIdsIn((id) => f.resById.get(id), t, 'managers', upto);

function attrsOf(stmts: readonly StmtF[]): Record<string, string[]> {
	const attrs: Record<string, string[]> = {};
	for (const s of stmts) {
		if (s.macro || LIST_KEYS.has(s.key) || LEAVE_KEYS.has(s.key)) continue;
		const k = s.scenario ? `${s.scenario}:${s.key}` : s.key;
		const v = s.key === 'workinghours' ? normWorkingHours(s.text) : normValue(s.text);
		(attrs[k] ??= []).push(v);
	}
	return attrs;
}

const leavesOf = (stmts: readonly StmtF[]): string[] =>
	stmts
		.filter((s) => LEAVE_KEYS.has(s.key) && !s.macro)
		.flatMap((s) => (s.items ?? []).map((i) => normLeave(i.written)));

export function semOf(f: Facts): Sem {
	const deps: string[] = [];
	const tasks = f.tasks.map((t): TaskSem => {
		for (const s of t.stmts) {
			if (s.macro || (s.key !== 'depends' && s.key !== 'precedes')) continue;
			for (const i of s.items ?? []) {
				const other = i.target ?? i.written;
				const [succ, pred] = s.key === 'depends' ? [t.id, other] : [other, t.id];
				const gap = i.gap ? `${i.gap.kind} ${i.gap.value}` : '';
				deps.push(`${succ}<-${pred}|${s.scenario ?? ''}|${gap}`);
			}
		}
		const eff = (key: string): string[] => effectiveIds(f, t, key).sort();
		return {
			id: t.id,
			parent: t.parent,
			name: t.nameMacro ? null : t.name,
			attrs: attrsOf(t.stmts),
			flags: eff('flags'),
			responsible: eff('responsible'),
			allocate: eff('allocate'),
		};
	});
	const resources = f.resTree.map((r): ResSem => ({
		id: r.id,
		parent: r.parent,
		name: r.nameMacro ? null : r.name,
		attrs: attrsOf(r.stmts),
		managers: effectiveManagers(f, r).sort(),
		leaves: leavesOf(r.stmts),
	}));
	const p = f.project;
	const flags = f.flagDecls.flatMap((d) => (d.items ?? []).map((i) => i.written));
	return {
		tasks,
		resources,
		project: p
			? {
					name: p.nameMacro ? null : p.name,
					frame: f.frame ? [f.frame.start, f.frame.end] : null,
					attrs: attrsOf(p.stmts),
				}
			: null,
		flags: [...new Set(flags)].sort(),
		deps: deps.sort(),
		leaves: leavesOf(f.globalLeaves),
	};
}

/** The same semantics with every order-free part sorted, for comparing. */
export function canonSem(s: Sem): Sem {
	const sort = <T>(o: Record<string, T>): Record<string, T> =>
		Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
	return {
		...s,
		tasks: s.tasks.map((t) => ({ ...t, attrs: sort(t.attrs) })),
		resources: s.resources.map((r) => ({ ...r, attrs: sort(r.attrs) })),
		project: s.project ? { ...s.project, attrs: sort(s.project.attrs) } : null,
		flags: [...s.flags].sort(),
		deps: [...s.deps].sort(),
	};
}
