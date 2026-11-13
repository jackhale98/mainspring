// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Removal layout rules (phase-1.md 7.2, 7.1 "each statement (with its line)", list rules), used
 * through layout.ts:
 *
 * - `removeStatement`: the statement's lines go when nothing else is on them; a trailing comment
 *   stays (with the indentation); on a shared line only the statement and the blanks on one side
 *   go. Leading comment lines (`DeclSite.leadingComments`) can go with it. Never adds blank lines.
 *   A whole block (`block`: a task or resource cut by delete or move) takes its blank-line
 *   separation with it: the blank lines right before it, or, when there are none (it is first in
 *   its body or file, follows its sibling directly, or sits below a detached comment, which keeps
 *   its own separation), the blank lines right after it. So the
 *   blocks around it keep the separation they had from each other, and the one after it moves up
 *   into its place with its spacing (7.2 copies a sibling's separation the same way).
 * - `removeStatements`: several statements at once. Statements separated only by blanks on one
 *   line are removed as one run, so their ops never overlap (`{ effort 5d start x }` loses both).
 * - `removeListItems`: several items of one list. Each run of removed items takes the separator
 *   before the next kept item, or, at the end of the list, the one after the last kept item, so
 *   `depends q, a.x, a.y` without `a.x` and `a.y` is `depends q`. Null when no item would be left
 *   (the caller removes the statement instead).
 */
import type { TjpFile } from '../document';
import {
	breakLength,
	fileText,
	isBlank,
	isBlankChar,
	isBreak,
	lineEnd,
	lineStart,
	trailingEnd,
} from './lines';
import type { EditOp, Span } from './types';

export interface RemoveOptions {
	/** Comment lines attached above the statement (`DeclSite.leadingComments`), removed with it. */
	readonly leading?: Span | null;
	/** A task or resource block: it takes one blank-line separation with it (module comment). */
	readonly block?: boolean;
}

/** The start of the line before the one starting at `from` (a `\r\n` break is one), or -1. */
function prevLine(text: string, from: number): number {
	if (from <= 0) return -1;
	const back = text[from - 1] === '\n' && text[from - 2] === '\r' ? 2 : 1;
	return lineStart(text, from - back);
}

/** A line that holds only a comment (or the end of a block comment). */
const isCommentLine = (line: string): boolean =>
	/^\s*(#|\/\/|\/\*|\*)/.test(line) || line.trimEnd().endsWith('*/');

/** Widens a whole-line removal [from, to) over its blank-line separation (module comment). */
function withSeparation(text: string, from: number, to: number): [number, number] {
	let a = from;
	for (let p = prevLine(text, a); p >= 0 && isBlank(text.slice(p, lineEnd(text, p)));) {
		a = p;
		p = prevLine(text, a);
	}
	// A comment above the blank lines is detached from the block: it keeps its separation, or it
	// would read as attached to the block below.
	const above = prevLine(text, a);
	const detached = above >= 0 && isCommentLine(text.slice(above, lineEnd(text, above)));
	let b = to;
	while (b < text.length) {
		const le = lineEnd(text, b);
		if (!isBlank(text.slice(b, le))) break;
		b = le + breakLength(text, le);
	}
	// Nothing follows at this level (the end of the file or of a body): the separation before
	// separated nothing, comment or not.
	const last = b >= text.length || text.slice(b, lineEnd(text, b)).trimStart().startsWith('}');
	if (a < from && (!detached || last)) return [a, to];
	return [from, b];
}

/** Removes a statement with its line (module comment). */
export function removeStatement(file: TjpFile, stmt: Span, opts: RemoveOptions = {}): EditOp {
	const text = fileText(file);
	const start = opts.leading ? Math.min(opts.leading.from, stmt.from) : stmt.from;
	const ls = lineStart(text, start);
	const trail = trailingEnd(file, stmt.to);
	const op = (from: number, to: number): EditOp => ({
		file: file.path,
		from,
		to,
		insert: '',
		element: { from: stmt.from, to: stmt.to },
	});
	let next = stmt.to;
	while (isBlankChar(text[next])) next++;
	if (trail === null) return op(start, next);
	if (!isBlank(text.slice(ls, start))) {
		let prev = start;
		while (prev > ls && isBlankChar(text[prev - 1])) prev--;
		return op(prev, stmt.to);
	}
	if (next < text.length && !isBreak(text[next])) return op(start, next);
	const le = lineEnd(text, stmt.to);
	const end = le + breakLength(text, le);
	return opts.block ? op(...withSeparation(text, ls, end)) : op(ls, end);
}

export interface Removal {
	readonly stmt: Span;
	readonly leading?: Span | null;
	readonly block?: boolean;
}

/** Removes several statements of one file (module comment); ops in document order. */
export function removeStatements(file: TjpFile, list: readonly Removal[]): EditOp[] {
	const text = fileText(file);
	const sorted = [...list].sort((a, b) => a.stmt.from - b.stmt.from);
	const runs: Removal[] = [];
	for (const r of sorted) {
		const last = runs[runs.length - 1];
		const start = r.leading ? Math.min(r.leading.from, r.stmt.from) : r.stmt.from;
		if (last && last.stmt.to <= start && isBlank(text.slice(last.stmt.to, start))) {
			runs[runs.length - 1] = {
				stmt: { from: last.stmt.from, to: r.stmt.to },
				leading: last.leading ?? null,
				block: !!(last.block || r.block),
			};
		} else runs.push(r);
	}
	return runs.map((r) =>
		removeStatement(file, r.stmt, { leading: r.leading ?? null, block: !!r.block }),
	);
}

/** Removes the items at `indices` of one list (module comment), or null when none would be left. */
export function removeListItems(
	file: TjpFile,
	items: readonly Span[],
	indices: Iterable<number>,
): EditOp[] | null {
	const gone = new Set([...indices].filter((i) => i >= 0 && i < items.length));
	if (gone.size === items.length) return null;
	const out: EditOp[] = [];
	for (let i = 0; i < items.length; i++) {
		if (!gone.has(i)) continue;
		let j = i;
		while (gone.has(j + 1)) j++;
		const first = items[i];
		const last = items[j];
		const next = items[j + 1];
		const prev = items[i - 1];
		if (!first || !last) break;
		const [from, to] = next ? [first.from, next.from] : [prev?.to ?? first.from, last.to];
		out.push({
			file: file.path,
			from,
			to,
			insert: '',
			element: { from: first.from, to: last.to },
		});
		i = j;
	}
	return out;
}

/** Removes item `index` with one adjacent separator, or null when it is the only item. */
export function removeListItem(
	file: TjpFile,
	items: readonly Span[],
	index: number,
): EditOp | null {
	const ops = removeListItems(file, items, [index]);
	return ops?.[0] ?? null;
}
