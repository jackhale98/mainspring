// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * TaskJuggler's scheduling direction and the timing checks of the task attribute intents
 * (task-attrs.ts), as the parser and TaskScenario.rb compute them:
 *
 * - Direction is positional. `start` and `depends` set the task ASAP, `end` and `precedes` set it
 *   ALAP, `scheduling` sets either; the statement read last wins (TjpSyntaxRules.rb 6349, 6447,
 *   6598, 6687, 6792). A child starts with the direction its parent has when the child is
 *   created, as it does with `depends`, `precedes` and `scheduled` (all inherited). Only
 *   top-scenario statements count: a value written for the top scenario is copied to the others.
 * - Dependencies (TaskScenario#Xref): the task's own and inherited `depends` and the `precedes`
 *   of other tasks naming it (unless `{ onend }`) are start dependencies, as are other tasks'
 *   `depends … { onstart }` on it; its own and inherited `precedes` and other tasks' `depends` on
 *   it (unless `{ onstart }`) are end dependencies, as are other tasks' `precedes … { onend }`.
 * - `task_overspecified` (TaskScenario.rb:378): a sizing criterion with a start and an end, an
 *   end with start dependencies when ASAP, or a start with end dependencies when ALAP, unless the
 *   task itself says `scheduled` (an inherited `scheduled` does not count).
 * - `milestone_start_end`: a milestone with only a start that is ALAP gets its end from its parent
 *   or its `precedes`; one with only an end that is ASAP and has no start dependency gets the
 *   project or parent start. Both differ from the written date (checked natively).
 * - `booking_forward_only`, `alap_booking`: an ALAP task may have bookings only when scheduled.
 *
 * `timingConflicts` compares the task before and after a change and returns the sites of the
 * first check that only the change breaks.
 */
import { compareParseOrder } from '../../workspace/include-order';
import type { AttrSite, DependencySite, SourceRange, TaskSymbol } from '../index';
import type { TypedValue } from '../values';
import {
	SIZING,
	ancestorSteps,
	bookingsOf,
	ownSites,
	ranges,
	topOf,
	type AncestorStep,
} from './task-attrs-checks';
import { readBefore } from './task-attrs-value';
import type { EditContext } from './types';

/** A change to one attribute of a task, placed where TaskJuggler reads it. */
export interface TimingChange {
	readonly attr: string;
	/** The new value (`true` for `milestone`), or null when the sites in `replaces` just go. */
	readonly value: TypedValue | true | null;
	/** Where the new or rewritten statement is read; null when nothing is written. */
	readonly at: SourceRange | null;
	/** Own sites the change removes or rewrites. */
	readonly replaces: readonly AttrSite[];
}

const DIRECTION: ReadonlySet<string> = new Set([
	'start',
	'end',
	'depends',
	'precedes',
	'scheduling',
]);
const TIMING: ReadonlySet<string> = new Set([...DIRECTION, ...SIZING, 'milestone', 'scheduled']);

interface Event {
	readonly keyword: string;
	readonly value: TypedValue | true | null;
	readonly at: SourceRange;
	readonly inserted: boolean;
}

/** The direction an event sets, or null when it sets none. */
function direction(e: Event): boolean | null {
	switch (e.keyword) {
		case 'start':
		case 'depends':
			return true;
		case 'end':
		case 'precedes':
			return false;
		case 'scheduling': {
			const v = e.value;
			return v !== null && v !== true && v.kind === 'scheduling' ? v.value === 'asap' : null;
		}
		default:
			return null;
	}
}

interface Inherited {
	readonly forward: boolean;
	readonly scheduled: boolean;
	readonly depends: boolean;
	readonly precedes: boolean;
}

/** What a task has from its parent when it is created (direction, deps, `scheduled`). */
function inherited(ctx: EditContext, steps: readonly AncestorStep[], i = 0): Inherited {
	const step = steps[i];
	if (!step) return { forward: true, scheduled: false, depends: false, precedes: false };
	const up = inherited(ctx, steps, i + 1);
	const sites = ownSites(ctx, step.task, TIMING).filter((s) =>
		readBefore(ctx, s.statement, step.before),
	);
	let forward = up.forward;
	for (const s of sites) {
		forward =
			direction({ keyword: s.keyword, value: s.parsed, at: s.statement, inserted: false }) ??
			forward;
	}
	const kw = (k: string): boolean => sites.some((s) => s.keyword === k);
	return {
		forward,
		scheduled: up.scheduled || kw('scheduled'),
		depends: up.depends || kw('depends'),
		precedes: up.precedes || kw('precedes'),
	};
}

/** The task's timing state, before a change or after it. */
interface State {
	readonly forward: boolean;
	readonly ownScheduled: boolean;
	readonly scheduled: boolean;
	readonly start: boolean;
	readonly end: boolean;
	readonly sizing: boolean;
	readonly milestone: boolean;
	readonly depends: boolean;
	readonly precedes: boolean;
}

function events(ctx: EditContext, sym: TaskSymbol, change: TimingChange | null): Event[] {
	const gone = new Set(change?.replaces ?? []);
	const out: Event[] = ownSites(ctx, sym, TIMING)
		.filter((s) => !gone.has(s))
		.map((s) => ({ keyword: s.keyword, value: s.parsed, at: s.statement, inserted: false }));
	if (!change || change.value === null || !change.at) return out;
	const added: Event = { keyword: change.attr, value: change.value, at: change.at, inserted: true };
	// An inserted statement goes before a site that starts where it is inserted.
	const i = out.findIndex((e) => compareParseOrder(ctx.ws.includes, added.at, e.at, 'first') <= 0);
	out.splice(i < 0 ? out.length : i, 0, added);
	return out;
}

function stateOf(ctx: EditContext, sym: TaskSymbol, change: TimingChange | null): State {
	const up = inherited(ctx, ancestorSteps(ctx, sym));
	const list = events(ctx, sym, change);
	let forward = up.forward;
	for (const e of list) forward = direction(e) ?? forward;
	const kw = (k: string | ReadonlySet<string>): boolean =>
		list.some((e) => (typeof k === 'string' ? e.keyword === k : k.has(e.keyword)));
	const ownScheduled = kw('scheduled');
	return {
		forward,
		ownScheduled,
		scheduled: up.scheduled || ownScheduled,
		start: kw('start'),
		end: kw('end'),
		sizing: kw(SIZING),
		milestone: kw('milestone'),
		depends: up.depends || kw('depends'),
		precedes: up.precedes || kw('precedes'),
	};
}

/** `{ onstart }` or `{ onend }` in a dependency item's body, else null. */
function target(ctx: EditContext, d: DependencySite): 'onstart' | 'onend' | null {
	if (!d.body) return null;
	const text = ctx.ws.files.get(d.body.file)?.text.sliceString(d.body.from, d.body.to) ?? '';
	if (/\bonstart\b/.test(text)) return 'onstart';
	return /\bonend\b/.test(text) ? 'onend' : null;
}

/** Dependencies other tasks' statements give the task: [start, end]. */
function foreignDeps(ctx: EditContext, sym: TaskSymbol): [boolean, boolean] {
	const top = topOf(ctx);
	let start = false;
	let end = false;
	for (const d of ctx.index.dependencies) {
		if (d.scenario !== null && d.scenario !== top) continue;
		if (d.form === 'precedes' && d.succ === sym.id) {
			if (target(ctx, d) === 'onend') end = true;
			else start = true;
		} else if (d.form === 'depends' && d.pred === sym.id) {
			if (target(ctx, d) === 'onstart') start = true;
			else end = true;
		}
	}
	return [start, end];
}

type Check = (s: State) => boolean;

/** The timing checks (module comment), each with the sites a refusal points at. */
function checks(
	ctx: EditContext,
	sym: TaskSymbol,
): ReadonlyArray<readonly [Check, () => SourceRange[]]> {
	const [fStart, fEnd] = foreignDeps(ctx, sym);
	const startDeps = (s: State): boolean => s.depends || fStart;
	const endDeps = (s: State): boolean => s.precedes || fEnd;
	const timingSites = (): SourceRange[] => ranges(ownSites(ctx, sym, TIMING));
	const bookings = bookingsOf(ctx, sym);
	const child = sym.parent !== null;
	return [
		[
			(s) =>
				!s.milestone &&
				s.sizing &&
				!s.ownScheduled &&
				((s.start && s.end) ||
					(startDeps(s) && s.forward && s.end) ||
					(endDeps(s) && !s.forward && s.start)),
			timingSites,
		],
		[
			(s) =>
				s.milestone &&
				((s.start && !s.end && !s.forward && (child || s.precedes)) ||
					(s.end && !s.start && s.forward && !startDeps(s))),
			timingSites,
		],
		[(s) => bookings.length > 0 && !s.forward && !s.scheduled, () => bookings],
	];
}

/** The sites of the first timing check the change breaks (module comment), or null. */
export function timingConflicts(
	ctx: EditContext,
	sym: TaskSymbol,
	change: TimingChange,
): SourceRange[] | null {
	const before = stateOf(ctx, sym, null);
	const after = stateOf(ctx, sym, change);
	for (const [bad, at] of checks(ctx, sym)) if (!bad(before) && bad(after)) return at();
	return null;
}
