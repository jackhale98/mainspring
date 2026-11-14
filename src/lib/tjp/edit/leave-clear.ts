// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * `clearLeave` (phase-3.md 6.5, 7.1 W4; ADR-0014 #7): removes `[start, end)` from every leave
 * item of a scope that overlaps it, in one edit.
 *
 * - The scope's items: for the global scope (the project scope means the same, as for `addLeave`)
 *   every file-level `leaves` item and `vacation` interval; for a resource its own `leaves` items
 *   and `vacation` intervals in the declaration and supplement bodies, unprefixed or in the top
 *   scenario (calendar-leaves.ts `scopeLeaves`).
 * - Each item's interval and the range are resolved as TaskJuggler reads them at the item (zone,
 *   resolution; values/interval.ts `resolveInterval`), so `+2d`, the one-day form and explicit
 *   offsets compare as instants. An item inside the range goes (with one comma, or its statement
 *   when it was the only item; remove.ts); an item over one edge is trimmed; an item that spans
 *   the range is split in two. The new bounds are written as the 18.5 form, `<start> - <end>`
 *   with the end exclusive: the range's own dates (canonical), and the item's end as written when
 *   it was a date, else the instant it resolved to (values/date.ts `dateFromEpoch`). A trim
 *   rewrites only the bound it moves (`- 2026-03-05`); the second part of a split is a new item
 *   after the first, `annual "Trip" 2026-03-09 - 2026-03-13`, keeping the type and name.
 * - Refusals: `invalid-value` for a range that does not parse, is not aligned with the timing
 *   resolution where an item is read, or does not end after it starts, and for a new part
 *   TaskJuggler would reject (calendar-leaves.ts `checkLeave`); `text-only` when an item of the
 *   scope is written with a macro, `macro-in-body` when a statement-level macro of the resource's
 *   bodies may write `leaves` or `vacation` (both: the range could overlap leave the edit cannot
 *   see); `unsupported-form` for a `vacation` interval the range would split (a vacation is one
 *   holiday list; its intervals are not leave items of their own, 6.5).
 * - Noop `not-present` when no item of the scope overlaps the range. For a resource, a range that
 *   overlaps only leaves the resource inherits (a parent resource's own leaves, or global leaves,
 *   which are on every resource's scoreboard) is refused `inherited` at those items instead.
 *
 * It removes and inserts list items, so like `removeLeave` it is refused in shared files.
 */
import type { LeaveSite, SourceRange } from '../index';
import {
	dateFromEpoch,
	parseDate,
	parseInterval,
	parseLeaves,
	printDate,
	printLeave,
	resolveDate,
	resolveInterval,
	type DateExpr,
	type Interval,
	type IntervalSpans,
	type Leave,
	type LeaveType,
} from '../values';
import type { IntentHandler } from './apply';
import { checkLeave } from './calendar-leaves';
import { checkBodyMacros } from './lists';
import { fileOf, macroWritten, resourceOf, topOf } from './props';
import { removeListItems, removeStatement } from './remove';
import {
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type Refused,
} from './types';

type ClearScope = IntentOf<'clearLeave'>['scope'];

/** One leave item of a scope, read: its interval as written and as resolved. */
interface Item {
	readonly site: LeaveSite;
	readonly index: number;
	readonly range: SourceRange;
	/** The type and name a new part keeps (`holiday` and none for a vacation interval). */
	readonly type: LeaveType;
	readonly name: string | null;
	readonly interval: Interval;
	readonly spans: IntervalSpans;
	/** Where the interval ends in the file (the item's end). */
	readonly end: number;
	readonly from: number;
	readonly to: number;
}

const LEAVE_KEYWORDS = ['leaves', 'vacation'];

/** The own leave sites of a scope (module comment), or a refusal. */
function scopeSites(ctx: EditContext, scope: ClearScope): LeaveSite[] | Refused {
	if (scope.kind !== 'resource') return ctx.index.leaves.filter((l) => l.scope.kind === 'global');
	const sym = resourceOf(ctx, scope.resource);
	if (isRefused(sym)) return sym;
	const hidden = checkBodyMacros(ctx.ws, ctx.index, sym, LEAVE_KEYWORDS);
	if (hidden) return hidden;
	return resourceSites(ctx, sym.id);
}

function resourceSites(ctx: EditContext, id: string): LeaveSite[] {
	const top = topOf(ctx.index);
	return ctx.index.leaves.filter(
		(l) =>
			l.scope.kind === 'resource' &&
			l.scope.resource === id &&
			(l.attr.scenario === null || l.attr.scenario === top),
	);
}

/** Every item of `sites`, read and resolved; `unsupported-form` for one that cannot be. */
function readItems(ctx: EditContext, sites: readonly LeaveSite[]): Item[] | Refused {
	const out: Item[] = [];
	for (const site of sites) {
		const file = fileOf(ctx, site.attr.statement);
		if (isRefused(file)) return file;
		for (const [index, range] of site.items.entries()) {
			const text = file.text.sliceString(range.from, range.to);
			const at = [range];
			let read: Pick<Item, 'type' | 'name' | 'interval' | 'spans'> | null = null;
			if (site.keyword === 'leaves') {
				const p = parseLeaves(text, range.from);
				const leave = p.ok && p.value.length === 1 ? p.value[0] : undefined;
				const spans = p.ok ? p.items[0]?.interval : undefined;
				if (leave && spans) read = { ...leave, spans };
			} else {
				const p = parseInterval(text, range.from, { optionalEnd: true });
				if (p.ok) read = { type: 'holiday', name: null, interval: p.value, spans: p.spans };
			}
			// T8: an item the edit cannot read or resolve (a missing zone's data, a misaligned
			// date the engine rejects anyway) might overlap the range, so the intent stops there.
			if (!read) return refused('unsupported-form', at);
			const c = ctx.index.contextAt(range.file, range.from);
			if (c.unknown.has('zone') || c.unknown.has('granularity')) {
				return refused('unsupported-form', at);
			}
			const r = resolveInterval(read.interval, c);
			if (!r.ok) return refused('unsupported-form', at);
			out.push({ site, index, range, ...read, end: range.to, from: r.value[0], to: r.value[1] });
		}
	}
	return out;
}

/** The range as instants where `item` is read, or `invalid-value`. */
function rangeAt(
	ctx: EditContext,
	item: Item,
	start: DateExpr,
	end: DateExpr,
): readonly [number, number] | Refused {
	const c = ctx.index.contextAt(item.range.file, item.range.from);
	const s = resolveDate(start, c);
	const e = resolveDate(end, c);
	if (!s.ok || !e.ok || !(s.value < e.value)) return refused('invalid-value', [item.range]);
	return [s.value, e.value];
}

const dateText = (e: DateExpr, at: SourceRange): string | Refused => {
	const t = printDate(e);
	return t.ok ? t.value : refused('invalid-value', [at]);
};

/** The date an instant is written as where `item` is read (the 18.5 exclusive end). */
function instantText(ctx: EditContext, item: Item, epoch: number): DateExpr | Refused {
	const c = ctx.index.contextAt(item.range.file, item.range.from);
	const d = dateFromEpoch(epoch, c);
	return d ? { kind: 'date', date: d } : refused('unsupported-form', [item.range]);
}

/** One op on `item`, the element its range. */
const opOn = (item: Item, from: number, to: number, insert: string): EditOp => ({
	file: item.range.file,
	from,
	to,
	insert,
	element: { from: item.range.from, to: item.range.to },
});

/** The end bound of `item` set to `text` (` - date` after the start when it had none). */
function endOp(item: Item, text: string, more = ''): EditOp {
	const e = item.spans.end;
	return e
		? opOn(item, e.from, item.end, `- ${text}${more}`)
		: opOn(item, item.spans.start.to, item.spans.start.to, ` - ${text}${more}`);
}

interface Parts {
	readonly ops: EditOp[];
	/** The leaves the edit writes, with where each is read, for TaskJuggler's checks. */
	readonly written: Array<{ leave: Leave; at: SourceRange }>;
}

/** The ops that take `[cs, ce)` (written `start`, `end`) out of `item`, which it overlaps. */
function clearItem(
	ctx: EditContext,
	item: Item,
	range: { start: DateExpr; end: DateExpr; cs: number; ce: number },
	parts: Parts,
): Refused | 'remove' | null {
	const { cs, ce } = range;
	const keepHead = item.from < cs;
	const keepTail = ce < item.to;
	if (!keepHead && !keepTail) return 'remove';
	const at = item.range;
	const leave = (interval: Interval): Leave => ({ type: item.type, name: item.name, interval });
	// The tail starts at the range's end and keeps the item's end: as written when it is a date
	// (`+2d` and the one-day form count from the start, which moves).
	let tail: Interval | null = null;
	if (keepTail) {
		const end = item.interval.end?.kind === 'date' ? item.interval.end.date : null;
		const last = end ?? instantText(ctx, item, item.to);
		if (isRefused(last)) return last;
		tail = { start: range.end, end: { kind: 'date', date: last } };
		parts.written.push({ leave: leave(tail), at });
	}
	if (keepHead) {
		const head: Interval = { start: item.interval.start, end: { kind: 'date', date: range.start } };
		parts.written.push({ leave: leave(head), at });
		const cut = dateText(range.start, at);
		if (isRefused(cut)) return cut;
		if (!tail) {
			parts.ops.push(endOp(item, cut));
			return null;
		}
		if (item.site.keyword === 'vacation') return refused('unsupported-form', [at]);
		const second = printLeave(leave(tail));
		if (!second.ok) return refused('invalid-value', [at]);
		parts.ops.push(endOp(item, cut, `, ${second.value}`));
		return null;
	}
	if (!tail) return null;
	const start = dateText(range.end, at);
	if (isRefused(start)) return start;
	const s = item.spans.start;
	if (item.interval.end?.kind === 'date') {
		parts.ops.push(opOn(item, s.from, s.to, start));
		return null;
	}
	const endText = tail.end?.kind === 'date' ? dateText(tail.end.date, at) : null;
	if (endText === null || isRefused(endText)) return endText ?? refused('invalid-value', [at]);
	parts.ops.push(opOn(item, s.from, item.end, `${start} - ${endText}`));
	return null;
}

/** For a resource with no own item in the range: the inherited items in it (module comment). */
function inheritedIn(
	ctx: EditContext,
	scope: ClearScope,
	start: DateExpr,
	end: DateExpr,
): SourceRange[] {
	if (scope.kind !== 'resource') return [];
	const sites = ctx.index.leaves.filter((l) => l.scope.kind === 'global');
	for (
		let p = ctx.index.resources.get(scope.resource)?.parent ?? null;
		p !== null;
		p = ctx.index.resources.get(p)?.parent ?? null
	) {
		sites.push(...resourceSites(ctx, p));
	}
	const items = readItems(
		ctx,
		sites.filter((s) => s.attr.textOnly === null),
	);
	if (isRefused(items)) return [];
	return items
		.filter((it) => {
			const r = rangeAt(ctx, it, start, end);
			return !isRefused(r) && it.to > r[0] && it.from < r[1];
		})
		.map((it) => it.range);
}

export function planClearLeave(ctx: EditContext, intent: IntentOf<'clearLeave'>): IntentPlan {
	const sites = scopeSites(ctx, intent.scope);
	if (isRefused(sites)) return sites;
	const at = sites.map((s) => s.attr.statement);
	const start = parseDate(intent.start.trim());
	const end = parseDate(intent.end.trim());
	if (!start.ok || !end.ok) return refused('invalid-value', at.slice(-1));
	// T8: a statement written with a macro may hold leave in the range that the edit cannot
	// remove, so any such statement in the scope refuses, wherever its leave falls.
	const written = macroWritten(sites.map((s) => s.attr));
	if (written) return written;
	const items = readItems(ctx, sites);
	if (isRefused(items)) return items;
	const parts: Parts = { ops: [], written: [] };
	const gone = new Map<LeaveSite, number[]>();
	let hits = 0;
	for (const item of items) {
		const r = rangeAt(ctx, item, start.value, end.value);
		if (isRefused(r)) return r;
		const [cs, ce] = r;
		if (!(item.to > cs && item.from < ce)) continue;
		hits++;
		const range = { start: start.value, end: end.value, cs, ce };
		const res = clearItem(ctx, item, range, parts);
		if (isRefused(res)) return res;
		if (res === 'remove') gone.set(item.site, [...(gone.get(item.site) ?? []), item.index]);
	}
	if (hits === 0) {
		const inherited = inheritedIn(ctx, intent.scope, start.value, end.value);
		return inherited.length > 0 ? refused('inherited', inherited) : noop('not-present');
	}
	for (const { leave, at: pos } of parts.written) {
		const bad = checkLeave(ctx, leave, pos, [pos]);
		if (bad) return bad;
	}
	const ops = [...parts.ops];
	for (const [site, indices] of gone) {
		const file = fileOf(ctx, site.attr.statement);
		if (isRefused(file)) return file;
		const removed = removeListItems(file, site.items, indices);
		ops.push(...(removed ?? [removeStatement(file, site.attr.statement)]));
	}
	return ops;
}

export const LEAVE_CLEAR_HANDLERS: { readonly clearLeave: IntentHandler<'clearLeave'> } = {
	clearLeave: { plan: planClearLeave },
};
