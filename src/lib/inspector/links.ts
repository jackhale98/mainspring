// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The links of a task as the inspector lists them (phase-2.md 9.3): "Waits for" (its
 * predecessors, each with a gap field and Remove) and "Followed by", and the link inspector's
 * one link. They come from `resolveLinks` (gantt/links.ts): the engine's result says which links
 * exist, their anchors and gaps; the index says where each is written, so that Remove and the gap
 * field know their text sites. Display data: nothing here schedules.
 *
 * A gap is one of two kinds. `gaplength` is working time ("2d" is two working days), `gapduration`
 * calendar time. TaskJuggler allows both on one dependency; the edit API keeps exactly one, so a
 * link with both says so (`both`) and the inspector's gap field shows the working-time one.
 */
import type { ProjectInfo } from '../../engine/protocol';
import { unitMinutes, type DurationUse } from '../schedule/duration-text';
import type { LinkRef } from '../gantt/intents';
import type { LinkState, RawLink } from '../gantt/model';
import type { TaskId, SymbolIndex } from '../tjp/index';

export type GapKind = 'gaplength' | 'gapduration';

export interface GapFact {
	readonly kind: GapKind;
	readonly minutes: number;
	/** As TaskJuggler writes it: "2d", "4h", "90min". */
	readonly text: string;
	/** The dependency has both kinds; only the working-time gap is shown. */
	readonly both: boolean;
}

/** How a link joins its two tasks (v1 shows it and does not edit it). */
export type LinkType = 'finish-start' | 'start-start' | 'finish-finish' | 'start-finish';

export interface LinkFact {
	readonly pred: TaskId;
	readonly succ: TaskId;
	readonly predName: string;
	readonly succName: string;
	readonly type: LinkType;
	readonly gap: GapFact | null;
	readonly state: LinkState;
	/** Written in the plan's text in a form the editor can change (not a macro, not engine-only). */
	readonly editable: boolean;
	/** For the `unlink` action. */
	readonly ref: LinkRef;
}

const USE: Readonly<Record<GapKind, DurationUse>> = {
	gaplength: 'gaplength',
	gapduration: 'gapduration',
};

/** Whole units are preferred (days, then hours, then minutes) so that "4h" does not become "1d". */
export function gapText(minutes: number, kind: GapKind, p: ProjectInfo | null): string {
	if (p) {
		for (const unit of ['d', 'h'] as const) {
			const per = unitMinutes(unit, p, USE[kind]);
			if (per !== null && per > 0 && minutes % per === 0) return `${minutes / per}${unit}`;
		}
	}
	return `${minutes}min`;
}

export function gapOf(
	l: Pick<RawLink, 'gapLengthMin' | 'gapDurationMin'>,
	p: ProjectInfo | null,
): GapFact | null {
	const both = l.gapLengthMin > 0 && l.gapDurationMin > 0;
	const kind: GapKind | null =
		l.gapLengthMin > 0 ? 'gaplength' : l.gapDurationMin > 0 ? 'gapduration' : null;
	if (kind === null) return null;
	const minutes = kind === 'gaplength' ? l.gapLengthMin : l.gapDurationMin;
	return { kind, minutes, text: gapText(minutes, kind, p), both };
}

export function typeOf(l: Pick<RawLink, 'from' | 'to'>): LinkType {
	if (l.from === 'end') return l.to === 'start' ? 'finish-start' : 'finish-finish';
	return l.to === 'start' ? 'start-start' : 'start-finish';
}

const nameOf = (index: SymbolIndex, id: TaskId): string => {
	const t = index.tasks.get(id);
	return t?.name ?? t?.localId ?? id;
};

export function linkFact(l: RawLink, index: SymbolIndex, p: ProjectInfo | null): LinkFact {
	return {
		pred: l.pred,
		succ: l.succ,
		predName: nameOf(index, l.pred),
		succName: nameOf(index, l.succ),
		type: typeOf(l),
		gap: gapOf(l, p),
		state: l.state,
		editable: l.sites.length > 0 && l.sites.every((s) => s.textOnly === null),
		ref: { pred: l.pred, succ: l.succ, state: l.state, sites: l.sites },
	};
}

/** The links a task waits for, and the ones that wait for it, in the order the plan lists them. */
export function linksOfTask(
	links: readonly RawLink[],
	id: TaskId,
	index: SymbolIndex,
	p: ProjectInfo | null,
): { readonly waitsFor: readonly LinkFact[]; readonly followedBy: readonly LinkFact[] } {
	return {
		waitsFor: links.filter((l) => l.succ === id).map((l) => linkFact(l, index, p)),
		followedBy: links.filter((l) => l.pred === id).map((l) => linkFact(l, index, p)),
	};
}

/** One link by its two tasks; null when it is no longer in the plan. */
export function findLink(
	links: readonly RawLink[],
	pred: TaskId,
	succ: TaskId,
	index: SymbolIndex,
	p: ProjectInfo | null,
): LinkFact | null {
	const l = links.find((x) => x.pred === pred && x.succ === succ);
	return l ? linkFact(l, index, p) : null;
}
