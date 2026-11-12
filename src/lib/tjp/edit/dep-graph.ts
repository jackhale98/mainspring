// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Dependency loops as TaskJuggler finds them (phase-1.md 7.1 `addDepends` `cycle`), over the
 * declared graph in the index. A port of the parts of TaskScenario.rb (3.8.4) that decide it:
 *
 * - `Xref` (:166-180): a `depends` item of S naming P (default `onend`) adds (P, onEnd) to S's
 *   start predecessors and S to P's end (or start) successors; a `precedes` item of P naming S
 *   (default `onstart`) adds (S, onEnd) to P's end successors and P to S's start predecessors
 *   when it targets S's start.
 * - `checkForLoops` (:628-787) over those nodes: dep-loops.ts.
 * - Per scenario: a prefixed attribute applies to its scenario and the ones derived from it.
 * - The scheduling direction (`forward`) is the last write in reading order of `start`,
 *   `depends`, `scheduling asap` (true) and `end`, `precedes`, `scheduling alap` (false),
 *   starting from the parent's value when the task was declared (`inheritAttributes`). The
 *   inheritable lists `depends`, `precedes` and `allocate` start from the parent's too.
 * - Milestones: `milestone`, or the automatic promotion of `markAsMilestone` (:2280-2310) for a
 *   leaf without sizing, bookings or allocations.
 *
 * `newLoop` reports the first scenario where adding a dependency makes a loop the graph did not
 * have, so a plan that already loops does not make unrelated edits refuse: one TaskJuggler's
 * check finds (`loop_detected`), or a cycle of time points it misses and then cannot handle
 * (dep-loops.ts `hasCycle`: the stack overflows in `calcPathCriticalness`, before scheduling). `taskState` gives the same reading of one task to the allocation intents
 * (inherited allocations, sizing); `ownAlapBefore` gives deps.ts the `scheduling alap` a new
 * `depends` would override.
 */
import { compareParseOrder, type ParsePosition } from '../../workspace/include-order';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type {
	AllocationSite,
	AttrSite,
	DependencySite,
	SymbolIndex,
	TaskId,
	TaskSymbol,
} from '../index';
import { hasCycle, hasLoop, type LoopNode } from './dep-loops';
import { depOnEnd, itemNode, orphanDeps, type OrphanDep } from './dep-orphans';

/** A dependency the edit would add, read at `at` (the statement it lands in, or its insertion). */
export interface ExtraDep {
	readonly owner: TaskId;
	readonly form: 'depends' | 'precedes';
	readonly target: TaskId;
	readonly onEnd: boolean;
	readonly at: ParsePosition;
}

export interface Dep {
	readonly target: TaskId;
	readonly onEnd: boolean;
}

type Event = { readonly at: ParsePosition; readonly scenario: string | null } & (
	| { readonly kind: 'forward'; readonly value: boolean }
	| { readonly kind: 'dep'; readonly form: 'depends' | 'precedes'; readonly dep: Dep }
	| { readonly kind: 'alloc'; readonly ids: readonly (string | null)[] }
	| { readonly kind: 'start' | 'end' | 'milestone' | 'sizing' | 'booking' }
);

/** What TaskJuggler knows of a task in one scenario after reading its attributes. */
export interface TaskState {
	forward: boolean;
	depends: Dep[];
	precedes: Dep[];
	/** Allocated resource ids, own and inherited (null for an unresolved item). */
	allocs: (string | null)[];
	start: boolean;
	end: boolean;
	milestone: boolean;
	sizing: boolean;
	booking: boolean;
}

type Node = LoopNode;

export { depOnEnd, itemNode };

const key = (r: { file: string; from: number }): string => `${r.file}\0${r.from}`;

function groupBy<T>(list: readonly T[], k: (x: T) => string): Map<string, T[]> {
	const out = new Map<string, T[]>();
	for (const x of list) {
		const list2 = out.get(k(x));
		if (list2) list2.push(x);
		else out.set(k(x), [x]);
	}
	return out;
}

const fresh = (): TaskState => ({
	forward: true,
	depends: [],
	precedes: [],
	allocs: [],
	start: false,
	end: false,
	milestone: false,
	sizing: false,
	booking: false,
});

class Graph {
	readonly #ancestors = new Map<string, Set<string>>();
	readonly #deps: Map<string, DependencySite[]>;
	readonly #allocs: Map<string, AllocationSite[]>;
	readonly #orphans: readonly OrphanDep[];
	readonly #events = new Map<TaskId, Event[]>();
	readonly #states = new Map<string, TaskState>();

