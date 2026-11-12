// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Block text for the task tree intents (phase-1.md 7.1 `addTask`, `moveTask`; 7.2 "Re-indenting
 * a moved block").
 *
 * `movedText` gives the text of a block (with its leading comments) as it is written at a new
 * depth, in another unit and with another line break, by format's line rules (format.ts
 * `analyzeLines`, 15.13):
 *
 * - a line whose first token starts a statement, a comment between statements or a body brace
 *   (`absolute`) gets the new base indentation plus one unit per body level below the block;
 * - a continuation line keeps its offset from its statement's first line (as format does);
 * - lines that start inside a quoted string, a block comment, a macro body or call, or a
 *   macro-related text-only range (`kept`) are left exactly as written;
 * - the inner lines of a cut-here string move with the statement that holds it: TaskJuggler
 *   strips the first inner line's indentation from every line, so that indentation can change
 *   freely while every other inner line starts with it (or is empty). It becomes the statement's
 *   new indentation plus the old extra, in destination units when the extra is whole source units
 *   (so a tab-indented string moved into a space-indented file does not mix the two). Otherwise
 *   (an inner line indented less, a blank first line) the string is left as written;
 * - blank lines stay as they are; every line break becomes the destination's break (TaskJuggler
 *   reads `\n`, `\r\n` and `\r` alike, also inside strings, 15.14). Lines are CodeMirror lines
 *   (`\n`, with a `\r` before it dropped), as format's rules use them: a lone `\r` inside a line
 *   is copied as written, so a block in a lone-CR file moves without re-indentation.
 *
 * Reference rewrites inside the block (`subs`, never across a line break) are applied first.
 * The first line is returned without indentation: the insertion op writes it.
 */
import type { SyntaxNode } from '@lezer/common';
import type { TjpFile } from '../document';
import { analyzeLines, indentOf, TAB_WIDTH } from '../format';
import { fileText, indentUnit, statementNode, type LineBreak } from './lines';
import type { Span } from './types';

export interface Reindent {
	/** Indentation of the block's first line at the destination. */
	readonly base: string;
	/** The destination file's indent unit. */
	readonly unit: string;
	readonly eol: LineBreak;
}

function columns(ws: string): number {
	let c = 0;
	for (const ch of ws) c = ch === '\t' ? (Math.floor(c / TAB_WIDTH) + 1) * TAB_WIDTH : c + 1;
	return c;
}

function bodyDepth(node: SyntaxNode): number {
	let d = 0;
	for (let n = node.parent; n; n = n.parent) if (n.name === 'Body') d++;
	return d;
}

/** The cut-here string token a line starts inside, or null. */
function cutAround(file: TjpFile, text: string, lineFrom: number): SyntaxNode | null {
	const leaf = file.tree.resolveInner(lineFrom, 1);
	if (leaf.name !== 'String' || leaf.from >= lineFrom || leaf.to <= lineFrom) return null;
	return text.startsWith('-8<-', leaf.from) ? leaf : null;
}

/** An indentation change: `old` at the start of a line becomes `now`. */
interface Shift {
	readonly old: string;
	readonly now: string;
}

/** `extra` (indentation past a statement's) in destination units when it is whole source units. */
function units(extra: string, from: string, to: string): string {
	if (extra === '' || from === to || extra.length % from.length !== 0) return extra;
	const k = extra.length / from.length;
	return extra === from.repeat(k) ? to.repeat(k) : extra;
}

/**
 * How a cut-here string's inner lines change (module comment), given the shift of the line that
 * holds its start; null to leave it as written.
 */
function cutShift(file: TjpFile, cut: SyntaxNode, stmt: Shift, unit: string): Shift | null {
	const doc = file.text;
	const first = doc.lineAt(cut.from).number + 1;
	const last = doc.lineAt(cut.to).number;
	if (first >= last) return null;
	const lineText = (n: number): string => doc.line(n).text.replace(/\r$/, '');
	const lead = indentOf(lineText(first));
	if (lead.length === lineText(first).length || !lead.startsWith(stmt.old)) return null;
	for (let n = first + 1; n < last; n++) {
		const t = lineText(n);
		if (t !== '' && !t.startsWith(lead)) return null;
	}
	return { old: lead, now: stmt.now + units(lead.slice(stmt.old.length), indentUnit(file), unit) };
}

