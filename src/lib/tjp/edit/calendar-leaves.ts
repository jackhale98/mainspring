// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Leave intents (phase-1.md 7.1 `addLeave`, `updateLeave`, `removeLeave`). A `LeaveRef` is a
 * leave item's range as `LeaveSite.items` gives it: a `leaves` item, or one interval of a
 * `vacation` (TaskJuggler reads a vacation as `holiday` leaves and throws its name away).
 *
 * - `addLeave` appends `, <leave>` to the scope's last `leaves` list (global scope: the last
 *   file-level list; the project scope means the same, as TaskJuggler has no `leaves` in the
 *   header body), else inserts `leaves <leave>`: after the project header for the global scope,
 *   by the 7.2 resource order for a resource (before another scenario's `leaves` of that body,
 *   props.ts). Leaves accumulate (`+=`), so either place adds the same leave. Noop `already-set`
 *   when the scope already lists the same leave.
 * - The leave is written by the values printer (`annual "Trip" 2026-03-02 - 2026-03-06`,
 *   `holiday 2026-12-24 +2d`); `invalid-value` for a type, date or duration that does not parse,
 *   a name no string can hold, an end not after the start (start_before_end) or a date not aligned
 *   with the timing resolution where it is read (checked natively). Leaves outside the project
 *   frame are ignored by TaskJuggler, not refused.
 * - `updateLeave` rewrites one item, keeping the written text when it already means the new
 *   leave (noop `already-set`). A vacation interval can only become another `holiday` interval
 *   with the vacation's own name or none (`unsupported-form` otherwise).
 * - `removeLeave` removes one item with one adjacent comma, or the statement with its line when
 *   it is the only one (7.2 list rules).
 * - Items written with a macro, statements in a declaration the index cannot name, and
 *   statement-level macro calls in the resource's bodies that may write `leaves` or `vacation`
 *   are refused as elsewhere (`text-only`, `macro-in-body`).
 */
import type { LeaveSite, SourceRange } from '../index';
import {
	checkValue,
	leaveFromSpec,
	parseLeaves,
	parseVacation,
	printInterval,
	printLeave,
	sameInterval,
	sameLeave,
	type Leave,
	type TypedValue,
} from '../values';
import type { IntentHandler } from './apply';
import {
	appendListItem,
	insertStatement,
	removeListItems,
	removeStatement,
	replaceSpan,
} from './layout';
import { checkBodyMacros } from './lists';
import { fileOf, insertAttr, macroWritten, pointOf, resourceOf, topOf } from './props';
import {
	isRefused,
	noop,
	refused,
	type EditContext,
	type EditOp,
	type IntentOf,
	type IntentPlan,
	type LeaveSpec,
	type Refused,
} from './types';

const LEAVE_READS = ['zone', 'granularity', 'frame'] as const;

/** TaskJuggler's checks of a leave read at `pos`; skipped where the index cannot tell. */
function checkLeave(
	ctx: EditContext,
	leave: Leave,
	pos: SourceRange,
	at: readonly SourceRange[],
): Refused | null {
	const c = ctx.index.contextAt(pos.file, pos.from);
	if (LEAVE_READS.some((f) => c.unknown.has(f))) return null;
	const v: TypedValue = { kind: 'leaves', value: [leave] };
	const r = checkValue('leaves', v, c);
	return r.ok || r.error.code === 'zone-data' ? null : refused('invalid-value', at);
}

const sameRange = (a: SourceRange, b: SourceRange): boolean =>
	a.file === b.file && a.from === b.from && a.to === b.to;

function leaveOf(spec: LeaveSpec, at: readonly SourceRange[]): Leave | Refused {
	const l = leaveFromSpec(spec);
	return l.ok ? l.value : refused('invalid-value', at);
}

/** The own `leaves` sites of a scope, in reading order. */
function scopeLeaves(
	ctx: EditContext,
	scope: IntentOf<'addLeave'>['scope'],
): { sites: LeaveSite[]; resource: string | null } | Refused {
	if (scope.kind !== 'resource') {
		const sites = ctx.index.leaves.filter(
			(l) => l.scope.kind === 'global' && l.keyword === 'leaves',
		);
		return { sites, resource: null };
	}
	const sym = resourceOf(ctx, scope.resource);
	if (isRefused(sym)) return sym;
	const hidden = checkBodyMacros(ctx.ws, ctx.index, sym, ['leaves', 'vacation']);
	if (hidden) return hidden;
	const top = topOf(ctx.index);
	const sites = ctx.index.leaves.filter(
		(l) =>
			l.scope.kind === 'resource' &&
			l.scope.resource === sym.id &&
			l.keyword === 'leaves' &&
			(l.attr.scenario === null || l.attr.scenario === top),
	);
	return { sites, resource: sym.id };
}

