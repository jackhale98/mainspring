// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The selected source (phase-2.md 6.10): the block of the task, or the `depends` statement of the
 * link, that the visual views have selected, drawn as a line background and a left rule on every
 * line of it (theme.ts; it is not told by colour alone). It is text-only decoration: no widget,
 * no ARIA, so a screen reader hears nothing when the selection moves.
 *
 * - The span is a state field of each file's state, set with `setSourceHighlight` (null clears it).
 *   It is mapped through the changes made after it, so it follows typing inside the block until
 *   the app sets it again from a fresh index. A span that typing deletes disappears.
 * - The lines are drawn by a view plugin for the visible ranges only, so a container whose block
 *   is thousands of lines long costs the same as a leaf.
 * - `selectionSync` annotates the transactions the app dispatches to show a selection (the
 *   highlight, the scroll, the cursor). The cursor listener ignores them: this is what keeps a
 *   selection that came from a visual from coming back as one from the text.
 */
import {
	Annotation,
	RangeSetBuilder,
	StateEffect,
	StateField,
	type Extension,
} from '@codemirror/state';
import {
	Decoration,
	ViewPlugin,
	type DecorationSet,
	type EditorView,
	type ViewUpdate,
} from '@codemirror/view';

export interface SourceSpan {
	readonly from: number;
	readonly to: number;
}

export const setSourceHighlight = StateEffect.define<SourceSpan | null>();
export const selectionSync = Annotation.define<boolean>();
/** The class on each highlighted line (theme.ts styles it). */
export const SOURCE_CLASS = 'cm-source-selected';

export const sourceHighlightField = StateField.define<SourceSpan | null>({
	create: () => null,
	update(span, tr) {
		let next = span;
		if (next && tr.docChanged) {
			const from = tr.changes.mapPos(next.from, 1);
			const to = tr.changes.mapPos(next.to, -1);
			next = to > from ? { from, to } : null;
		}
		for (const e of tr.effects) if (e.is(setSourceHighlight)) next = e.value;
		return next;
	},
});

const line = Decoration.line({ class: SOURCE_CLASS });

/** A line decoration on each line of the span that is in view. */
function build(view: EditorView): DecorationSet {
	const span = view.state.field(sourceHighlightField);
	if (!span) return Decoration.none;
	const doc = view.state.doc;
	const b = new RangeSetBuilder<Decoration>();
	let last = -1;
	for (const r of view.visibleRanges) {
		const to = Math.min(r.to, span.to, doc.length);
		for (let pos = Math.max(r.from, span.from); pos <= to;) {
			const l = doc.lineAt(pos);
			if (l.from > last) {
				b.add(l.from, l.from, line);
				last = l.from;
			}
			pos = l.to + 1;
		}
	}
	return b.finish();
}

const plugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = build(view);
		}
		update(u: ViewUpdate): void {
			if (
				u.docChanged ||
				u.viewportChanged ||
				u.startState.field(sourceHighlightField) !== u.state.field(sourceHighlightField)
			) {
				this.decorations = build(u.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

/** The field and the plugin; part of every file's extensions (index.ts). */
export function sourceHighlight(): Extension {
	return [sourceHighlightField, plugin];
}
