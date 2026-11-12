// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Working hours (phase-1.md 7.1 `setWorkingHours`); the leave intents are in calendar-leaves.ts.
 * Scopes: the project (its header body and files included there) or a resource (its declaration
 * and supplement bodies, top scenario: TaskJuggler's resource `workinghours` is scenario
 * specific, the project's is not).
 *
 * - The value is written canonically by the values printer (`workinghours mon - fri 9:00 -
 *   12:00, 13:00 - 18:00`, `sat, sun off`); `invalid-value` for no day, a time TaskJuggler
 *   rejects or an interval that does not end after it starts (time_interval, bad_workinghours).
 * - Later statements override earlier ones day by day (rule_workinghours sets each listed day).
 *   The last own statement whose day set equals `days` is rewritten, but only when no later own
 *   statement sets one of those days (it would override the rewrite); a statement whose value
 *   the index could not read counts as setting every day. Otherwise a new statement is appended
 *   after the scope's last own `workinghours` statement, or, with none, inserted by the 7.2
 *   order (before another scenario's `workinghours` of the same body, props.ts). Noop
 *   `already-set` when the rewritten statement already says so.
 * - In the project scope, a `timezone` or `timingresolution` statement resets the working hours
 *   (Project#[]=), so statements before the last such statement no longer count: they are not
 *   rewritten, and a new statement goes after the last of them (or after the reset statement).
 * - A resource with no own working hours starts from the project's (`WorkingHours.new(project
 *   working hours)`), so a statement for some days keeps the project's other days.
 * - The project's working hours are the default of every later resource and give the weekly
 *   working hours durations convert with, so a project change is re-checked (revalidate.ts).
 * - A statement-level macro call in the scope's bodies whose expansion may hold `workinghours`
 *   is `macro-in-body`; a statement written with a macro is `text-only`.
 */
import type { AttrSite, SourceRange } from '../index';
import { printWorkingHours, workingHoursFrom, type Weekday, type WorkingHours } from '../values';
import type { IntentHandler } from './apply';
import { insertStatement, replaceValue } from './layout';
import { checkBodyMacros } from './lists';
import { projectMacros, projectOf } from './project';
import {
	fileOf,
	insertAttr,
	macroWritten,
	otherScenarioSites,
	ownSites,
	readBefore,
	resourceOf,
} from './props';
import { checkValuesAfter } from './revalidate';
import {
	isNoop,
	isRefused,
	refused,
	type EditContext,
	type IntentOf,
	type IntentPlan,
	type Refused,
	type Scope,
} from './types';

/** A scope's own sites of a keyword, the blocks it writes into, and other scenarios' sites. */
export interface ScopeSites {
	readonly sites: readonly AttrSite[];
	readonly others: readonly AttrSite[];
	/** The declaration block (the project header) new statements go into. */
	readonly block: SourceRange;
	/** All blocks of the scope: the declaration and its supplements. */
	readonly blocks: readonly SourceRange[];
	readonly order: 'project' | 'resource';
	/** Project statements that reset the working hours (`timezone`, `timingresolution`). */
	readonly resets: readonly AttrSite[];
}

/** Project#[]= rebuilds the project working hours when one of these is set (Project.rb:520). */
const RESETS: ReadonlySet<string> = new Set(['timezone', 'timingresolution']);

/** The scope's own sites of `keyword` (module comment), or a refusal. */
export function scopeSites(ctx: EditContext, scope: Scope, keyword: string): ScopeSites | Refused {
	if (scope.kind === 'project') {
		const p = projectOf(ctx);
		if (isRefused(p)) return p;
		const hidden = projectMacros(ctx, p, [keyword]);
		if (hidden) return hidden;
		const sites = p.attrs.filter((a) => a.keyword === keyword && a.scenario === null);
		const resets = p.attrs.filter((a) => RESETS.has(a.keyword));
		const block = p.decl.block;
		return { sites, others: [], block, blocks: [block], order: 'project', resets };
	}
	const sym = resourceOf(ctx, scope.resource);
	if (isRefused(sym)) return sym;
	const hidden = checkBodyMacros(ctx.ws, ctx.index, sym, [keyword]);
	if (hidden) return hidden;
	return {
		sites: ownSites(ctx.index, sym.attrs, keyword),
		others: otherScenarioSites(ctx.index, sym.attrs, keyword),
		block: sym.decl.block,
		blocks: [sym.decl.block, ...sym.supplements.map((s) => s.block)],
		order: 'resource',
		resets: [],
	};
}

const within = (r: SourceRange, o: SourceRange): boolean =>
	r.file === o.file && o.from <= r.from && r.to <= o.to;

/** The block whose body holds `site` (null: the top level of an included file). */
export function blockOf(s: ScopeSites, site: AttrSite): SourceRange | null {
	return s.blocks.find((b) => within(site.statement, b)) ?? null;
}

const daysOf = (site: AttrSite): readonly Weekday[] | null =>
	site.parsed?.kind === 'workinghours' ? site.parsed.value.days : null;

const sameDays = (a: readonly Weekday[], b: readonly Weekday[]): boolean =>
	a.length === b.length && a.every((d) => b.includes(d));

export function planSetWorkingHours(
	ctx: EditContext,
	intent: IntentOf<'setWorkingHours'>,
): IntentPlan {
	const s = scopeSites(ctx, intent.scope, 'workinghours');
	if (isRefused(s)) return s;
	const at = [s.sites[s.sites.length - 1]?.statement ?? s.block];
	const wh = workingHoursFrom(intent.days, intent.hours);
	if (!wh.ok) return refused('invalid-value', at);
	const text = printWorkingHours(wh.value);
	if (!text.ok) return refused('invalid-value', at);
	const written = macroWritten(s.sites);
	if (written) return written;
	const plan = placeWorkingHours(ctx, s, wh.value, `workinghours ${text.value}`);
	if (intent.scope.kind !== 'project' || isRefused(plan) || isNoop(plan)) return plan;
	return checkValuesAfter(ctx, plan) ?? plan;
}

function placeWorkingHours(
	ctx: EditContext,
	s: ScopeSites,
	wh: WorkingHours,
	stmt: string,
): IntentPlan {
	const reset = s.resets[s.resets.length - 1];
	const sites = reset
		? s.sites.filter((x) => readBefore(ctx, reset.statement, x.statement))
		: s.sites;
	for (let i = sites.length - 1; i >= 0; i--) {
		const site = sites[i] as AttrSite;
		const days = daysOf(site);
		if (days === null) break;
		if (sameDays(days, wh.days)) {
			if (!site.value) return refused('unsupported-form', [site.statement]);
			const file = fileOf(ctx, site.value);
			if (isRefused(file)) return file;
			const op = replaceValue(file, site.value, { kind: 'workinghours', value: wh });
			return 'status' in op ? op : [op];
		}
		if (days.some((d) => wh.days.includes(d))) break;
	}
	const last = sites[sites.length - 1] ?? reset;
	const select = { from: 'workinghours '.length, to: stmt.length };
	if (!last) return insertAttr(ctx, s.block, s.order, 'workinghours', stmt, s.others);
	const file = fileOf(ctx, last.statement);
	if (isRefused(file)) return file;
	return insertStatement(file, blockOf(s, last), stmt, { after: last.statement }, { select });
}

export const WORKING_HOURS_HANDLERS: {
	readonly setWorkingHours: IntentHandler<'setWorkingHours'>;
} = {
	setWorkingHours: { plan: planSetWorkingHours },
};
