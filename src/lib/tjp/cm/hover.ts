// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Hover for TJP (phase-1.md 6.7, 8.2).
 *
 * - On a statement keyword: its syntax line and summary from the committed table at once, and
 *   the engine's full documentation and "see also" once `syntax()` has resolved (and its version
 *   matches the table, `engineDocsMatch`). The keyword is resolved in its statement's context,
 *   so `booking` in a resource body shows 'booking.resource'.
 * - On a task or resource id (a declaration header, `depends`, `allocate`, `responsible`,
 *   `managers`, `supplement`) or a macro name: what the index says it is, with the declaration's
 *   file, line and header text. Only while the index describes the text the editor shows
 *   (env.ts `currentIndex`); a stale index gives no id hover rather than a wrong one.
 *
 * `hoverInfo` and `hoverContent` are plain data, so they are tested without a DOM;
 * `renderHover` builds the tooltip. `keywordAtCursor` serves the phone docs sheet (8.1), where
 * hover does not exist.
 */
import type { EditorState, Extension } from '@codemirror/state';
import { hoverTooltip, type EditorView, type Tooltip } from '@codemirror/view';
import { editorStrings as S } from '../../strings';
import type { WorkspacePath } from '../../../engine/protocol';
import { tjLineOf } from '../lines';
import type { SourceRange, SymbolHit, SymbolIndex } from '../index/types';
import { keywordDoc, type KeywordDocsSource, type KeywordDocView } from '../syntax/docs';
import type { KeywordEntry } from '../syntax/keywords';
import { enclosingStatement, statementHead } from '../tree';
import { keywordEntryOf, keywordNodeAt, treeAt } from './context';
import { currentIndex, tjpEnv } from './env';

export interface Declaration {
	readonly file: WorkspacePath;
	/** As TaskJuggler counts lines. */
	readonly line: number;
	/** The first line of the declaration header, shortened. */
	readonly header: string;
}

export type HoverInfo =
	| {
			readonly kind: 'keyword';
			readonly from: number;
			readonly to: number;
			readonly doc: KeywordDocView;
	  }
	| {
			readonly kind: 'symbol';
			readonly from: number;
			readonly to: number;
			readonly of: 'task' | 'resource' | 'macro';
			readonly id: string;
			readonly name: string | null;
			readonly decl: Declaration | null;
	  }
	| {
			readonly kind: 'unresolved';
			readonly from: number;
			readonly to: number;
			readonly of: 'task' | 'resource';
			readonly written: string;
	  };

const MAX_HEADER = 120;

function text(state: EditorState): (from: number, to: number) => string {
	return (from, to) => state.sliceDoc(from, to);
}

/** The scoped keyword entry at `pos`, resolved in its statement's context. */
function keywordAt(
	state: EditorState,
	pos: number,
): { entry: KeywordEntry; from: number; to: number } | null {
	const tree = treeAt(state, pos);
	const node = keywordNodeAt(tree, pos);
	if (!node) return null;
	const entry = keywordEntryOf(tree, node, state.facet(tjpEnv).top, text(state));
	return entry ? { entry, from: node.from, to: node.to } : null;
}

/**
 * The keyword entry for the phone docs sheet: the keyword under the cursor, else the keyword
 * that leads the statement around the cursor; null when there is none in the table.
 */
export function keywordAtCursor(state: EditorState): KeywordEntry | null {
	const head = state.selection.main.head;
	const direct = keywordAt(state, head);
	if (direct) return direct.entry;
	const stmt = enclosingStatement(treeAt(state, head).resolveInner(head, -1));
	const kw = stmt ? statementHead(stmt) : null;
	if (!stmt || !kw || kw.name !== 'Keyword') return null;
	return keywordAt(state, kw.from)?.entry ?? null;
}

function declarationOf(state: EditorState, at: SourceRange): Declaration | null {
	const ws = state.facet(tjpEnv).workspace();
	const file = ws?.snapshot().files.get(at.file);
	if (!file) return null;
	const raw = file.text.sliceString(at.from, at.to);
	const first = raw.split(/\r\n|\r|\n/, 1)[0] ?? '';
	const header = first.length > MAX_HEADER ? `${first.slice(0, MAX_HEADER)}…` : first;
	return { file: at.file, line: tjLineOf(file.text, at.from), header };
}

