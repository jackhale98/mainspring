// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Where a new or moved task block goes (phase-1.md 7.1 `addTask`, `moveTask`; 7.2).
 *
 * - Position: by sibling index among the parent's children (the roots for a null parent), with
 *   the moved task left out. Index `i > 0` goes right after sibling `i-1`'s block, at that block's
 *   level (in its file and body: the parent's declaration, a supplement of it, or the top level of
 *   a file included with the parent as task prefix); index 0 goes before the first sibling (above
 *   its attached comments); with no siblings, at the end of the parent's body (creating one), or at
 *   the end of the entry file for a root. A sibling that only macro expansion declares is no
 *   anchor (`text-only`).
 * - Blank lines (7.2): the block copies its previous sibling's separation, that is, a blank line
 *   goes before it when one separates that sibling from the text above it. At index 0 the
 *   separation between the first two siblings is copied between the block and the old first one.
 * - Text: `insertStatement` places a one-line placeholder by the layout rules; the block text
 *   (task-text.ts) replaces it, so bodies, one-line bodies and trailing comments behave as for any
 *   inserted statement.
 */
import type { TjpFile } from '../document';
import type { TaskSymbol } from '../index';
import { bodyOf, statementsIn } from '../tree';
import { MACRO_NODES, nextSignificant } from './refuse-macro';
import {
	attachedStart,
	blankLineBefore,
	bodyIndent,
	fileText,
	indentUnit,
	insertStatement,
	isBlank,
	isBreak,
	lineBreakNear,
	lineIndent,
	lineStart,
	startsLine,
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

export interface Destination {
	readonly file: TjpFile;
	/** The statement whose body gets the block; null at the top level of `file`. */
	readonly owner: Span | null;
	readonly place: Placement;
	/** Indentation of the block's first line. */
	readonly base: string;
	readonly unit: string;
	readonly eol: LineBreak;
	readonly blank: 'before' | 'after' | null;
}

const PLACEHOLDER = 'X';

/** The siblings at the destination, without `exclude`. */
export function siblingsAt(
	ctx: EditContext,
	parent: TaskSymbol | null,
	exclude: string | null,
): TaskSymbol[] {
	const ids = parent ? parent.children : ctx.index.taskRoots;
	const out: TaskSymbol[] = [];
	for (const id of ids) {
		const s = ctx.index.tasks.get(id);
		if (s && id !== exclude) out.push(s);
	}
	return out;
}

/** The statement owning the body that holds `block` (null at the top level). */
function ownerOf(file: TjpFile, block: Span): Span | null | undefined {
	const node = statementNode(file, block);
	if (!node) return undefined;
	const body = node.parent;
	if (!body || body.name !== 'Body') return body?.type.isTop ? null : undefined;
	const owner = body.parent;
	return owner ? { from: owner.from, to: owner.to } : undefined;
}

function anchorOf(ctx: EditContext, s: TaskSymbol): { file: TjpFile; block: Span } | Refused {
	const at = [s.decl.block];
	if (s.expandedOnly) return refused('text-only', at, { textOnly: 'expanded-only' });
	const file = ctx.ws.files.get(s.decl.block.file);
	return file ? { file, block: s.decl.block } : refused('unknown-target', at);
}

function baseIndent(file: TjpFile, owner: Span | null): string {
	if (!owner) return '';
	const node = statementNode(file, owner);
	if (!node) return '';
	return bodyOf(node)
		? bodyIndent(file, node)
		: lineIndent(fileText(file), node.from) + indentUnit(file);
}

/** The destination for sibling position `index` (module comment), or a refusal. */
export function destination(
	ctx: EditContext,
	parent: TaskSymbol | null,
	siblings: readonly TaskSymbol[],
	index: number,
): Destination | Refused {
	if (!Number.isInteger(index) || index < 0 || index > siblings.length) {
		return refused('invalid-value', parent ? [parent.decl.header] : []);
	}
	const prev = index > 0 ? siblings[index - 1] : undefined;
	const next = siblings[index];
	let file: TjpFile;
	let owner: Span | null;
	let place: Placement;
	let blank: Destination['blank'] = null;
	let near: number | null = null;
	if (prev || next) {
		const a = anchorOf(ctx, (prev ?? next) as TaskSymbol);
		if (isRefused(a)) return a;
		file = a.file;
		const o = ownerOf(file, a.block);
		if (o === undefined) return refused('unknown-target', [{ file: file.path, ...a.block }]);
		owner = o;
		near = a.block.from;
		place = prev ? { after: a.block } : { before: a.block };
		if (prev && blankLineBefore(file, a.block)) blank = 'before';
		const second = siblings[1];
		if (!prev && second && second.decl.block.file === file.path) {
			if (blankLineBefore(file, second.decl.block)) blank = 'after';
		}
	} else if (parent) {
		const f = ctx.ws.files.get(parent.decl.block.file);
		if (!f) return refused('unknown-target', [parent.decl.block]);
		file = f;
		owner = parent.decl.block;
		place = 'end';
	} else {
		const f = ctx.ws.files.get(ctx.ws.entry);
		if (!f) return refused('unknown-target');
		file = f;
		owner = null;
		place = 'end';
	}
	const text = fileText(file);
	return {
		file,
		owner,
		place,
		base: baseIndent(file, owner),
		unit: indentUnit(file),
		eol: lineBreakNear(text, near ?? owner?.from ?? text.length),
		blank,
	};
}

/**
 * A multi-line block into a one-line body (`{ task b "B" }`): the block goes on its own lines
 * (replacing the blanks where it lands), and what follows it starts a new line at the body's
 * indentation, or at the header's for the closing brace. Null when the body is not on one line,
 * the gap holds more than blanks, or a macro call follows (the usual insertion and its macro
 * checks apply then).
 */
function openOneLine(dest: Destination, block: string, select: Span): EditOp | null {
	const node = dest.owner ? statementNode(dest.file, dest.owner) : null;
	const body = node ? bodyOf(node) : null;
	const open = body?.firstChild;
	const close = body?.lastChild;
	if (!node || !body || open?.name !== 'OpenBrace' || close?.name !== 'CloseBrace') return null;
	const text = fileText(dest.file);
	if (lineStart(text, open.from) !== lineStart(text, close.from)) return null;
	const stmts = statementsIn(body);
	const place = dest.place;
	let at = stmts.length;
	if (place === 'start') at = 0;
	else if (typeof place === 'object' && 'after' in place) {
		at = stmts.findIndex((x) => x.from === place.after.from) + 1;
	} else if (typeof place === 'object' && 'before' in place) {
		at = stmts.findIndex((x) => x.from === place.before.from);
	}
	if (at < 0) return null;
	const from = stmts[at - 1]?.to ?? open.to;
	const nextNode = stmts[at] ?? close;
	const to = nextNode.from;
	if (!isBlank(text.slice(from, to))) return null;
	const next = nextSignificant(dest.file, to);
	if (next && (MACRO_NODES.has(next.name) || next.parent?.name === 'MacroCallStatement')) {
		return null;
	}
	const tail = nextNode === close ? lineIndent(text, node.from) : dest.base;
	const lead = dest.eol + dest.base;
	return {
		file: dest.file.path,
		from,
		to,
		insert: lead + block + dest.eol + tail,
		element: { from, to },
		select: { from: lead.length + select.from, to: lead.length + select.to },
	};
}

/**
 * The ops that insert `block` (its first line unindented, later lines already laid out for
 * `dest.base`) at the destination, selecting `select` (offsets into `block`).
 */
export function insertBlock(dest: Destination, block: string, select: Span): EditOp[] | Refused {
	const text = fileText(dest.file);
	const place = dest.place;
	if (typeof place === 'object' && 'before' in place && startsLine(text, place.before.from)) {
		// Right above the first sibling and its comments (insertStatement would go after the
		// statement before it, above any blank line).
		const pos = attachedStart(dest.file, place.before);
		const post = dest.blank === 'after' ? dest.eol : '';
		return [
			{
				file: dest.file.path,
				from: pos,
				to: pos,
				insert: dest.base + block + lineBreakNear(text, place.before.from) + post,
				element: { from: pos, to: pos },
				select: { from: dest.base.length + select.from, to: dest.base.length + select.to },
			},
		];
	}
	if (/[\r\n]/.test(block)) {
		const open = openOneLine(dest, block, select);
		if (open) return [open];
	}
	const r = insertStatement(dest.file, dest.owner, PLACEHOLDER, place);
	if (isRefused(r)) return r;
	return r.map((op) => {
		if (!op.select) return op;
		const before = op.insert.slice(0, op.select.from);
		const after = op.insert.slice(op.select.to);
		const own =
			/[\r\n][ \t]*$/.test(before) || (/^[ \t]*$/.test(before) && startsLine(text, op.from));
		const ownEnd = /^[\r\n]/.test(after) || (after === '' && isBreak(text[op.from]));
		const pre = own && dest.blank === 'before' ? dest.eol : '';
		const post = own && ownEnd && dest.blank === 'after' ? dest.eol : '';
		const at = pre.length + before.length;
		return {
			...op,
			insert: pre + before + block + after + post,
			select: { from: at + select.from, to: at + select.to },
		};
	});
}