	constructor(
		readonly ws: WorkspaceSnapshot,
		readonly index: SymbolIndex,
		readonly extra: readonly ExtraDep[],
	) {
		for (const sc of index.scenarios) {
			const up = new Set<string>();
			for (let p: string | null = sc.id; p !== null && !up.has(p);) {
				up.add(p);
				const id: string = p;
				p = index.scenarios.find((x) => x.id === id)?.parent ?? null;
			}
			this.#ancestors.set(sc.id, up);
		}
		this.#deps = groupBy(index.dependencies, (d) => key(d.statement));
		this.#allocs = groupBy(index.allocations, (a) => key(a.statement));
		this.#orphans = orphanDeps(ws, index);
	}

	cmp(a: ParsePosition, b: ParsePosition): number {
		return compareParseOrder(this.ws.includes, a, b, 'first');
	}

	applies(attr: string | null, scenario: string): boolean {
		return attr === null || (this.#ancestors.get(scenario)?.has(attr) ?? attr === scenario);
	}

	#attrEvents(sym: TaskSymbol, a: AttrSite): Event[] {
		const at = { file: a.statement.file, from: a.statement.from };
		const base = { at, scenario: a.scenario };
		const fwd = (value: boolean): Event => ({ ...base, kind: 'forward', value });
		switch (a.keyword) {
			case 'start':
				return [{ ...base, kind: 'start' }, fwd(true)];
			case 'end':
				return [{ ...base, kind: 'end' }, fwd(false)];
			case 'period':
				return [
					{ ...base, kind: 'start' },
					{ ...base, kind: 'end' },
				];
			case 'scheduling': {
				const v = a.parsed?.kind === 'scheduling' ? a.parsed.value : null;
				return v === null ? [] : [fwd(v === 'asap')];
			}
			case 'milestone':
				return [{ ...base, kind: 'milestone' }];
			case 'effort':
			case 'length':
			case 'duration':
				return [{ ...base, kind: 'sizing' }];
			case 'booking':
				return [{ ...base, kind: 'booking' }];
			case 'allocate': {
				const seen = new Set<string>();
				const ids: (string | null)[] = [];
				for (const x of this.#allocs.get(key(a.statement)) ?? []) {
					if (x.task !== sym.id || seen.has(key(x.item))) continue;
					seen.add(key(x.item));
					ids.push(x.resource);
				}
				return [{ ...base, kind: 'alloc', ids }];
			}
			case 'depends':
			case 'precedes': {
				const form = a.keyword;
				const out: Event[] = [];
				const seen = new Set<string>();
				for (const d of this.#deps.get(key(a.statement)) ?? []) {
					if ((form === 'depends' ? d.succ : d.pred) !== sym.id) continue;
					const target = form === 'depends' ? d.pred : d.succ;
					if (target === null || seen.has(key(d.item))) continue;
					seen.add(key(d.item));
					out.push({ ...base, kind: 'dep', form, dep: { target, onEnd: depOnEnd(this.ws, d) } });
				}
				out.push(fwd(form === 'depends'));
				return out;
			}
			default:
				return [];
		}
	}

