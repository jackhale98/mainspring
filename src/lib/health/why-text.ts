// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * "Why here?" in words (phase-3.md 9.7; T18): a task's `Placement` from the explainer as sentences,
 * each with what it links to (the task, the person's heatmap cell, or the text). Display data
 * (ADR-0007): nothing here schedules or edits.
 *
 * - **It says what the explainer says, and no more.** `unknown` is "The schedule does not show
 *   why." and carries no claim; a `limit` "may" hold the task (limits are not engine data until
 *   Phase 5); the bound's items are listed whether or not the task sits on the bound. A `frame`
 *   cause says only that the project's own start (or end) is the limit: it never says the task
 *   "starts at the project start" (explain-types.ts, for T18).
 * - **Dates** are display dates in the plan's zone (`displayDate`, "Tue 3 Mar"); a window is
 *   "Wed 4 Mar to Fri 13 Mar", or one date when it is inside one day. A window's end is an
 *   instant, so its last day is the day of the minute before it.
 * - **Names** come from the text first, then the result (`taskName`, `personName`).
 */
import type { Minutes, ProjectInfo, TaskScenarioResult } from '../../engine/protocol';
import { displayDate } from '../schedule/date-text';
import { scenarioChainOf, writtenDates } from '../schedule/explain-text';
import type { Cause, CauseKind, ExplainContext, Placement } from '../schedule/explain-types';
import { whyStrings as W } from '../strings-health-panel';
import type { ResourceId, SourceRange, TaskId } from '../tjp/index';
import { personName, taskName, type TextContext } from './text';

export type WhyLink =
	| { readonly kind: 'task'; readonly task: TaskId; readonly label: string }
	/** The person's heatmap cell at `at`. */
	| {
			readonly kind: 'person';
			readonly resource: ResourceId;
			readonly at: Minutes;
			readonly label: string;
	  }
	| { readonly kind: 'text'; readonly at: SourceRange; readonly label: string };

export interface WhyLine {
	readonly kind: CauseKind;
	readonly text: string;
	readonly links: readonly WhyLink[];
}

export interface WhyText {
	/** The anchor the causes are about: the start of an ASAP task, the end of an ALAP one. */
	readonly anchor: 'start' | 'end';
	/** In time order: what gives the bound, then what held the task after it. */
	readonly causes: readonly WhyLine[];
	/** Gaps inside the bar (effort tasks). */
	readonly inside: readonly WhyLine[];
}

/** At most this many tasks are named in a "booked on" sentence; the rest are counted. */
const NAMED = 3;

function dayOf(m: Minutes, p: ProjectInfo, locale: string | undefined, end = false): string {
	return displayDate(m, p, { style: 'weekday', locale, end });
}

/** "Wed 4 Mar to Fri 13 Mar", or "Wed 4 Mar" when the window is inside one day. */
export function windowText(
	w: readonly [Minutes, Minutes],
	p: ProjectInfo,
	locale?: string,
): string {
	const a = dayOf(w[0], p, locale);
	const b = dayOf(Math.max(w[0] + 1, w[1]), p, locale, true);
	return a === b ? a : `${a} to ${b}`;
}

function hoursText(min: number): string {
	const h = Math.round((min / 60) * 10) / 10;
	return `${h} h`;
}

