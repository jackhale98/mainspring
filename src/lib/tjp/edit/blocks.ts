// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Declaration blocks for the resource tree intents (resource-tree.ts; phase-1.md 7.1, 7.2):
 *
 * - `childPlace`: where a new or moved child goes among the parent's children (`index`
 *   0-based; past the end appends): after sibling `index - 1`, else before the first sibling,
 *   else at the end of the parent's body (child declarations rank last). A sibling's container is
 *   the body it is written in: the parent's declaration or a supplement of it, or the top level of
 *   its file (a root, or a child declared in a file included with a `resourceprefix`).
 * - Blank lines: a new or moved block copies the blank-line separation of its previous sibling
 *   (7.2); placed before the first sibling, it takes that sibling's separation after it.
 * - `movedText`: a block's text (with its attached leading comments) re-indented for its new
 *   place: every line moves by the depth difference (the indent unit converted when the files'
 *   units differ), except lines that start inside a quoted string, a block comment or a macro
 *   body; cut-here string lines move (TaskJuggler strips the first line's indentation from every
 *   line, so a uniform shift keeps the value). Line breaks become the destination's.
 * - `insertBlock`: places block text with the layout rules of `insertStatement` (layout.ts),
 *   through a one-character placeholder, so the block's own lines keep their layout.
 */
import type { SyntaxNode } from '@lezer/common';
import type { TjpFile } from '../document';
import type { DeclSite, ResourceSymbol, SourceRange } from '../index';
import {
	attachedStart,
	blankLineBefore,
	bodyIndent,
	fileText,
	indentUnit,
	insertStatement,
	isBreak,
	lineBreakNear,
	lineIndent,
	lineStart,
	statementNode,
	type LineBreak,
	type Placement,
} from './layout';
import {
	isRefused,
	refused,
	type EditContext,
	type EditOp,
	type Refused,
	type Span,
} from './types';

export interface ChildPlace {
	readonly file: TjpFile;
	/** The declaration (or supplement) block whose body takes the child; null: the file's top level. */
	readonly owner: SourceRange | null;
	readonly place: Placement;
	readonly blank: 'before' | 'after' | null;
}

const within = (r: SourceRange, o: SourceRange): boolean =>
	r.file === o.file && o.from <= r.from && r.to <= o.to;

/** The block whose body holds `decl`: one of the parent's blocks, or null for the top level. */
export function containerOf(parent: ResourceSymbol | null, decl: DeclSite): SourceRange | null {
	if (!parent) return null;
	const blocks = [parent.decl.block, ...parent.supplements.map((s) => s.block)];
	return blocks.find((b) => within(decl.block, b) && b.from < decl.block.from) ?? null;
}

/**
 * Where a child of `parent` (null: a root) goes at `index` among `siblings` (module comment);
 * `fallback` places a first root when there are no siblings.
 */
export function childPlace(
	ctx: EditContext,
	parent: ResourceSymbol | null,
	siblings: readonly ResourceSymbol[],
	index: number,
	fallback: () => { file: TjpFile; place: Placement } | Refused,
): ChildPlace | Refused {
	const i = Math.max(0, Math.min(index, siblings.length));
	const prev = siblings[i - 1];
	const next = siblings[0];
	const sib = prev ?? (i === 0 ? next : undefined);
	if (sib) {
		const file = ctx.ws.files.get(sib.decl.block.file);
		if (!file) return refused('unknown-target', [sib.decl.block]);
		const owner = containerOf(parent, sib.decl);
		const blank = blankLineBefore(file, sib.decl.block);
		if (prev)
			return { file, owner, place: { after: prev.decl.block }, blank: blank ? 'before' : null };
		return { file, owner, place: { before: sib.decl.block }, blank: blank ? 'after' : null };
	}
	if (parent) {
		const file = ctx.ws.files.get(parent.decl.block.file);
		if (!file) return refused('unknown-target', [parent.decl.block]);
		const place: Placement = { scope: 'resource', keyword: 'resource' };
		return { file, owner: parent.decl.block, place, blank: null };
	}
	const f = fallback();
	return isRefused(f) ? f : { ...f, owner: null, blank: null };
}