	events(sym: TaskSymbol): Event[] {
		const known = this.#events.get(sym.id);
		if (known) return known;
		const ev = sym.attrs.flatMap((a) => this.#attrEvents(sym, a));
		for (const x of this.extra) {
			if (x.owner !== sym.id) continue;
			const add: Event[] = [
				{ at: x.at, scenario: null, kind: 'dep', form: x.form, dep: x },
				{ at: x.at, scenario: null, kind: 'forward', value: x.form === 'depends' },
			];
			let i = ev.length;
			while (i > 0 && this.cmp(ev[i - 1]?.at ?? x.at, x.at) > 0) i--;
			ev.splice(i, 0, ...add);
		}
		this.#events.set(sym.id, ev);
		return ev;
	}

	/** The task's state in `scenario` from its events read before `upTo` (all when null). */
	state(id: TaskId, scenario: string, upTo: ParsePosition | null = null): TaskState {
		const memo = upTo === null ? `${id}\0${scenario}` : null;
		const known = memo === null ? undefined : this.#states.get(memo);
		if (known) return known;
		const sym = this.index.tasks.get(id);
		const st = fresh();
		if (sym?.parent) {
			const at = { file: sym.decl.block.file, from: sym.decl.block.from };
			const p = this.state(sym.parent, scenario, at);
			st.forward = p.forward;
			st.depends = [...p.depends];
			st.precedes = [...p.precedes];
			st.allocs = [...p.allocs];
		}
		for (const e of sym ? this.events(sym) : []) {
			if (upTo !== null && this.cmp(e.at, upTo) >= 0) break;
			if (!this.applies(e.scenario, scenario)) continue;
			if (e.kind === 'forward') st.forward = e.value;
			else if (e.kind === 'dep') (e.form === 'depends' ? st.depends : st.precedes).push(e.dep);
			else if (e.kind === 'alloc') st.allocs.push(...e.ids);
			else st[e.kind] = true;
		}
		if (memo !== null) this.#states.set(memo, st);
		return st;
	}

	/** The task's own attributes that set its direction in `scenario`, in reading order. */
	directionSites(id: TaskId, scenario: string): Array<{ site: AttrSite; forward: boolean }> {
		const sym = this.index.tasks.get(id);
		const out: Array<{ site: AttrSite; forward: boolean }> = [];
		for (const a of sym?.attrs ?? []) {
			if (!sym || !this.applies(a.scenario, scenario)) continue;
			for (const e of this.#attrEvents(sym, a)) {
				if (e.kind === 'forward') out.push({ site: a, forward: e.value });
			}
		}
		return out;
	}

	/** The loop-check nodes of one scenario, with the unnamed owners of orphan items (dep-orphans.ts). */
	nodes(scenario: string): Map<TaskId, Node> {
		const out = new Map<TaskId, Node>();
		const lists = new Map<TaskId, { depends: Dep[]; precedes: Dep[] }>();
		for (const [id, sym] of this.index.tasks) {
			const st = this.state(id, scenario);
			out.set(id, {
				id,
				parent: sym.parent,
				children: sym.children,
				forward: st.forward,
				milestone: isMilestone(st, sym.children.length > 0),
				startpreds: [],
				endsuccs: [],
			});
			lists.set(id, st);
		}
		for (const o of this.#orphans) {
			if (!this.applies(o.scenario, scenario)) continue;
			const id = `\0${o.owner}`;
			if (!out.has(id)) {
				out.set(id, {
					id,
					parent: o.within,
					children: [],
					forward: true,
					milestone: false,
					startpreds: [],
					endsuccs: [],
				});
				lists.set(id, { depends: [], precedes: [] });
			}
			const l = lists.get(id);
			(o.form === 'depends' ? l?.depends : l?.precedes)?.push(o);
		}
		for (const [id, self] of out) {
			const st = lists.get(id) ?? { depends: [], precedes: [] };
			for (const d of st.depends) {
				const t = out.get(d.target);
				if (!t) continue;
				self.startpreds.push([d.target, d.onEnd]);
				if (d.onEnd) t.endsuccs.push([id, false]);
			}
			for (const d of st.precedes) {
				const t = out.get(d.target);
				if (!t) continue;
				self.endsuccs.push([d.target, d.onEnd]);
				if (!d.onEnd) t.startpreds.push([id, true]);
			}
		}
		return out;
	}
}

/** `milestone`, or `markAsMilestone`'s promotion of a plain leaf. */
export function isMilestone(st: TaskState, container: boolean): boolean {
	if (st.milestone) return true;
	if (container || st.sizing || st.booking || st.allocs.length > 0) return false;
	const hasStart = st.start || st.depends.length > 0;
	const hasEnd = st.end || st.precedes.length > 0;
	return (
		(hasStart && st.forward && !hasEnd) ||
		(!hasStart && !st.forward && hasEnd) ||
		(!hasStart && !hasEnd)
	);
}

/**
 * What depends on a task or one of its ancestors, as `isUnderspecified` reads it (all scenarios,
 * also items of declarations the index cannot name): `end` when a `depends` item names one of them
 * (a successor waits for the end), `start` when a `precedes` item that targets a start names one
 * of them (a predecessor fixes the start).
 */
export interface Dependents {
	readonly end: boolean;
	readonly start: boolean;
}

/** The dependents of `task` and its ancestors in `index` (module comment of `Dependents`). */
export function dependentsOf(ws: WorkspaceSnapshot, index: SymbolIndex, task: TaskId): Dependents {
	const chain = new Set<TaskId>();
	for (let x: TaskId | null = task; x !== null; x = index.tasks.get(x)?.parent ?? null)
		chain.add(x);
	let end = false;
	let start = false;
	for (const d of index.dependencies) {
		if (d.form === 'depends' && d.pred !== null && chain.has(d.pred)) end = true;
		if (d.form === 'precedes' && d.succ !== null && chain.has(d.succ) && !depOnEnd(ws, d)) {
			start = true;
		}
		if (end && start) return { end, start };
	}
	// Items of declarations the index cannot name (`task "Item 2" { depends !!wp2 }`).
	for (const o of orphanDeps(ws, index)) {
		if (!chain.has(o.target)) continue;
		if (o.form === 'depends') end = true;
		else if (!o.onEnd) start = true;
	}
	return { end, start };
}

/**
 * `task_underspecified` (TaskScenario.rb:345) and "has not been marked as scheduled" for a leaf
 * with no sizing criterion or `milestone` and an allocation (own or inherited) or a booking, which
 * keeps it from being promoted to a milestone (`markAsMilestone`, :2288). `start` and `end` are
 * not inherited (Project.rb:273, :327); dependencies are. Checked in native tj3 3.8.4:
 *
 * - with a start (own `start` or a `depends`) and an end (own `end` or a `precedes`) it schedules;
 * - with neither it fails;
 * - with only a start it runs from there to the project end, and fails when a `depends` names it
 *   or an ancestor (`dependents.end`); a `precedes` on it, also `{ onend }`, does not matter;
 * - with only an end it runs from the project start, and fails when a `precedes` that targets a
 *   start names it or an ancestor (`dependents.start`); a `depends` on it, also `{ onstart }`,
 *   does not matter.
 */
export function isUnderspecified(st: TaskState, dependents: Dependents): boolean {
	if (st.sizing || st.milestone) return false;
	if (st.allocs.length === 0 && !st.booking) return false;
	const hasStart = st.start || st.depends.length > 0;
	const hasEnd = st.end || st.precedes.length > 0;
	if (hasStart && hasEnd) return false;
	if (!hasStart && !hasEnd) return true;
	return hasStart ? dependents.end : dependents.start;
}

/** The scenarios the loop check runs in: every declared one (TaskJuggler's default: 'plan'). */
function scenarios(index: SymbolIndex): string[] {
	return index.scenarios.length > 0 ? index.scenarios.map((s) => s.id) : ['plan'];
}

/**
 * Per scenario, whether the declared graph has a loop TaskJuggler's check finds (`loop`) and a
 * cycle of time points (`cycle`), as `newLoop` tests them; for comparing two snapshots (a task
 * moved to another parent, task-semantics.ts).
 */
export function graphLoops(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
): Map<string, { loop: boolean; cycle: boolean }> {
	const g = new Graph(ws, index, []);
	const out = new Map<string, { loop: boolean; cycle: boolean }>();
	for (const sc of scenarios(index)) {
		const n = g.nodes(sc);
		out.set(sc, { loop: hasLoop(n), cycle: hasCycle(n) });
	}
	return out;
}

/** The first scenario where `extra` makes a loop the declared graph does not have, or null. */
export function newLoop(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	extra: readonly ExtraDep[],
): string | null {
	const before = new Graph(ws, index, []);
	const after = new Graph(ws, index, extra);
	for (const sc of scenarios(index)) {
		const a = after.nodes(sc);
		const b = before.nodes(sc);
		if ((hasLoop(a) && !hasLoop(b)) || (hasCycle(a) && !hasCycle(b))) return sc;
	}
	return null;
}

/**
 * The task's own `scheduling alap` that a `depends` read at `at` would override in some
 * scenario, or null: the task's own direction-setting attributes after its last ASAP one
 * (`start`, `depends`, `scheduling asap`) are all ALAP ones (`end`, `precedes`,
 * `scheduling alap`) read before `at`, and one of them is a `scheduling alap` (the last is
 * returned). An ALAP only inherited, or only set by `end` or `precedes`, gives null.
 */
export function ownAlapBefore(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	at: ParsePosition,
): AttrSite | null {
	const g = new Graph(ws, index, []);
	for (const sc of scenarios(index)) {
		const writers = g.directionSites(task, sc).reverse();
		const last = writers[0]?.site.statement;
		if (!last || writers[0]?.forward || g.cmp({ file: last.file, from: last.from }, at) >= 0)
			continue;
		// After the last ASAP setting every one is ALAP, so a `scheduling` among them is `alap`.
		const asap = writers.findIndex((w) => w.forward);
		const run = asap < 0 ? writers : writers.slice(0, asap);
		const alap = run.find((w) => w.site.parsed?.kind === 'scheduling');
		if (alap) return alap.site;
	}
	return null;
}

/** The scenario unprefixed attributes are read in: the first declared one, else 'plan'. */
export function topScenario(index: SymbolIndex): string {
	return index.scenarios[0]?.id ?? 'plan';
}

/**
 * A task's state in `scenario` (module comment), and what it inherited from its parent when it
 * was declared (null for a top-level task).
 */
export function taskState(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	task: TaskId,
	scenario: string = topScenario(index),
): { inherited: TaskState | null; state: TaskState } {
	return stateReader(ws, index, scenario)(task);
}

/** `taskState` for many tasks of one snapshot, sharing the work; `extra` as an edit would add. */
export function stateReader(
	ws: WorkspaceSnapshot,
	index: SymbolIndex,
	scenario: string = topScenario(index),
	extra: readonly ExtraDep[] = [],
): (task: TaskId) => { inherited: TaskState | null; state: TaskState } {
	const g = new Graph(ws, index, extra);
	return (task) => {
		const sym = index.tasks.get(task);
		const at = sym ? { file: sym.decl.block.file, from: sym.decl.block.from } : null;
		const inherited = sym?.parent && at ? g.state(sym.parent, scenario, at) : null;
		return { inherited, state: g.state(task, scenario) };
	};
}