function symbolInfo(state: EditorState, index: SymbolIndex, hit: SymbolHit): HoverInfo | null {
	switch (hit.kind) {
		case 'task':
		case 'resource': {
			if (hit.role !== 'header') return null;
			const sym = hit.kind === 'task' ? index.tasks.get(hit.id) : index.resources.get(hit.id);
			const decl = sym ? declarationOf(state, sym.decl.header) : null;
			return {
				kind: 'symbol',
				from: hit.at.from,
				to: hit.at.to,
				of: hit.kind,
				id: hit.id,
				name: sym?.name ?? null,
				decl,
			};
		}
		case 'reference': {
			const ref = hit.ref;
			if (ref.kind === 'flag') return null;
			const { from, to } = ref.at;
			if (ref.target === null)
				return { kind: 'unresolved', from, to, of: ref.kind, written: ref.written };
			const sym =
				ref.kind === 'task' ? index.tasks.get(ref.target) : index.resources.get(ref.target);
			if (!sym) return { kind: 'unresolved', from, to, of: ref.kind, written: ref.written };
			return {
				kind: 'symbol',
				from,
				to,
				of: ref.kind,
				id: sym.id,
				name: sym.name,
				decl: declarationOf(state, sym.decl.header),
			};
		}
		case 'supplement': {
			if (hit.target === null) return null;
			const sym = hit.of === 'task' ? index.tasks.get(hit.target) : index.resources.get(hit.target);
			if (!sym) return null;
			return {
				kind: 'symbol',
				from: hit.at.from,
				to: hit.at.to,
				of: hit.of,
				id: sym.id,
				name: sym.name,
				decl: declarationOf(state, sym.decl.header),
			};
		}
		case 'macro': {
			const def = index.macros.get(hit.name)?.[0];
			const decl = def ? declarationOf(state, def.statement) : null;
			return {
				kind: 'symbol',
				from: hit.at.from,
				to: hit.at.to,
				of: 'macro',
				id: hit.name,
				name: null,
				decl,
			};
		}
	}
}

/** What to show when hovering `pos`: a keyword's docs or an id's declaration (module comment). */
export function hoverInfo(
	state: EditorState,
	pos: number,
	docs: () => KeywordDocsSource,
): HoverInfo | null {
	const kw = keywordAt(state, pos);
	if (kw) {
		const doc = keywordDoc(docs(), kw.entry.keyword);
		return doc ? { kind: 'keyword', from: kw.from, to: kw.to, doc } : null;
	}
	const index = currentIndex(state);
	const path = state.facet(tjpEnv).path;
	const hit = index ? index.symbolAt(path, pos) : null;
	return index && hit ? symbolInfo(state, index, hit) : null;
}

/** The tooltip's text, by part. */
export interface HoverContent {
	readonly title: string;
	/** A syntax line or the declaration header. */
	readonly code: string | null;
	readonly body: string | null;
	readonly notes: readonly string[];
	readonly seeAlso: readonly string[];
}

const KIND_LABEL = {
	task: S.hover.task,
	resource: S.hover.resource,
	macro: S.hover.macro,
} as const;

export function hoverContent(info: HoverInfo): HoverContent {
	switch (info.kind) {
		case 'keyword': {
			const d = info.doc;
			const notes: string[] = [];
			if (d.scenarioSpecific) notes.push(S.hover.scenarioSpecific);
			if (d.doc === null) notes.push(S.hover.docsLoading);
			return {
				title: d.name,
				code: d.syntax,
				body: d.doc ?? (d.summary || null),
				notes,
				seeAlso: d.seeAlso,
			};
		}
		case 'symbol': {
			const title = S.hover.symbolTitle(KIND_LABEL[info.of], info.id, info.name);
			const notes = info.decl ? [S.hover.declaredAt(info.decl.file, info.decl.line)] : [];
			return { title, code: info.decl?.header ?? null, body: null, notes, seeAlso: [] };
		}
		case 'unresolved':
			return {
				title: S.hover.symbolTitle(KIND_LABEL[info.of], info.written, null),
				code: null,
				body: S.hover.unknownTarget(info.written),
				notes: [],
				seeAlso: [],
			};
	}
}

/** The tooltip DOM (browser only). */
export function renderHover(content: HoverContent, doc: Document): HTMLElement {
	const root = doc.createElement('div');
	root.className = 'cm-tjp-hover';
	const add = (tag: string, cls: string, value: string): HTMLElement => {
		const el = doc.createElement(tag);
		el.className = cls;
		el.textContent = value;
		root.appendChild(el);
		return el;
	};
	add('div', 'cm-tjp-hover-title', content.title);
	if (content.code) add('code', 'cm-tjp-hover-code', content.code);
	if (content.body) add('div', 'cm-tjp-hover-body', content.body);
	for (const n of content.notes) add('div', 'cm-tjp-hover-note', n);
	if (content.seeAlso.length > 0) {
		add('div', 'cm-tjp-hover-note', S.hover.seeAlso(content.seeAlso));
	}
	return root;
}

/** Keyword and id hover (spec 6.7 `keywordHover`). */
export function keywordHover(docs: () => KeywordDocsSource): Extension {
	return hoverTooltip((view: EditorView, pos: number): Tooltip | null => {
		const info = hoverInfo(view.state, pos, docs);
		if (!info) return null;
		const content = hoverContent(info);
		return {
			pos: info.from,
			end: info.to,
			above: true,
			create: () => ({ dom: renderHover(content, view.dom.ownerDocument) }),
		};
	});
}
