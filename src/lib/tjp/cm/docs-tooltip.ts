// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Hover content by keyboard (phase-1.md 8.2, review of T13): `showDocsCommand` shows the hover
 * tooltip for the cursor position (a keyword's docs or an id's declaration) or, when the cursor
 * is not on one, for the keyword that leads the statement around it, as the phone docs sheet
 * does (`keywordAtCursor`). The tooltip closes on Escape, on any edit and when the cursor moves.
 * With nothing to show it says so, so the key never seems dead.
 */
import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { showTooltip, type Command, type Tooltip } from '@codemirror/view';
import { editorStrings as S } from '../../strings';
import { keywordDoc } from '../syntax/docs';
import { tjpEnv } from './env';
import { hoverContent, hoverInfo, keywordAtCursor, renderHover, type HoverContent } from './hover';

interface Shown {
	readonly pos: number;
	readonly content: HoverContent;
}

const showDocs = StateEffect.define<Shown | null>();

function tooltipOf(shown: Shown): Tooltip {
	return {
		pos: shown.pos,
		above: true,
		create: (view) => ({ dom: renderHover(shown.content, view.dom.ownerDocument) }),
	};
}

export const docsTooltipField = StateField.define<Shown | null>({
	create: () => null,
	update(value, tr) {
		let next = value;
		if (next && (tr.docChanged || tr.selection)) next = null;
		for (const e of tr.effects) if (e.is(showDocs)) next = e.value;
		return next;
	},
	provide: (f) =>
		showTooltip.compute([f], (state) => {
			const shown = state.field(f);
			return shown ? tooltipOf(shown) : null;
		}),
});

/** What the docs command shows at the cursor (module comment). */
export function docsAtCursor(state: EditorState): HoverContent {
	const head = state.selection.main.head;
	const docs = state.facet(tjpEnv).docs;
	const info = hoverInfo(state, head, docs) ?? hoverInfo(state, Math.max(0, head - 1), docs);
	if (info) return hoverContent(info);
	const entry = keywordAtCursor(state);
	const doc = entry ? keywordDoc(docs(), entry.keyword) : null;
	if (doc) return hoverContent({ kind: 'keyword', from: head, to: head, doc });
	return { title: S.hover.noDocs, code: null, body: null, notes: [], seeAlso: [] };
}

/** Shows the docs tooltip at the cursor (needs `tjp()`, which holds the tooltip field). */
export const showDocsCommand: Command = (view) => {
	const state = view.state;
	if (state.field(docsTooltipField, false) === undefined) return false;
	view.dispatch({
		effects: showDocs.of({ pos: state.selection.main.head, content: docsAtCursor(state) }),
	});
	return true;
};

/** Closes the docs tooltip; false (so Escape does its usual work) when none is open. */
export const hideDocsCommand: Command = (view) => {
	if (!view.state.field(docsTooltipField, false)) return false;
	view.dispatch({ effects: showDocs.of(null) });
	return true;
};