export function planAddLeave(ctx: EditContext, intent: IntentOf<'addLeave'>): IntentPlan {
	const s = scopeLeaves(ctx, intent.scope);
	if (isRefused(s)) return s;
	const last = s.sites[s.sites.length - 1];
	const at = [
		last?.attr.statement ??
			ctx.index.project?.decl.header ?? { file: ctx.ws.entry, from: 0, to: 0 },
	];
	const leave = leaveOf(intent.leave, at);
	if (isRefused(leave)) return leave;
	const text = printLeave(leave);
	if (!text.ok) return refused('invalid-value', at);
	const listed = s.sites.some(
		(site) =>
			site.attr.parsed?.kind === 'leaves' &&
			site.attr.parsed.value.some((l) => sameLeave(l, leave)),
	);
	if (listed) return noop('already-set');
	let ops: EditOp[] | Refused;
	if (last) {
		const written = macroWritten([last.attr]);
		if (written) return written;
		const file = fileOf(ctx, last.attr.statement);
		if (isRefused(file)) return file;
		const op = appendListItem(file, last.attr.statement, last.items, text.value);
		ops = isRefused(op) ? op : [op];
	} else if (s.resource !== null) {
		const sym = ctx.index.resources.get(s.resource);
		if (!sym) return refused('unknown-target');
		const top = topOf(ctx.index);
		const others = sym.attrs.filter(
			(a) => a.keyword === 'leaves' && a.scenario !== null && a.scenario !== top,
		);
		ops = insertAttr(ctx, sym.decl.block, 'resource', 'leaves', `leaves ${text.value}`, others);
	} else {
		const p = ctx.index.project;
		if (!p) return refused('unknown-target');
		const file = fileOf(ctx, p.decl.block);
		if (isRefused(file)) return file;
		ops = insertStatement(
			file,
			null,
			`leaves ${text.value}`,
			{ after: p.decl.block },
			{
				select: { from: 'leaves '.length, to: 'leaves '.length + text.value.length },
			},
		);
	}
	if (isRefused(ops)) return ops;
	const pos = last ? last.attr.statement : pointOf(ops);
	return (pos && checkLeave(ctx, leave, pos, at)) ?? ops;
}

/** The site holding a leave item, and the item, or a refusal. */
function findItem(
	ctx: EditContext,
	ref: SourceRange,
): { site: LeaveSite; index: number } | Refused {
	for (const site of ctx.index.leaves) {
		const i = site.items.findIndex((it) => sameRange(it, ref));
		if (i < 0) continue;
		const written = macroWritten([site.attr]);
		if (written) return written;
		if (site.scope.kind === 'resource' && site.scope.resource !== null) {
			const sym = ctx.index.resources.get(site.scope.resource);
			const hidden = sym && checkBodyMacros(ctx.ws, ctx.index, sym, ['leaves', 'vacation']);
			if (hidden) return hidden;
		}
		return { site, index: i };
	}
	return refused('unknown-target', [ref]);
}

export function planUpdateLeave(ctx: EditContext, intent: IntentOf<'updateLeave'>): IntentPlan {
	const found = findItem(ctx, intent.leave.item);
	if (isRefused(found)) return found;
	const { site } = found;
	const ref = intent.leave.item;
	const at = [ref];
	const leave = leaveOf(intent.to, at);
	if (isRefused(leave)) return leave;
	const file = fileOf(ctx, ref);
	if (isRefused(file)) return file;
	const written = file.text.sliceString(ref.from, ref.to);
	let text: string;
	if (site.keyword === 'leaves') {
		const cur = parseLeaves(written);
		if (!cur.ok || cur.value.length !== 1) return refused('unsupported-form', at);
		if (sameLeave(cur.value[0] as Leave, leave)) return noop('already-set');
		const p = printLeave(leave);
		if (!p.ok) return refused('invalid-value', at);
		text = p.value;
	} else {
		const vac = site.attr.parsed?.kind === 'vacation' ? site.attr.parsed.value : null;
		if (leave.type !== 'holiday' || (leave.name !== null && leave.name !== vac?.name))
			return refused('unsupported-form', at);
		const cur = parseVacation(written);
		const iv = cur.ok ? cur.value.intervals[0] : undefined;
		if (iv && sameInterval(iv, leave.interval)) return noop('already-set');
		const p = printInterval(leave.interval);
		if (!p.ok) return refused('invalid-value', at);
		text = p.value;
	}
	return checkLeave(ctx, leave, ref, at) ?? [replaceSpan(file, ref, text)];
}

export function planRemoveLeave(ctx: EditContext, intent: IntentOf<'removeLeave'>): IntentPlan {
	const found = findItem(ctx, intent.leave.item);
	if (isRefused(found)) return found;
	const { site, index } = found;
	const file = fileOf(ctx, site.attr.statement);
	if (isRefused(file)) return file;
	const ops = removeListItems(file, site.items, [index]);
	return ops ?? [removeStatement(file, site.attr.statement)];
}

export const LEAVE_HANDLERS: {
	readonly addLeave: IntentHandler<'addLeave'>;
	readonly updateLeave: IntentHandler<'updateLeave'>;
	readonly removeLeave: IntentHandler<'removeLeave'>;
} = {
	addLeave: { plan: planAddLeave },
	updateLeave: { plan: planUpdateLeave, sameInEveryVisit: true },
	removeLeave: { plan: planRemoveLeave },
};
