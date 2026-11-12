// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Line mapping for engine hints (phase-1.md 6.4, 6.8): the `mapLine` and `sentLine` that
 * `hintsFromResult` needs, from the snapshot a result was scheduled from, the snapshot now and
 * the per-file changes between them (`Workspace.changesSince(sent.version)`).
 *
 * - Engine lines are TaskJuggler lines (`\n`, `\r\n` and a lone `\r` each end one, lines.ts).
 * - A line is kept when no change falls inside its text and, after the changes, that text is
 *   still a whole line: a line break or the file edge on both sides. So a change inside it, a
 *   split, a join, or text typed at either end of it drops it (`mapLine` returns null), while
 *   Enter at either end of it, or whole lines inserted or deleted next to it, keep it.
 * - `mapLine` returns the line in the current text that the index matches hints against: the
 *   CodeMirror line holding the start of the line (index/scan.ts numbers declaration headers that
 *   way; the two agree unless a file has a lone `\r`).
 * - `sentLine` returns that CodeMirror line's text as it was sent, the fingerprint `fresh()`
 *   (index/hints.ts) compares with the current line.
 * - `changesMacroDefinition` tells whether a change touched a `macro` definition. Then a header
 *   line can read as it did while its expansion, and so its id, changed (`task ${tid}` after
 *   `macro tid [t1]` became `[t2]`), so the caller drops every hint.
 */
import type { ChangeSet, Text } from '@codemirror/state';
import type { WorkspacePath } from '../../engine/protocol';
import type { TjpFile } from '../tjp/document';
import { TjLines } from '../tjp/lines';

export interface LineMap {
	mapLine(file: WorkspacePath, line: number): number | null;
	sentLine(file: WorkspacePath, line: number): string | null;
}

/** What the mapping reads from a snapshot (a WorkspaceSnapshot fits). */
export interface FileSet {
	readonly files: ReadonlyMap<WorkspacePath, TjpFile>;
}

/** One change of a change set, in the coordinates of the text before it. */
export interface ChangedRange {
	readonly fromA: number;
	readonly toA: number;
}

/** TaskJuggler line starts of each sent file, kept while the file object lives. */
const tjLinesOf = new WeakMap<TjpFile, TjLines>();

function tjLines(file: TjpFile): TjLines {
	let lines = tjLinesOf.get(file);
	if (!lines) {
		lines = new TjLines(file.text);
		tjLinesOf.set(file, lines);
	}
	return lines;
}

export function changedRanges(changes: ChangeSet): ChangedRange[] {
	const out: ChangedRange[] = [];
	changes.iterChanges((fromA, toA) => {
		out.push({ fromA, toA });
	});
	return out;
}

/**
 * Whether a change (ascending, disjoint) falls inside the text [from, to]: it replaces or
 * deletes a character of it, or inserts strictly between its ends.
 */
export function changesInside(ranges: readonly ChangedRange[], from: number, to: number): boolean {
	let lo = 0;
	let hi = ranges.length;
	// The first change that ends at or after `from`.
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((ranges[mid]?.toA ?? 0) < from) lo = mid + 1;
		else hi = mid;
	}
	for (let i = lo; i < ranges.length; i++) {
		const r = ranges[i];
		if (!r || r.fromA > to) break;
		if (r.fromA === r.toA ? r.fromA > from && r.fromA < to : r.fromA < to && r.toA > from) {
			return true;
		}
	}
	return false;
}

const charAt = (doc: Text, pos: number): string =>
	pos < 0 || pos >= doc.length ? '' : doc.sliceString(pos, pos + 1);

/** Whether [from, to] of `doc` is a whole TaskJuggler line: a break or the edge on each side. */
export function wholeLine(doc: Text, from: number, to: number): boolean {
	if (to < from) return false;
	const before = charAt(doc, from - 1);
	const starts = from === 0 || before === '\n' || (before === '\r' && charAt(doc, from) !== '\n');
	const after = charAt(doc, to);
	return starts && (to === doc.length || after === '\n' || after === '\r');
}

/**
 * Whether a `MacroStatement` of `file` has text inside [from, to], or for an empty range,
 * strictly around `from`. Text next to a definition does not count.
 */
export function macroIn(file: TjpFile | undefined, from: number, to: number): boolean {
	if (!file) return false;
	let found = false;
	file.tree.iterate({
		from,
		to,
		enter: (node) => {
			if (found) return false;
			if (node.name !== 'MacroStatement') return undefined;
			found = from === to ? node.from < from && from < node.to : node.from < to && node.to > from;
			return false;
		},
	});
	return found;
}

/**
 * Whether a change touched a macro definition: it replaced, deleted or inserted text inside one
 * in the sent text, or the text it inserted is part of one in the current text (a definition
 * added or rewritten).
 */
export function changesMacroDefinition(
	sent: FileSet,
	current: FileSet,
	changes: ReadonlyMap<WorkspacePath, ChangeSet>,
): boolean {
	for (const [path, cs] of changes) {
		if (cs.empty) continue;
		const before = sent.files.get(path);
		const after = current.files.get(path);
		let hit = false;
		cs.iterChanges((fromA, toA, fromB, toB) => {
			hit ||= macroIn(before, fromA, toA) || macroIn(after, fromB, toB);
		});
		if (hit) return true;
	}
	return false;
}

interface FileMap {
	readonly sent: TjpFile;
	readonly lines: TjLines;
	/** Null: the file is unchanged. */
	readonly changes: ChangeSet | null;
	readonly ranges: readonly ChangedRange[];
	readonly current: TjpFile | null;
}

export function lineMap(
	sent: FileSet,
	current: FileSet,
	changes: ReadonlyMap<WorkspacePath, ChangeSet>,
): LineMap {
	const memo = new Map<WorkspacePath, FileMap | null>();
	const fileMap = (path: WorkspacePath): FileMap | null => {
		if (memo.has(path)) return memo.get(path) ?? null;
		const s = sent.files.get(path);
		const cs = changes.get(path);
		const changed = cs && !cs.empty ? cs : null;
		const m: FileMap | null = s
			? {
					sent: s,
					lines: tjLines(s),
					changes: changed,
					ranges: changed ? changedRanges(changed) : [],
					current: current.files.get(path) ?? null,
				}
			: null;
		memo.set(path, m);
		return m;
	};
	const span = (m: FileMap, line: number): { from: number; to: number } | null =>
		line >= 1 && line <= m.lines.count ? m.lines.range(line) : null;

	return {
		mapLine(file, line) {
			const m = fileMap(file);
			const at = m && span(m, line);
			if (!m || !at || !m.current) return null;
			const doc = m.current.text;
			const cs = m.changes;
			if (cs === null) {
				// No change listed: the same text (the length check guards a wrong change map).
				return doc.length === m.sent.text.length ? m.sent.text.lineAt(at.from).number : null;
			}
			if (cs.length !== m.sent.text.length || cs.newLength !== doc.length) return null;
			if (changesInside(m.ranges, at.from, at.to)) return null;
			// Text inserted at the start goes before the line, text inserted at the end after it.
			const from = cs.mapPos(at.from, 1);
			const to = cs.mapPos(at.to, -1);
			return wholeLine(doc, from, to) ? doc.lineAt(from).number : null;
		},
		sentLine(file, line) {
			const m = fileMap(file);
			const at = m && span(m, line);
			return m && at ? m.sent.text.lineAt(at.from).text : null;
		},
	};
}
