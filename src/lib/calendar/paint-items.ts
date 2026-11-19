// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The leave items the paint planner reads (paint.ts): each `leaves` item and `vacation` interval
 * of a scope, with its type, name and the instants TaskJuggler resolves it to, in minutes since
 * the project start. Read from the index alone (`LeaveSite.attr.parsed`), as the planner has no
 * snapshot; the edit API reads the text again when it applies the intent.
 *
 * - A scope's own items are the edit API's (tjp/edit/leave-clear.ts): for Everyone, every
 *   file-level `leaves` item and `vacation` interval; for a person, those of their declaration and
 *   supplement bodies, unprefixed or in the top scenario.
 * - A person also inherits the global items and their parent resources' own items (TaskJuggler
 *   puts both on their scoreboard): `inheritedItems`.
 * - A `vacation` interval reads as a `holiday` with the vacation's name (TaskJuggler reads it as
 *   holiday leave; the edit API keeps the name).
 * - An item the index could not read (written with a macro, invalid) or cannot resolve here (a
 *   zone or resolution set by a macro) is left out: the edit API refuses on it when it matters.
 * - `coveredBy` answers whether a paint would change nothing: TaskJuggler keeps the leave of the
 *   higher precedence where two overlap (`leaveRank`), so days already under a leave of the same
 *   or a stronger type stay as they are (T12 review).
 */
import type { Minutes } from '../../engine/protocol';
import type { LeaveSite, ResourceId, SourceRange, SymbolIndex } from '../tjp/index';
import { resolveInterval, type Interval, type LeaveType } from '../tjp/values';
import { LEAVE_TYPES } from '../tjp/values/leave';

export interface PaintItem {
	readonly site: LeaveSite;
	/** The item, as `LeaveSite.items` gives it (a `LeaveRef`'s `item`). */
	readonly range: SourceRange;
	/** The index version `range` is in (`SymbolIndex.version`; a `LeaveRef`'s `basedOn`). */
	readonly version: number;
	readonly type: LeaveType;
	readonly name: string | null;
	readonly interval: Interval;
	/** `[from, to)` in minutes since the project start. */
	readonly from: Minutes;
	readonly to: Minutes;
}

export type ItemScope = { kind: 'global' } | { kind: 'resource'; resource: ResourceId };

const topOf = (index: SymbolIndex): string | null => index.scenarios[0]?.id ?? null;

/** The leave sites a scope owns (module comment). */
function sitesOf(index: SymbolIndex, scope: ItemScope): LeaveSite[] {
	if (scope.kind === 'global') return index.leaves.filter((l) => l.scope.kind === 'global');
	const top = topOf(index);
	return index.leaves.filter(
		(l) =>
			l.scope.kind === 'resource' &&
			l.scope.resource === scope.resource &&
			(l.attr.scenario === null || l.attr.scenario === top),
	);
}

function readSite(index: SymbolIndex, site: LeaveSite, startEpoch: number): PaintItem[] {
	const v = site.attr.parsed;
	const read: Array<{ type: LeaveType; name: string | null; interval: Interval }> = [];
	if (v?.kind === 'leaves') read.push(...v.value);
	else if (v?.kind === 'vacation') {
		for (const interval of v.value.intervals) {
			read.push({ type: 'holiday', name: v.value.name, interval });
		}
	} else return [];
	if (read.length !== site.items.length) return [];
	const out: PaintItem[] = [];
	for (const [i, leave] of read.entries()) {
		const range = site.items[i] as SourceRange;
		const c = index.contextAt(range.file, range.from);
		if (c.unknown.has('zone') || c.unknown.has('granularity')) continue;
		const r = resolveInterval(leave.interval, c);
		if (!r.ok) continue;
		const [from, to] = r.value.map((e) => (e - startEpoch) / 60) as [number, number];
		out.push({ site, range, version: index.version, ...leave, from, to });
	}
	return out;
}

/** The scope's own readable items, in reading order. */
export function scopeItems(index: SymbolIndex, scope: ItemScope, startEpoch: number): PaintItem[] {
	return sitesOf(index, scope).flatMap((s) => readSite(index, s, startEpoch));
}

/** What a person inherits: the global items and their ancestors' own items. */
export function inheritedItems(
	index: SymbolIndex,
	resource: ResourceId,
	startEpoch: number,
): PaintItem[] {
	const out = scopeItems(index, { kind: 'global' }, startEpoch);
	const seen = new Set<ResourceId>([resource]);
	for (let p = index.resources.get(resource)?.parent ?? null; p !== null && !seen.has(p);) {
		seen.add(p);
		out.push(...scopeItems(index, { kind: 'resource', resource: p }, startEpoch));
		p = index.resources.get(p)?.parent ?? null;
	}
	return out;
}

/**
 * TaskJuggler's leave precedence (`LeaveList::Types` order, ResourceScenario#initScoreboard keeps
 * the larger index where leaves overlap): project < annual < special < sick < unpaid < holiday <
 * unemployed.
 */
export const leaveRank = (t: LeaveType): number => LEAVE_TYPES.indexOf(t);

/**
 * The item of the highest precedence among `items` of `type` or a stronger one, when together
 * they cover every minute of `[from, to)`; else null (a paint of `type` there changes nothing).
 */
export function coveredBy(
	items: readonly PaintItem[],
	type: LeaveType,
	from: Minutes,
	to: Minutes,
): PaintItem | null {
	const strong = items
		.filter((i) => leaveRank(i.type) >= leaveRank(type) && i.to > from && i.from < to)
		.sort((a, b) => a.from - b.from);
	let reach = from;
	for (const i of strong) {
		if (i.from > reach) return null;
		reach = Math.max(reach, i.to);
		if (reach >= to) break;
	}
	if (reach < to) return null;
	return strong.reduce<PaintItem | null>(
		(best, i) => (best === null || leaveRank(i.type) > leaveRank(best.type) ? i : best),
		null,
	);
}