/** The indentation a statement gets in the body of `owner` (null: top level). */
export function targetIndent(file: TjpFile, owner: SourceRange | null): string | null {
	if (!owner) return '';
	const node = statementNode(file, owner);
	return node ? bodyIndent(file, node) : null;
}

/** Adds a blank line before or after inserted text that runs over whole lines. */
function withBlank(op: EditOp, blank: 'before' | 'after' | null, eol: LineBreak): EditOp {
	if (!blank || !/[\r\n]/.test(op.insert)) return op;
	if (blank === 'after') return { ...op, insert: op.insert + eol };
	const sel = op.select;
	const select = sel ? { from: sel.from + eol.length, to: sel.to + eol.length } : undefined;
	return { ...op, insert: eol + op.insert, ...(select ? { select } : {}) };
}

/**
 * Inserts block text at a child place. `text` is the block's first line without indentation and
 * its other lines already at the destination's indentation, joined with `eol`.
 */
export function insertBlock(at: ChildPlace, text: string, select: Span): EditOp[] | Refused {
	const ops = insertStatement(at.file, at.owner, 'X', at.place, { select: { from: 0, to: 1 } });
	if (isRefused(ops)) return ops;
	const eol = lineBreakNear(fileText(at.file), at.owner?.from ?? 0);
	return ops.map((op) => {
		if (!op.select || op.insert.slice(op.select.from, op.select.to) !== 'X') return op;
		const s = op.select.from;
		const insert = op.insert.slice(0, s) + text + op.insert.slice(s + 1);
		return withBlank(
			{ ...op, insert, select: { from: s + select.from, to: s + select.to } },
			at.blank,
			eol,
		);
	});
}

const OPAQUE_LINES: ReadonlySet<string> = new Set([
	'String',
	'TemplateString',
	'BlockComment',
	'MacroBody',
]);

/** Whether the line starting at `pos` starts inside a token whose text must not move. */
function startsInside(file: TjpFile, pos: number): boolean {
	const text = fileText(file);
	for (let n: SyntaxNode | null = file.tree.resolveInner(pos, 1); n; n = n.parent) {
		if (n.from >= pos || n.to <= pos) continue;
		if (!OPAQUE_LINES.has(n.name)) continue;
		return !(n.name === 'String' && text.startsWith('-8<-', n.from));
	}
	return false;
}

const LINE = /\r\n|\r|\n/g;

/**
 * The text of a block from its attached comments (or its line) to its end, re-indented from its
 * place in `file` to `indent` in a file with indent unit `unit` and line break `eol`.
 */
export function movedText(
	file: TjpFile,
	block: Span,
	indent: string,
	unit: string,
	eol: LineBreak,
): { text: string; from: number; header: number } {
	const text = fileText(file);
	const from = attachedStart(file, block);
	const start = lineStart(text, from) === from ? from + lineIndent(text, from).length : from;
	const base = lineIndent(text, from);
	const oldUnit = indentUnit(file);
	const src = text.slice(start, block.to);
	const out: string[] = [];
	let pos = start;
	let first = true;
	for (const line of src.split(LINE)) {
		if (first) out.push(line);
		else if (startsInside(file, pos)) out.push(line);
		else {
			const ind = /^[ \t]*/.exec(line)?.[0] ?? '';
			let rest = ind.startsWith(base) ? ind.slice(base.length) : null;
			if (rest !== null && oldUnit !== unit && oldUnit.length > 0) {
				const k = rest.length / oldUnit.length;
				if (Number.isInteger(k) && rest === oldUnit.repeat(k)) rest = unit.repeat(k);
			}
			out.push(rest === null ? line : indent + rest + line.slice(ind.length));
		}
		pos += line.length;
		if (pos < text.length && isBreak(text[pos]))
			pos += text[pos] === '\r' && text[pos + 1] === '\n' ? 2 : 1;
		first = false;
	}
	const joined = out.join(eol);
	// The header line comes after the attached comment lines; it starts with its indentation.
	const k = text.slice(start, block.from).split(LINE).length - 1;
	let header = 0;
	for (let i = 0; i < k; i++) header += (out[i] ?? '').length + eol.length;
	header += k === 0 ? 0 : (/^[ \t]*/.exec(out[k] ?? '')?.[0].length ?? 0);
	return { text: joined, from, header: Math.min(header, joined.length) };
}
