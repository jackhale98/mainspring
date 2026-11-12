// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Value checks for the task attribute intents (phase-1.md 7.1, T11a), in task-attrs.ts:
 *
 * - `parseAttrValue`: the intent's value text (TaskJuggler syntax, as 6.5 says: `'5d'`,
 *   `'2026-03-02-09:00'`, `'alap'`, `'"A note"'`) parsed as the keyword's value kind; text that
 *   does not parse, holds a macro call or an environment reference, or is not a string is
 *   `invalid-value`. Inserted text is always the canonical print of the parsed value.
 * - `checkAttrValue`: TaskJuggler's context checks (`checkValue`: project frame, alignment,
 *   `complete` 0 to 100, `priority` 1 to 1000, zero durations) with the project context in force
 *   where the value goes (`SymbolIndex.contextAt`). A check that reads a setting the index knows
 *   only as a placeholder (`IndexContext.unknown`, written with a macro) is skipped, as the value
 *   diagnostics do; so are errors that only say the value cannot be checked here (no time-zone
 *   data).
 * - `checkIdList`: `flags` ids must be declared (`undeclared-flag`) and `responsible` ids must be
 *   resources (`invalid-value`), both read before the statement in reading order (TaskJuggler
 *   looks them up while it parses: rule_flags, rule_resourceList).
 */
import { compareParseOrder } from '../../workspace/include-order';
import type { ContextSetting, SourceRange } from '../index';
import {
	KEYWORD_VALUE_KIND,
	checkValue,
	isId,
	parseValue,
	type TypedValue,
	type ValueErrorCode,
	type ValueKind,
} from '../values';
import { refused, type AttrValue, type EditContext, type Refused } from './types';

/** The context settings each value kind's check reads (as diagnostics-values.ts). */
const READS: Readonly<Partial<Record<ValueKind, readonly ContextSetting[]>>> = {
	duration: ['granularity', 'dailyWorkingHours', 'yearlyWorkingDays', 'weeklyWorkingHours'],
	date: ['zone', 'granularity', 'frame'],
};

/** Check errors that mean "cannot tell here", not "wrong". */
const UNCHECKABLE: ReadonlySet<ValueErrorCode> = new Set(['zone-data']);

/** The intent's value text parsed as `keyword`'s value; `invalid-value` at `at` otherwise. */
export function parseAttrValue(
	keyword: string,
	value: AttrValue,
	at: readonly SourceRange[],
): TypedValue | Refused {
	const kind = KEYWORD_VALUE_KIND[keyword];
	if (!kind || typeof value !== 'string') return refused('invalid-value', at);
	const p = parseValue(kind, value);
	return p.ok ? p.value : refused('invalid-value', at);
}

/** TaskJuggler's checks of `v` as `keyword`'s value at `pos` (module comment). */
export function checkAttrValue(
	ctx: EditContext,
	keyword: string,
	v: TypedValue,
	pos: SourceRange,
	at: readonly SourceRange[],
): Refused | null {
	const c = ctx.index.contextAt(pos.file, pos.from);
	if ((READS[v.kind] ?? []).some((f) => c.unknown.has(f))) return null;
	const r = checkValue(keyword, v, c);
	if (r.ok || UNCHECKABLE.has(r.error.code)) return null;
	return refused('invalid-value', at);
}

/** Whether `a` is read before `b` (first include visits). */
export function readBefore(ctx: EditContext, a: SourceRange, b: SourceRange): boolean {
	return compareParseOrder(ctx.ws.includes, a, b, 'first') < 0;
}

/**
 * The ids of a `flags` or `responsible` value, deduplicated in order, checked as the module
 * comment says for a statement at `pos`.
 */
export function checkIdList(
	ctx: EditContext,
	keyword: 'flags' | 'responsible',
	value: AttrValue,
	pos: SourceRange,
	at: readonly SourceRange[],
): string[] | Refused {
	if (typeof value === 'boolean') return refused('invalid-value', at);
	const list: readonly string[] = typeof value === 'string' ? [value] : value;
	const ids = [...new Set(list)];
	if (ids.length === 0 || !ids.every(isId)) return refused('invalid-value', at);
	for (const id of ids) {
		if (keyword === 'flags') {
			const decl = ctx.index.flags.get(id);
			if (!decl || !readBefore(ctx, decl, pos)) return refused('undeclared-flag', at);
		} else {
			const res = ctx.index.resources.get(id);
			if (!res || !readBefore(ctx, res.decl.header, pos)) return refused('invalid-value', at);
		}
	}
	return ids;
}
