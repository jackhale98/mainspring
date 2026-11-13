// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The show-source sheet's text (phase-2.md 9.1): a task's declaration block, read from the
 * workspace as it is now and highlighted with `@lezer/highlight` over the TJP parser, with no
 * CodeMirror view, so a phone need not load the editor packages. Read-only.
 *
 * The index may be older than the text (typing, an edit whose result has not come back), so the
 * block's range is mapped forward through `changesSince(indexVersion)`, as the editor's own
 * "reveal" does. A very long block (a container with hundreds of tasks) is cut at `MAX_LINES`
 * lines; the sheet says so and offers "Open in text".
 */
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';
import { tjpGlobalParser } from '../tjp/grammar/parser';
import { currentRange } from './range';
import type { SourceRange } from '../tjp/index';
import type { Workspace } from '../workspace/workspace';

export const MAX_LINES = 400;

export interface Segment {
	readonly text: string;
	/** A token class (`tok-keyword`); empty for plain text. */
	readonly cls: string;
}

export interface SourceBlock {
	/** In current coordinates. */
	readonly at: SourceRange;
	readonly lines: number;
	readonly cut: boolean;
	readonly segments: readonly Segment[];
}

const highlighter = tagHighlighter([
	{ tag: t.keyword, class: 'tok-keyword' },
	{ tag: [t.attributeName, t.typeName, t.namespace], class: 'tok-keyword' },
	{ tag: t.definition(t.variableName), class: 'tok-definition' },
	{ tag: [t.variableName, t.name], class: 'tok-reference' },
	{ tag: t.atom, class: 'tok-literal' },
	{ tag: t.string, class: 'tok-string' },
	{ tag: [t.number, t.literal, t.unit], class: 'tok-literal' },
	{ tag: [t.lineComment, t.blockComment], class: 'tok-comment' },
	{ tag: [t.macroName, t.special(t.content)], class: 'tok-macro' },
	{ tag: [t.operator, t.punctuation, t.separator, t.brace, t.paren], class: 'tok-punct' },
	{ tag: t.invalid, class: 'tok-invalid' },
]);

/** The text split into classed runs. */
export function highlight(text: string): Segment[] {
	const out: Segment[] = [];
	let pos = 0;
	highlightTree(tjpGlobalParser.parse(text), highlighter, (from, to, cls) => {
		if (from > pos) out.push({ text: text.slice(pos, from), cls: '' });
		out.push({ text: text.slice(from, to), cls });
		pos = to;
	});
	if (pos < text.length) out.push({ text: text.slice(pos), cls: '' });
	return out;
}

/** The highlighted block of a declaration, or null when its file is gone. */
export function sourceBlock(
	ws: Workspace,
	indexVersion: number | undefined,
	block: SourceRange,
): SourceBlock | null {
	const at = currentRange(ws, indexVersion, block);
	const file = ws.snapshot().files.get(at.file);
	if (!file) return null;
	const doc = file.text;
	const first = doc.lineAt(Math.min(at.from, doc.length));
	const last = doc.lineAt(Math.min(at.to, doc.length));
	const cut = last.number - first.number + 1 > MAX_LINES;
	const to = cut ? doc.line(first.number + MAX_LINES - 1).to : Math.min(at.to, doc.length);
	// Whole lines, with the block's own indent, so the shape of the nesting is kept.
	const text = doc.sliceString(first.from, to);
	return {
		at,
		lines: last.number - first.number + 1,
		cut,
		segments: highlight(text),
	};
}
