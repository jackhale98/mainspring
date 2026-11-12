// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Project intents (phase-1.md 7.1 `setProjectHeader`, `setProjectAttr`, `removeProjectAttr`).
 *
 * - `setProjectHeader` rewrites the name string (as `renameResource`: same quote style,
 *   `unsafe-text`) and the interval's start and end tokens. A date keeps its written spelling
 *   when it already means the new date. The end keeps the header's style: written `- date`, it
 *   takes the new date (or the given `+duration`); written `+duration`, a new end date becomes the
 *   duration from the start in whole days, hours or minutes. A start alone leaves the end text as
 *   it is (a duration end then moves with the start, as TaskJuggler reads it). `invalid-value`
 *   when the end is not after the start (TaskJuggler's start_before_end; the header is read in UTC
 *   before any setting), or when the new frame leaves a date outside it (revalidate.ts).
 * - `setProjectAttr` rewrites the value of the last site of the project body (and files included
 *   there), keeping the written spelling (noop `already-set`), else inserts `attr value` in the
 *   header body by the 7.2 project order (a body is created when there is none). Values are
 *   TaskJuggler text (`'"Europe/Berlin"'`, `'2026-03-02-09:00'`, `'7.5'`, `'"%Y-%m-%d"'`).
 *   `weekstartsmonday` takes a boolean: `true` writes `weekstartsmonday`, `false`
 *   `weekstartssunday`, rewriting the last of the two (noop when it already says so, or for
 *   `true` with neither: TaskJuggler's default is Monday). `weekstartssunday` is an opaque
 *   statement in the grammar, which edits never touch: `true` after it inserts
 *   `weekstartsmonday` after it, and removing it is `text-only`.
 * - Checks: `timezone` must be 'UTC' or a zone the time-zone data knows (bad_time_zone; without
 *   zone data in the index only a name without '/' is refused); `dailyworkinghours` must be above
 *   zero (TaskJuggler divides by it: 0 is a fatal error, checked natively); and every change of
 *   `timezone`, `now` or `dailyworkinghours` is re-checked over the whole workspace
 *   (revalidate.ts): a date that the new zone makes misaligned with the timing resolution, a
 *   `timingresolution` after the `timezone` statement above the new zone's cap
 *   (too_large_timing_res: 15 min for Asia/Kathmandu), or a duration the new daily hours make
 *   misaligned are `invalid-value`. A `timingresolution` read before the `timezone` statement is
 *   not capped (TaskJuggler checks it where it stands; checked natively), so it is not refused.
 * - A new `timezone` goes before the first ranked statement of the body (7.2 order), so before
 *   the `now` and `workinghours` statements: TaskJuggler reads later dates in the zone and resets
 *   the project working hours at a `timezone` statement (Project#[]=).
 * - `removeProjectAttr` removes every site (for `weekstartsmonday` both keywords), noop
 *   `not-present` without one, and is re-checked as above.
 * - A statement-level macro call in the project body whose expansion may hold the keyword is
 *   `macro-in-body`.
 */
import type { SyntaxNode } from '@lezer/common';
import type { AttrSite, ProjectSymbol, SourceRange } from '../index';
import { statementsIn } from '../tree';
import {
	checkValue,
	printDuration,
	parseDate,
	parseDuration,
	parseInterval,
	parseString,
	parseValue,
	printStringPreferring,
	printValue,
	resolveInterval,
	KEYWORD_VALUE_KIND,
	type Interval,
	type TypedValue,
} from '../values';
import type { IntentHandler } from './apply';
import { insertStatement, replaceSpan, replaceValue, statementNode } from './layout';
import { checkBodyMacros } from './lists';
import { fileOf, insertAttr, macroWritten, removeSites } from './props';
import { checkSafeText, checkTextOnly } from './refuse';
import { checkValuesAfter } from './revalidate';
import {
	isNoop,
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type Noop,
	type ProjectAttr,
	type Refused,
} from './types';

const KEYWORDS: Readonly<Record<ProjectAttr, readonly string[]>> = {
	timezone: ['timezone'],
	now: ['now'],
	timeformat: ['timeformat'],
	currency: ['currency'],
	dailyworkinghours: ['dailyworkinghours'],
	weekstartsmonday: ['weekstartsmonday', 'weekstartssunday'],
};
/** Settings that change how later values read: their changes are re-checked. */
const RECHECK: ReadonlySet<ProjectAttr> = new Set(['timezone', 'now', 'dailyworkinghours']);

export function projectOf(ctx: EditContext): ProjectSymbol | Refused {
	const p = ctx.index.project;
	if (!p) return refused('unknown-target');
	if (p.textOnly) return refused('text-only', [p.textOnly.at], { textOnly: p.textOnly.reason });
	return p;
}

/** Statement-level macro calls in the header body (by the tree). */
function bodyCalls(ctx: EditContext, p: ProjectSymbol): SourceRange[] {
	const file = ctx.ws.files.get(p.decl.block.file);
	const node = file && statementNode(file, p.decl.block);
	const body = node?.getChild('Body');
	if (!body) return [];
	return statementsIn(body)
		.filter((s: SyntaxNode) => s.name === 'MacroCallStatement')
		.map((s) => ({ file: p.decl.block.file, from: s.from, to: s.to }));
}

/** `macro-in-body` for calls in the project body that may hold one of `keywords`. */
export function projectMacros(
	ctx: EditContext,
	p: ProjectSymbol,
	keywords: readonly string[],
): Refused | null {
	return checkBodyMacros(ctx.ws, ctx.index, { bodyMacroCalls: bodyCalls(ctx, p) }, keywords);
}

const sites = (p: ProjectSymbol, attr: ProjectAttr): AttrSite[] =>
	p.attrs.filter((a) => KEYWORDS[attr].includes(a.keyword) && a.scenario === null);

/** The intent value as the keyword's typed value, checked where no context is needed. */
function typed(
	ctx: EditContext,
	attr: Exclude<ProjectAttr, 'weekstartsmonday'>,
	value: unknown,
	at: SourceRange,
): TypedValue | Refused {
	const kind = KEYWORD_VALUE_KIND[attr];
	if (!kind || typeof value !== 'string') return refused('invalid-value', [at]);
	const p = parseValue(kind, value);
	if (!p.ok) return refused('invalid-value', [at]);
	const v = p.value;
	if (attr === 'dailyworkinghours' && v.kind === 'number' && !(v.value.value > 0))
		return refused('invalid-value', [at]);
	if (attr === 'timezone') {
		const c = checkValue('timezone', v, ctx.index.contextAt(at.file, at.from));
		if (!c.ok && c.error.code !== 'zone-data') return refused('invalid-value', [at]);
	}
	return v;
}

function planWeekStart(ctx: EditContext, p: ProjectSymbol, value: unknown): IntentPlan {
	if (typeof value !== 'boolean') return refused('invalid-value', [p.decl.header]);
	const own = sites(p, 'weekstartsmonday');
	const last = own[own.length - 1];
	const now = last ? last.keyword === 'weekstartsmonday' : true;
	if (now === value) return noop('already-set');
	const kw = value ? 'weekstartsmonday' : 'weekstartssunday';
	if (!last) return insertAttr(ctx, p.decl.block, 'project', 'weekstartsmonday', kw, []);
	const file = fileOf(ctx, last.statement);
	if (isRefused(file)) return file;
	// `weekstartssunday` is an opaque statement, which edits never touch: a later statement wins.
	if (last.textOnly?.reason === 'opaque') {
		const block = within(last.statement, p.decl.block) ? p.decl.block : null;
		return insertStatement(file, block, kw, { after: last.statement });
	}
	const written = macroWritten([last]);
	if (written) return written;
	return [replaceSpan(file, last.statement, kw)];
}

const within = (r: SourceRange, o: SourceRange): boolean =>
	r.file === o.file && o.from <= r.from && r.to <= o.to;

function rechecked(ctx: EditContext, attr: ProjectAttr, plan: IntentPlan): IntentPlan {
	if (isRefused(plan) || isNoop(plan) || !RECHECK.has(attr)) return plan;
	return checkValuesAfter(ctx, plan) ?? plan;
}

export function planSetProjectAttr(
	ctx: EditContext,
	intent: IntentOf<'setProjectAttr'>,
): IntentPlan {
	const p = projectOf(ctx);
	if (isRefused(p)) return p;
	const { attr, value } = intent;
	const hidden = projectMacros(ctx, p, KEYWORDS[attr]);
	if (hidden) return hidden;
	if (attr === 'weekstartsmonday') return planWeekStart(ctx, p, value);
	const own = sites(p, attr);
	const last = own[own.length - 1];
	const v = typed(ctx, attr, value, last?.value ?? p.decl.header);
	if (isRefused(v)) return v;
	if (!last) {
		const text = printValue(v);
		if (!text.ok) return refused('invalid-value', [p.decl.header]);
		const ops = insertAttr(ctx, p.decl.block, 'project', attr, `${attr} ${text.value}`, []);
		return rechecked(ctx, attr, ops);
	}
	const written = macroWritten([last]);
	if (written) return written;
	if (!last.value) return refused('unsupported-form', [last.statement]);
	const file = fileOf(ctx, last.value);
	if (isRefused(file)) return file;
	const op = replaceValue(file, last.value, v);
	return rechecked(ctx, attr, 'status' in op ? op : [op]);
}

export function planRemoveProjectAttr(
	ctx: EditContext,
	intent: IntentOf<'removeProjectAttr'>,
): IntentPlan {
	const p = projectOf(ctx);
	if (isRefused(p)) return p;
	const hidden = projectMacros(ctx, p, KEYWORDS[intent.attr]);
	if (hidden) return hidden;
	const own = sites(p, intent.attr);
	if (own.length === 0) return noop('not-present');
	const written = macroWritten(own);
	if (written) return written;
	return rechecked(ctx, intent.attr, removeSites(ctx, own));
}

/** `+Nd`, `+Nh` or `+Nmin` for a span of seconds, or null when it is not whole minutes. */
function durationText(seconds: number): string | null {
	if (seconds <= 0 || seconds % 60 !== 0) return null;
	if (seconds % 86400 === 0) return `+${seconds / 86400}d`;
	if (seconds % 3600 === 0) return `+${seconds / 3600}h`;
	return `+${seconds / 60}min`;
}

export function planSetProjectHeader(
	ctx: EditContext,
	intent: IntentOf<'setProjectHeader'>,
): IntentPlan {
	const p = projectOf(ctx);
	if (isRefused(p)) return p;
	const file = fileOf(ctx, p.decl.block);
	if (isRefused(file)) return file;
	const ops: EditOp[] = [];
	if (intent.name !== undefined) {
		const name = p.decl.name;
		if (!name) return refused('unsupported-form', [p.decl.header]);
		const unsafe = checkSafeText(intent.name, [name]);
		if (unsafe) return unsafe;
		const written = parseString(file.text.sliceString(name.from, name.to));
		if (!written.ok)
			return checkTextOnly(ctx, name.file, name) ?? refused('unsupported-form', [name]);
		if (written.value !== intent.name) {
			const style = written.style === 'cut' ? 'double' : written.style;
			const printed = printStringPreferring(intent.name, style);
			if (!printed.ok || printed.value.startsWith('-8<-')) return refused('unsafe-text', [name]);
			ops.push(replaceSpan(file, name, printed.value));
		}
	}
	if (intent.start !== undefined || intent.end !== undefined) {
		const r = planInterval(ctx, p, intent.start, intent.end);
		if (isRefused(r)) return r;
		ops.push(...r);
	}
	if (ops.length === 0) return noop('already-set');
	return intent.start !== undefined || intent.end !== undefined
		? (checkValuesAfter(ctx, ops) ?? ops)
		: ops;
}

function planInterval(
	ctx: EditContext,
	p: ProjectSymbol,
	start: string | undefined,
	end: string | undefined,
): EditOp[] | Refused {
	const iv = p.interval;
	if (!iv) return refused('unsupported-form', [p.decl.header]);
	const file = fileOf(ctx, iv);
	if (isRefused(file)) return file;
	const cur = parseInterval(file.text.sliceString(iv.from, iv.to), iv.from);
	if (!cur.ok) return checkTextOnly(ctx, iv.file, iv) ?? refused('unsupported-form', [iv]);
	const { spans } = cur;
	const env = ctx.index.contextAt(iv.file, p.decl.block.from);
	const at = [iv];
	const ops: EditOp[] = [];
	const push = (op: EditOp | Noop | Refused): Refused | null => {
		if (isRefused(op)) return op;
		if (!isNoop(op)) ops.push(op);
		return null;
	};
	let next: Interval = cur.value;
	if (start !== undefined) {
		const d = parseDate(start);
		if (!d.ok) return refused('invalid-value', at);
		next = { ...next, start: d.value };
		const r = push(replaceValue(file, spans.start, { kind: 'date', value: d.value }));
		if (r) return r;
	}
	const endSpan = spans.end;
	if (end !== undefined && (!endSpan || !next.end)) return refused('unsupported-form', at);
	if (end !== undefined && endSpan && next.end) {
		const t = end.trim();
		const written = file.text.sliceString(endSpan.from, endSpan.to);
		if (t.startsWith('+')) {
			const d = parseDuration(t.slice(1));
			const text = d.ok ? printDuration(d.value) : null;
			if (!d.ok || !text?.ok) return refused('invalid-value', at);
			next = { ...next, end: { kind: 'duration', duration: d.value } };
			const same = next.end && cur.value.end?.kind === 'duration' && written === `+${text.value}`;
			if (!same) ops.push(replaceSpan(file, endSpan, `+${text.value}`));
		} else {
			const e = parseDate(t);
			if (!e.ok) return refused('invalid-value', at);
			if (next.end.kind === 'date') {
				next = { ...next, end: { kind: 'date', date: e.value } };
				const lead = /^-\s*/.exec(written)?.[0].length ?? 0;
				const span = { from: endSpan.from + lead, to: endSpan.to };
				const r = push(replaceValue(file, span, { kind: 'date', value: e.value }));
				if (r) return r;
			} else {
				const a = resolveInterval({ start: next.start, end: { kind: 'date', date: e.value } }, env);
				const dur = a.ok ? durationText(a.value[1] - a.value[0]) : null;
				const d = dur === null ? null : parseDuration(dur.slice(1));
				if (!d?.ok || dur === null) return refused('invalid-value', at);
				next = { ...next, end: { kind: 'duration', duration: d.value } };
				if (written !== dur) ops.push(replaceSpan(file, endSpan, dur));
			}
		}
	}
	return resolveInterval(next, env).ok ? ops : refused('invalid-value', at);
}

export const PROJECT_HANDLERS: {
	readonly setProjectHeader: IntentHandler<'setProjectHeader'>;
	readonly setProjectAttr: IntentHandler<'setProjectAttr'>;
	readonly removeProjectAttr: IntentHandler<'removeProjectAttr'>;
} = {
	setProjectHeader: { plan: planSetProjectHeader, sameInEveryVisit: true },
	setProjectAttr: { plan: planSetProjectAttr, sameInEveryVisit: true },
	removeProjectAttr: { plan: planRemoveProjectAttr, sameInEveryVisit: true },
};
