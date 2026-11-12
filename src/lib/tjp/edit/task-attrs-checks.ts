// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the task attribute intents (task-attrs.ts) read about a task: the task itself, its own
 * sites in the top scenario, and the `conflicting-attribute` checks for the combinations TaskJuggler rejects
 * (TaskScenario.rb prepareScenario and markAsMilestone, ProjectFileParser.rb
 * setDurationAttribute):
 *
 * - `isContainer`: a container may have no sizing criterion and may not be a milestone
 *   (`container_duration`, `container_milestone`); children the index cannot name (auto ids)
 *   count.
 * - `fixedBounds`: a milestone's start and end must be identical (`milestone_start_end`).
 * - `bookingsOf`: only forward scheduled tasks may have bookings (`booking_forward_only`); the
 *   bookings may sit in the task's bodies or in resource bodies naming it.
 * - `overspecifiedBy`: a task with a sizing criterion may not also have a start and an end, an end
 *   with start dependencies when scheduled forward, or a start with end dependencies when
 *   scheduled backward (`task_overspecified`). The check compares the task before and after the
 *   change and refuses only a change that makes it overspecified. Dependencies are read from the
 *   index (`depends` inherited from ancestors, `precedes` items naming the task, successors), as
 *   TaskJuggler wires them both ways; `scheduling` is inherited.
 */
import type { TjpFile } from '../document';
import { lastSite, type AttrSite, type SourceRange, type TaskSymbol } from '../index';
import { sameValue, type TypedValue } from '../values';
import { refused, type EditContext, type Refused } from './types';

export const SIZING: ReadonlySet<string> = new Set(['effort', 'length', 'duration']);

export const ranges = (sites: readonly AttrSite[]): SourceRange[] => sites.map((s) => s.statement);

export function fileOf(ctx: EditContext, at: SourceRange): TjpFile | Refused {
	return ctx.ws.files.get(at.file) ?? refused('unknown-target', [at]);
}

/** The task an intent names; `text-only` for one declared only through macro expansion. */
export function taskOf(ctx: EditContext, id: string): TaskSymbol | Refused {
	const sym = ctx.index.tasks.get(id);
	if (!sym) return refused('unknown-target');
	if (sym.expandedOnly)
		return refused('text-only', [sym.decl.block], { textOnly: 'expanded-only' });
	return sym;
}

const topOf = (ctx: EditContext): string | null => ctx.index.scenarios[0]?.id ?? null;

/** The task's own sites of these keywords in the top scenario, in reading order. */
export function ownSites(
	ctx: EditContext,
	sym: TaskSymbol,
	keywords: ReadonlySet<string> | string,
): AttrSite[] {
	const top = topOf(ctx);
	const has = (k: string): boolean =>
		typeof keywords === 'string' ? k === keywords : keywords.has(k);
	return sym.attrs.filter((a) => has(a.keyword) && (a.scenario === null || a.scenario === top));
}

/** The last own site of `keyword` in the top scenario (`lastSite`). */
export function lastOwn(ctx: EditContext, sym: TaskSymbol, keyword: string): AttrSite | null {
	return lastSite(sym.attrs, keyword, null, topOf(ctx));
}

const inside = (r: SourceRange, o: SourceRange): boolean =>
	r.file === o.file && o.from <= r.from && r.to <= o.to;

/** Whether the task has children, also ones the index cannot name (auto ids, macro ids). */
export function isContainer(ctx: EditContext, sym: TaskSymbol): boolean {
	if (sym.children.length > 0) return true;
	const blocks = [sym.decl.block, ...sym.supplements.map((s) => s.block)];
	return ctx.index.unresolved.some(
		(u) =>
			u.kind === 'task' && (u.parent === sym.id || blocks.some((b) => inside(u.decl.block, b))),
	);
}

/** `booking` statements of the task, in its bodies and in resource bodies naming it. */
export function bookingsOf(ctx: EditContext, sym: TaskSymbol): SourceRange[] {
	const out = ranges(sym.attrs.filter((a) => a.keyword === 'booking'));
	for (const res of ctx.index.resources.values()) {
		for (const a of res.attrs) {
			if (a.keyword !== 'booking' || !a.value) continue;
			const text = ctx.ws.files.get(a.value.file)?.text.sliceString(a.value.from, a.value.to);
			if (text?.trim().split(/[\s,]/)[0] === sym.id) out.push(a.statement);
		}
	}
	return out;
}

/**
 * The own `start` and `end` sites when both are set and differ, with `next` replacing one of
 * them; null when a milestone may have them.
 */
export function fixedBounds(
	ctx: EditContext,
	sym: TaskSymbol,
	next?: { readonly keyword: string; readonly value: TypedValue },
): SourceRange[] | null {
	const keys = ['start', 'end'];
	const sites = keys.map((k) => lastOwn(ctx, sym, k));
	const values = sites.map((s, i) =>
		next && next.keyword === keys[i] ? next.value : (s?.parsed ?? null),
	);
	const [a, b] = values;
	if (!a || !b || sameValue(a, b)) return null;
	return sites.flatMap((s) => (s ? [s.statement] : []));
}

function ancestors(ctx: EditContext, sym: TaskSymbol): string[] {
	const out: string[] = [];
	for (let p = sym.parent; p !== null; p = ctx.index.tasks.get(p)?.parent ?? null) out.push(p);
	return out;
}

/** Whether the task is scheduled forward: its own or an ancestor's `scheduling` (default asap). */
function forward(ctx: EditContext, sym: TaskSymbol): boolean {
	for (
		let t: TaskSymbol | undefined = sym;
		t;
		t = t.parent ? ctx.index.tasks.get(t.parent) : undefined
	) {
		const s = lastOwn(ctx, t, 'scheduling');
		if (s?.parsed?.kind === 'scheduling') return s.parsed.value === 'asap';
	}
	return true;
}

/** A change to one attribute: its new value, or null when it goes. */
export interface TimingChange {
	readonly attr: string;
	readonly value: TypedValue | null;
}

/** The sites that make the task overspecified after `change` but not before, or null. */
export function overspecifiedBy(
	ctx: EditContext,
	sym: TaskSymbol,
	change: TimingChange,
): SourceRange[] | null {
	const top = topOf(ctx);
	const up = new Set(ancestors(ctx, sym));
	const deps = ctx.index.dependencies.filter((d) => d.scenario === null || d.scenario === top);
	const startDeps = deps.some(
		(d) => d.succ === sym.id || (d.form === 'depends' && d.succ !== null && up.has(d.succ)),
	);
	const endDeps = deps.some(
		(d) => d.pred === sym.id || (d.form === 'precedes' && d.pred !== null && up.has(d.pred)),
	);
	const state = (after: boolean) => {
		const has = (keys: ReadonlySet<string> | string): boolean => {
			const own = ownSites(ctx, sym, keys).length > 0;
			if (!after) return own;
			const hit = typeof keys === 'string' ? keys === change.attr : keys.has(change.attr);
			return hit ? change.value !== null : own;
		};
		const fwd =
			after && change.attr === 'scheduling'
				? !(change.value?.kind === 'scheduling' && change.value.value === 'alap')
				: forward(ctx, sym);
		const start = has('start');
		const end = has('end');
		return (
			has(SIZING) && ((start && end) || (startDeps && fwd && end) || (endDeps && !fwd && start))
		);
	};
	if (state(false) || !state(true)) return null;
	return ranges(ownSites(ctx, sym, new Set(['start', 'end', 'scheduling', ...SIZING])));
}
