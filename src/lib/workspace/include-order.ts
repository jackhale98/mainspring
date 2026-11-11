// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * TaskJuggler's reading order across the files of a workspace (phase-1.md 5.4): a position in an
 * included file is read at its include site. A file with several visits is read several times,
 * so a position is placed through one of its visits: the first, the last (the default, which is
 * what 5.4's last-site rule for single-valued attributes needs) or a given visit index. Each
 * position may name its own visit (`ParsePosition.visit`), since a visit index belongs to one
 * file; the `which` argument applies to positions that do not.
 */
import type { IncludeGraph, IncludeVisit } from './includes';
import type { WorkspacePath } from './paths';

/** Which visit of a file places a position: 'first', 'last' or a visit index. */
export type VisitChoice = 'first' | 'last' | number;

export interface ParsePosition {
	readonly file: WorkspacePath;
	readonly from: number;
	/** The visit of `file` that places this position; overrides the `which` argument. */
	readonly visit?: VisitChoice;
}

function chosenVisit(
	graph: IncludeGraph,
	file: WorkspacePath,
	which: VisitChoice,
): IncludeVisit | null {
	if (typeof which === 'number') {
		const v = graph.visits[which];
		return v && v.file === file ? v : null;
	}
	let found: IncludeVisit | null = null;
	for (const v of graph.visits) {
		if (v.file !== file) continue;
		found = v;
		if (which === 'first') break;
	}
	return found;
}

/**
 * The position of `at` in reading order: the offsets of the include sites from the entry down to
 * the chosen visit of its file, then its own offset. Null for a file the entry does not reach.
 */
export function parseOrderKey(
	graph: IncludeGraph,
	at: ParsePosition,
	which: VisitChoice = 'last',
): number[] | null {
	const key = [at.from];
	let v = chosenVisit(graph, at.file, at.visit ?? which);
	if (!v) return null;
	while (v.edge !== null && v.parent !== null) {
		const e = graph.edges[v.edge];
		const up: IncludeVisit | undefined = graph.visits[v.parent];
		if (!e || !up) return null;
		key.unshift(e.site.from);
		v = up;
	}
	return key;
}

/**
 * Compares two positions in reading order (negative when `a` is read first), each placed through
 * its own `visit`, else through `which` ('first' or 'last'). Positions in files the entry does
 * not reach come last, in path order.
 */
export function compareParseOrder(
	graph: IncludeGraph,
	a: ParsePosition,
	b: ParsePosition,
	which: 'first' | 'last' = 'last',
): number {
	const ka = parseOrderKey(graph, a, which);
	const kb = parseOrderKey(graph, b, which);
	if (!ka || !kb) {
		if (ka) return -1;
		if (kb) return 1;
		return a.file < b.file ? -1 : a.file > b.file ? 1 : a.from - b.from;
	}
	for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
		const d = (ka[i] ?? 0) - (kb[i] ?? 0);
		if (d !== 0) return d;
	}
	return ka.length - kb.length;
}
