// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The context tracker of the TJP grammar (phase-1.md 5.2). It keeps the stack of open bodies,
 * each keyed by the scoped keyword id whose body it is ('task', 'limits.task', 'supplement.task'),
 * so that the tokenizer (lexer.ts) can tell which identifiers are keywords where it stands.
 *
 * A frame also remembers the context that a `{` would open in the statement being read: a keyword
 * sets it, a `supplement` sets it once its subject (`task`, `resource`) is read, and the end of the
 * statement clears it. It survives a nested body, so `depends a { … }, b { … }` opens the
 * `depends` context twice. A `{` of an unknown body, or of a `%{ … }` date expression, opens a
 * frame with no context, where no identifier is a keyword.
 */
import { ContextTracker, type InputStream } from '@lezer/lr';
import type { Tree, TreeCursor } from '@lezer/common';
import {
	isContext,
	topContextId,
	type ContextId,
	type KeywordEntry,
	type TopContextName,
} from '../syntax/keywords';
import { headBodyContext, resolveHeadKeyword } from './keyword-extras';
import { HEAD_KEYWORD_TERMS, STATEMENT_TERMS } from './terms';
import * as T from './parser.terms.generated';

function hashString(h: number, s: string | null): number {
	if (s === null) return Math.imul(h ^ 0x9e37, 0x85ebca6b) | 0;
	let x = h ^ (s.length + 1);
	for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193);
	return x | 0;
}

/** One open body. Immutable; `hash` identifies its content for incremental reuse. */
export class TjpFrame {
	readonly hash: number;

	constructor(
		/** Where identifiers resolve to keywords; null in a body whose context is unknown. */
		readonly ctx: ContextId | null,
		/** The context the next `{` of the current statement opens. */
		readonly pending: ContextId | null,
		/** A keyword whose body context depends on its subject (`supplement`), read next. */
		readonly awaiting: KeywordEntry | null,
		readonly parent: TjpFrame | null,
	) {
		let h = parent ? parent.hash : 0x2545f491;
		h = hashString(h, ctx);
		h = hashString(h, pending);
		h = hashString(h, awaiting ? awaiting.keyword : null);
		this.hash = h;
	}

	/** The nesting depth: 0 at the top of the file. */
	get depth(): number {
		let d = 0;
		for (let f = this.parent; f; f = f.parent) d++;
		return d;
	}

	with(pending: ContextId | null, awaiting: KeywordEntry | null): TjpFrame {
		if (pending === this.pending && awaiting === this.awaiting) return this;
		return new TjpFrame(this.ctx, pending, awaiting, this.parent);
	}
}

/** The frame at the top of a file parsed with this top context (spec 5.2). */
export function topFrame(top: TopContextName): TjpFrame {
	return new TjpFrame(topContextId(top), null, null, null);
}

/** The identifier (word characters) at `offset` from the stream position. */
function wordAt(input: InputStream, offset: number): string {
	let s = '';
	for (let i = offset; ; i++) {
		const c = input.peek(i);
		const word = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95;
		if (!word) return s;
		s += String.fromCharCode(c);
	}
}

/** The context the body of `entry` opens when its subject is `subject`. */
function subjectContext(entry: KeywordEntry, subject: string): ContextId | null {
	return headBodyContext(entry, subject) ?? (isContext(subject) ? subject : null);
}

/**
 * The frame after shifting `term`, whose text starts at `offset` from the stream position.
 * Exported, with reduceFrame, for tests.
 */
export function shiftFrame(
	frame: TjpFrame,
	term: number,
	input: InputStream,
	offset: number,
): TjpFrame {
	switch (term) {
		case T.OpenBrace:
			return new TjpFrame(frame.pending, null, null, frame);
		case T.ExprOpen:
			return new TjpFrame(null, null, null, frame);
		case T.CloseBrace:
			return frame.parent ?? frame;
		case T.SupplementKind:
			if (frame.awaiting)
				return frame.with(subjectContext(frame.awaiting, wordAt(input, offset)), null);
			return frame;
		default:
			if (HEAD_KEYWORD_TERMS.has(term)) {
				const entry =
					frame.ctx === null ? null : resolveHeadKeyword(wordAt(input, offset), frame.ctx);
				if (!entry) return frame.with(null, null);
				const body = headBodyContext(entry);
				return frame.with(body, body === null ? entry : null);
			}
			return frame;
	}
}

/** The frame after reducing `term`: the end of a statement clears its state. */
export function reduceFrame(frame: TjpFrame, term: number): TjpFrame {
	return STATEMENT_TERMS.has(term) ? frame.with(null, null) : frame;
}

/** Whether every brace in `tree` (outside error nodes) is closed inside it. Cached per tree. */
const balancedTrees = new WeakMap<Tree, boolean>();

function isBalanced(tree: Tree): boolean {
	let known = balancedTrees.get(tree);
	if (known === undefined) {
		let depth = 0;
		let low = 0;
		const cursor = tree.cursor();
		for (let more = true; more;) {
			const id = cursor.type.id;
			if (id === T.OpenBrace || id === T.ExprOpen) depth++;
			else if (id === T.CloseBrace) low = Math.min(low, --depth);
			more = (!cursor.type.isError && cursor.firstChild()) || nextOutside(cursor, tree);
		}
		known = depth === 0 && low === 0;
		balancedTrees.set(tree, known);
	}
	return known;
}

/** Moves to the next sibling of the cursor or of an ancestor inside `root`; false at the end. */
function nextOutside(cursor: TreeCursor, root: Tree): boolean {
	for (;;) {
		if (cursor.tree === root) return false;
		if (cursor.nextSibling()) return true;
		if (!cursor.parent()) return false;
	}
}

/**
 * Replays the shifts and statement reductions inside a node that an incremental parse reuses,
 * so the context after it is the one a fresh parse would have. `input` starts at the node.
 * Error nodes are skipped, as the parser does not shift the tokens it deletes. A statement whose
 * braces balance only clears the statement state, so it is not walked.
 */
function replay(frame: TjpFrame, tree: Tree, input: InputStream): TjpFrame {
	let f = frame;
	const cursor = tree.cursor();
	const base = cursor.from;
	let depth = 0;
	for (;;) {
		const type = cursor.type;
		const sub = cursor.tree;
		if (STATEMENT_TERMS.has(type.id) && sub && isBalanced(sub)) {
			f = f.with(null, null);
		} else if (!type.isError && cursor.firstChild()) {
			depth++;
			continue;
		} else if (!type.isError) {
			f = shiftFrame(f, type.id, input, cursor.from - base);
		}
		for (;;) {
			if (depth === 0) return f;
			if (cursor.nextSibling()) break;
			cursor.parent();
			depth--;
			f = reduceFrame(f, cursor.type.id);
		}
	}
}

/** The tracker for a top context. The generated parser uses the global one. */
export function tjpContextFor(top: TopContextName): ContextTracker<TjpFrame> {
	return new ContextTracker<TjpFrame>({
		start: topFrame(top),
		shift: (frame, term, _stack, input) => shiftFrame(frame, term, input, 0),
		reduce: (frame, term) => reduceFrame(frame, term),
		reuse: (frame, node, _stack, input) => replay(frame, node, input),
		hash: (frame) => frame.hash,
		strict: true,
	});
}

export const tjpContext = tjpContextFor('global');