export interface Sub {
	readonly at: Span;
	readonly insert: string;
}

export interface MovedText {
	readonly text: string;
	/** Where the block itself (after its leading comments) starts in `text`. */
	readonly blockAt: number;
}

/** [from, to) of `text` with the substitutions that lie inside it applied. */
function sliceWith(text: string, from: number, to: number, subs: readonly Sub[]): string {
	let out = '';
	let pos = from;
	for (const s of subs) {
		if (s.at.from < from || s.at.to > to) continue;
		out += text.slice(pos, s.at.from) + s.insert;
		pos = s.at.to;
	}
	return out + text.slice(pos, to);
}

/**
 * The text of [from, to) in `file` (a block with its leading comments and, with `to` past
 * `block.to`, the comments after it on its last line; starting its line or not) re-indented for
 * the destination (module comment).
 */
export function movedText(
	file: TjpFile,
	block: Span,
	from: number,
	r: Reindent,
	subs: readonly Sub[] = [],
	to: number = block.to,
): MovedText {
	const sorted = [...subs].sort((a, b) => a.at.from - b.at.from);
	const text = fileText(file);
	const doc = file.text;
	const node = statementNode(file, block);
	const d0 = node ? bodyDepth(node) : 0;
	const infos = analyzeLines(file);
	const firstLine = doc.lineAt(from);
	const oldBase = indentOf(firstLine.text);
	const startsLine = from === firstLine.from + oldBase.length;
	const lastNo = doc.lineAt(to).number;
	const written = new Map<number, { old: string; now: string }>();
	written.set(firstLine.number, { old: oldBase, now: r.base });
	const cuts = new Map<number, Shift | null>();
	const contentTo = (l: { to: number; text: string }): number =>
		Math.min(l.text.endsWith('\r') ? l.to - 1 : l.to, to);
	let out = sliceWith(text, from, contentTo(firstLine), sorted);
	let blockAt = block.from - from;
	for (let n = firstLine.number + 1; n <= lastNo; n++) {
		const line = doc.line(n);
		const end = contentTo(line);
		const body = sliceWith(text, line.from, end, sorted);
		const old = indentOf(body);
		const info = infos[n - 1];
		let indent: string | null = null;
		let strip = old.length;
		const cut = cutAround(file, text, line.from);
		if (cut) {
			let shift = cuts.get(cut.from);
			if (shift === undefined) {
				const stmt = written.get(doc.lineAt(cut.from).number);
				shift = startsLine && stmt ? cutShift(file, cut, stmt, r.unit) : null;
				cuts.set(cut.from, shift);
			}
			const stmt = written.get(doc.lineAt(cut.from).number);
			const closing = n === doc.lineAt(cut.to).number;
			if (shift && !closing && body !== '') {
				indent = shift.now;
				strip = shift.old.length;
			} else if (shift && closing && stmt && old.startsWith(stmt.old)) {
				indent = stmt.now + units(old.slice(stmt.old.length), indentUnit(file), r.unit);
			}
		} else if (info?.kind === 'absolute') {
			indent = r.base + r.unit.repeat(Math.max(0, info.depth - d0));
		} else if (info?.kind === 'continuation') {
			const anchor = written.get(info.anchor);
			if (anchor) {
				indent = old.startsWith(anchor.old)
					? anchor.now + old.slice(anchor.old.length)
					: anchor.now + ' '.repeat(Math.max(0, columns(old) - columns(anchor.old)));
			}
		}
		if (indent !== null && !cut) written.set(n, { old, now: indent });
		out += r.eol;
		if (line.from <= block.from && block.from <= end) {
			blockAt = out.length + (indent === null ? 0 : indent.length - strip);
			blockAt += block.from - line.from;
		}
		out += indent === null ? body : indent + body.slice(strip);
	}
	return { text: out, blockAt };
}