/** "Build API", "Build API and Test", "Build API, Test and 2 other tasks". */
function namesText(names: readonly string[], more: number): string {
	const all = more > 0 ? [...names, `${more} other task${more === 1 ? '' : 's'}`] : [...names];
	if (all.length <= 1) return all[0] ?? '';
	return `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
}

export function whyText(p: Placement, ctx: ExplainContext, locale?: string): WhyText {
	const project = ctx.result.project;
	const c: TextContext = { index: ctx.index, result: ctx.result, ...(locale ? { locale } : {}) };
	const scenario = ctx.result.tasks.find((t) => t.id === p.task)?.scenarios[ctx.scenario] ?? null;
	const startEpoch = project ? Math.round(Date.parse(project.start) / 1000) : 0;
	const chain = scenarioChainOf(project, ctx.scenario);

	const line = (kind: CauseKind, text: string, links: readonly WhyLink[] = []): WhyLine => ({
		kind,
		text,
		links,
	});
	const taskLink = (id: TaskId): WhyLink => {
		const name = taskName(c, id);
		return { kind: 'task', task: id, label: W.link.task(name) };
	};
	const personLink = (id: ResourceId, at: Minutes): WhyLink => ({
		kind: 'person',
		resource: id,
		at,
		label: W.link.person(personName(c, id)),
	});

	function dependency(cause: Extract<Cause, { kind: 'dependency' }>): WhyLine {
		const entries: readonly { task: TaskId; onEnd: boolean }[] =
			(cause.via === 'depends' ? scenario?.depends : scenario?.precedes) ?? [];
		const entry = entries.find((d) => d.task === cause.pred);
		const other: TaskScenarioResult | null =
			ctx.result.tasks.find((t) => t.id === cause.pred)?.scenarios[ctx.scenario] ?? null;
		const edge = entry?.onEnd === false ? 'start' : 'end';
		// The day of a finish is the last day worked (the Schedule block's rule): a milestone, which
		// starts and ends at one instant, shows that instant's day, not the day before it.
		const at =
			edge === 'end' && other?.end !== null && other?.end !== undefined
				? Math.max(other.start ?? other.end, other.end - 1)
				: other?.start;
		const date = project && at !== null && at !== undefined ? dayOf(at, project, locale) : null;
		const name = taskName(c, cause.pred);
		const text =
			cause.via === 'depends'
				? W.cause.dependency(name, edge, date, cause.gap)
				: W.cause.dependencyAlap(name, edge, date, cause.gap);
		return line('dependency', text, [taskLink(cause.pred)]);
	}

	function constraint(cause: Extract<Cause, { kind: 'constraint' }>): WhyLine {
		const w = writtenDates(ctx.index, p.task, cause.attr, chain, startEpoch).find(
			(x) => x.inherited === cause.inherited,
		);
		const date =
			project && w?.at !== null && w?.at !== undefined
				? displayDate(w.at, project, { locale, end: cause.attr === 'end' })
				: null;
		const where = w && cause.inherited ? taskName(c, w.task) : null;
		const links: WhyLink[] = w ? [{ kind: 'text', at: w.site, label: W.link.text }] : [];
		return line('constraint', W.cause.constraint(cause.attr, date, where), links);
	}

	/** Who a `limits` statement is written on: this task, another task, a person, or nobody we can name. */
	function limitOwner(site: SourceRange): string | null {
		const inside = (b: SourceRange): boolean =>
			b.file === site.file && b.from <= site.from && site.to <= b.to;
		for (const [id, r] of ctx.index.resources) if (inside(r.decl.block)) return personName(c, id);
		for (const [id, t] of ctx.index.tasks) {
			if (inside(t.decl.block)) return id === p.task ? W.cause.thisTask : taskName(c, id);
		}
		return null;
	}

	function cause(x: Cause): WhyLine {
		if (!project) return line('unknown', W.cause.unknown);
		switch (x.kind) {
			case 'dependency':
				return dependency(x);
			case 'frame':
				return line('frame', p.anchor === 'end' ? W.cause.frameEnd : W.cause.frame);
			case 'constraint':
				return constraint(x);
			case 'busy': {
				const named = x.on.slice(0, NAMED);
				const names = namesText(
					named.map((o) => taskName(c, o.task)),
					x.on.length - named.length,
				);
				const minutes = x.on.reduce((n, o) => n + o.minutes, 0);
				return line(
					'busy',
					W.cause.busy(
						personName(c, x.resource),
						names === '' ? W.cause.elsewhere : names,
						windowText(x.window, project, locale),
						minutes > 0 ? hoursText(minutes) : '',
					),
					[personLink(x.resource, x.window[0]), ...named.map((o) => taskLink(o.task))],
				);
			}
			case 'leave':
				return line(
					'leave',
					W.cause.leave(
						x.resource === null ? null : personName(c, x.resource),
						W.leaveType[x.type],
						windowText(x.window, project, locale),
					),
					x.resource === null ? [] : [personLink(x.resource, x.window[0])],
				);
			case 'off-hours':
				return line(
					'off-hours',
					W.cause.offHours(
						x.resource === null ? null : personName(c, x.resource),
						windowText(x.window, project, locale),
					),
					x.resource === null ? [] : [personLink(x.resource, x.window[0])],
				);
			case 'limit':
				return line('limit', W.cause.limit(limitOwner(x.site)), [
					{ kind: 'text', at: x.site, label: W.link.text },
				]);
			case 'unknown':
				return line('unknown', W.cause.unknown);
		}
	}

	return {
		anchor: p.anchor,
		causes: p.causes.map(cause),
		inside: p.inside.map(cause),
	};
}
