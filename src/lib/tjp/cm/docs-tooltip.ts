// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Hover content by keyboard (phase-1.md 8.2, review of T13): `showDocsCommand` shows the hover
 * tooltip for the cursor position (a keyword's docs or an id's declaration) or, when the cursor
 * is not on one, for the keyword that leads the statement around it, as the phone docs sheet
 * does (`keywordAtCursor`). The tooltip closes on Escape, on any edit and when the cursor moves.
 * With nothing to show it says so, so the key never seems dead. Before the engine's keyword docs
 * are in, the command and the docs sheet wait for them at most `DOCS_WAIT_MS`, as hover does
 * (docs-wait.ts, ADR-0017).
 */
import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { showTooltip, type Command, type EditorView, type Tooltip } from '@codemirror/view';
import { editorStrings as S } from '../../strings';
import { keywordDoc, type KeywordDocsSource } from '../syntax/docs';
import { docsWithin, waitsForDocs } from './docs-wait';
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

/** What the docs command shows at the cursor (module comment), from the docs as they are now. */
export function docsAtCursor(
	state: EditorState,
	docs: () => KeywordDocsSource = state.facet(tjpEnv).docs,
): HoverContent {
	const head = state.selection.main.head;
	const info = hoverInfo(state, head, docs) ?? hoverInfo(state, Math.max(0, head - 1), docs);
	if (info) return hoverContent(info);
	const entry = keywordAtCursor(state);
	const doc = entry ? keywordDoc(docs(), entry.keyword) : null;
	if (doc) return hoverContent({ kind: 'keyword', from: head, to: head, doc });
	return { title: S.hover.noDocs, code: null, body: null, notes: [], seeAlso: [] };
}

/**
 * `docsAtCursor` after waiting at most `DOCS_WAIT_MS` for the engine's docs (docs-wait.ts,
 * ADR-0017), as hover does: what the phone docs sheet shows (`AppState.openDocs`). Never rejects.
 */
export function docsAtCursorWithin(state: EditorState): Promise<HoverContent> {
	const env = state.facet(tjpEnv);
	return docsWithin(env.docs, env.loadDocs).then((src) => docsAtCursor(state, () => src));
}

/** Per view, the newest show or hide: a show that waited for the docs runs only if it still is. */
const requests = new WeakMap<EditorView, number>();
const bump = (view: EditorView): number => {
	const n = (requests.get(view) ?? 0) + 1;
	requests.set(view, n);
	return n;
};

/**
 * Shows the docs tooltip at the cursor (needs `tjp()`, which holds the tooltip field). Once the
 * engine's docs are in it shows at once; before that it waits for them as hover does
 * (`docsAtCursorWithin`), and shows nothing if the text or the cursor has moved meanwhile, or if
 * the tooltip was closed (Escape) or asked for again.
 */
export const showDocsCommand: Command = (view) => {
	const state = view.state;
	if (state.field(docsTooltipField, false) === undefined) return false;
	const pos = state.selection.main.head;
	const ticket = bump(view);
	const show = (content: HoverContent): void => {
		const now = view.state;
		if (requests.get(view) !== ticket) return;
		if (now.doc !== state.doc || now.selection.main.head !== pos) return;
		view.dispatch({ effects: showDocs.of({ pos, content }) });
	};
	if (!waitsForDocs(state.facet(tjpEnv).docs())) show(docsAtCursor(state));
	else void docsAtCursorWithin(state).then(show);
	return true;
};

/**
 * Closes the docs tooltip, and drops a show that is still waiting for the docs (Escape pressed
 * within the wait); false (so Escape does its usual work) when none is open.
 */
export const hideDocsCommand: Command = (view) => {
	bump(view);
	if (!view.state.field(docsTooltipField, false)) return false;
	view.dispatch({ effects: showDocs.of(null) });
	return true;
};
