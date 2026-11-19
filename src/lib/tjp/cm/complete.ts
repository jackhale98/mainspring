// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Completion for TJP (phase-1.md 6.7).
 *
 * `keywordCompletionSource` offers, at the start of a statement (the first word of a line, after
 * a `{` or `}`, or after a scenario prefix), the keywords valid in the context there
 * (`contextAt`), from the committed table, so it works before the engine boots. Each option shows
 * the keyword, its syntax line as detail and its documentation as info: the full documentation
 * once the engine's docs have loaded (`KeywordDocsSource.engine`); before that the info waits for
 * them at most `DOCS_WAIT_MS` (docs-wait.ts, ADR-0017), then shows the summary, with the loading
 * note while they are still being fetched. After a scenario
 * prefix (`plan:`) only scenario-specific keywords are listed; where scenario-specific keywords
 * are valid, the scenarios of the index are offered as prefixes too. Nothing is offered inside
 * strings, comments and macro bodies, in bodies whose context is unknown, or on a line that
 * continues a list (after a comma).
 *
 * `idCompletionSource` offers task ids after `depends` and `precedes` and resource ids after
 * `allocate`, `responsible` and `managers`, from the symbol index. ADR-0004 ships it in Phase 1;
 * it is on unless the editor options turn it off (`ids: false`).
 */
import type {
	Completion,
	CompletionContext,
	CompletionResult,
	CompletionSource,
} from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { editorStrings as S } from '../../strings';
import { keywordDoc, type KeywordDocsSource, type KeywordDocView } from '../syntax/docs';
import { keywordsInContext, type KeywordEntry } from '../syntax/keywords';
import { enclosingStatement, statementHead } from '../tree';
import { contextAt, inOpaqueToken, leafAt, treeAt } from './context';
import { docsWithin, waitsForDocs } from './docs-wait';
import { tjpEnv } from './env';
import { lastCodeBefore } from './indent';

/** Text before a word that makes it a statement head: line start, `{` or `}`, a prefix. */
const HEAD = /(?:^|[{}])[ \t]*(?:([A-Za-z_][A-Za-z0-9_]*):)?$/;
const WORD = /[A-Za-z_][A-Za-z0-9_]*/;
const VALID = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** An `info` property for non-empty text (exactOptionalPropertyTypes forbids `undefined`). */
function infoOf(text: string | null | undefined): { info?: string } {
	return text ? { info: text } : {};
}

/**
 * A keyword's info pane, from its docs view: the full doc, else the summary, with the loading
 * note while the engine's docs are still being fetched (as the hover shows it). Null when empty.
 */
export function keywordInfoNode(view: KeywordDocView | null, doc: Document): Node | null {
	const body = view?.doc ?? view?.summary ?? '';
	if (!view || view.doc !== null || !view.loading) return body ? doc.createTextNode(body) : null;
	const root = doc.createElement('div');
	if (body) root.appendChild(doc.createTextNode(body));
	const note = doc.createElement('div');
	note.className = 'cm-tjp-hover-note';
	note.textContent = S.hover.docsLoading;
	root.appendChild(note);
	return root;
}

/**
 * A keyword option. Its info is the full doc once the engine's docs are in (the summary while the
 * loader rests after a failure, so CodeMirror links it with `aria-describedby`); before that it is
 * a function that waits for them at most `DOCS_WAIT_MS` (docs-wait.ts, ADR-0017) and then gives the
 * full doc, or the summary with the loading note (`keywordInfoNode`).
 */
function keywordOption(
	src: KeywordDocsSource,
	e: KeywordEntry,
	docs: () => KeywordDocsSource,
	load: () => Promise<unknown>,
): Completion {
	const base: Completion = { label: e.name, type: 'keyword', detail: e.syntax };
	const full = keywordDoc(src, e.keyword);
	if (!full || !waitsForDocs(src)) return { ...base, ...infoOf(full?.doc ?? full?.summary) };
	return {
		...base,
		info: () =>
			docsWithin(docs, load).then((now) => keywordInfoNode(keywordDoc(now, e.keyword), document)),
	};
}

/** Where a statement head may be typed before `from`, and the scenario prefix written there. */
function headAt(
	state: EditorState,
	tree: Tree,
	from: number,
): { prefix: string | null; contextPos: number } | null {
	const line = state.doc.lineAt(from);
	const m = HEAD.exec(state.sliceDoc(line.from, from));
	if (!m) return null;
	const ch = m[0][0];
	if (ch === '{' || ch === '}') {
		// Only a body's own brace starts a statement, not the `}` of `${m}` or `%{ … }`.
		const at = line.from + m.index;
		const leaf = leafAt(tree, at, 1);
		const brace = ch === '{' ? 'OpenBrace' : 'CloseBrace';
		if (!leaf || leaf.from !== at || leaf.name !== brace || leaf.parent?.name !== 'Body')
			return null;
	}
	const last = lastCodeBefore(state, tree, from - (m[1] ? m[1].length + 1 : 0));
	if (last >= 0 && state.sliceDoc(last, last + 1) === ',') return null;
	const prefix = m[1] ?? null;
	return { prefix, contextPos: prefix === null ? from : from - prefix.length - 1 };
}

/** Keyword completion (module comment). The top context comes from the editor's `tjpEnv`. */
export function keywordCompletionSource(docs: () => KeywordDocsSource): CompletionSource {
	return (cx: CompletionContext): CompletionResult | null => {
		const word = cx.matchBefore(WORD);
		if (!word && !cx.explicit) return null;
		const from = word ? word.from : cx.pos;
		const state = cx.state;
		const tree = treeAt(state, from);
		if (inOpaqueToken(tree, from)) return null;
		const head = headAt(state, tree, from);
		if (!head) return null;
		const env = state.facet(tjpEnv);
		const ctx = contextAt(tree, head.contextPos, env.top, (a, b) => state.sliceDoc(a, b));
		if (ctx === null) return null;
		const src = docs();
		const entries = keywordsInContext(ctx, { scenarioSpecificOnly: head.prefix !== null });
		const options = entries.map((e) => keywordOption(src, e, docs, env.loadDocs));
		if (head.prefix === null && entries.some((e) => e.scenarioSpecific)) {
			for (const sc of env.index()?.scenarios ?? []) {
				options.push({
					label: `${sc.id}:`,
					type: 'namespace',
					detail: S.completion.scenario,
					...infoOf(sc.name),
					boost: -1,
				});
			}
		}
		if (options.length === 0) return null;
		return { from, options, validFor: VALID };
	};
}

const ID_KEYWORDS: ReadonlyMap<string, 'task' | 'resource'> = new Map([
	['depends', 'task'],
	['precedes', 'task'],
	['allocate', 'resource'],
	['responsible', 'resource'],
	['managers', 'resource'],
]);

const ID_WORD = /[A-Za-z0-9_.]*/;
const ID_VALID = /^[A-Za-z0-9_.]*$/;

/** The id kind a statement takes as values when `pos` is past its keyword, else null. */
function idKindOf(
	stmt: SyntaxNode | null,
	pos: number,
	state: EditorState,
): 'task' | 'resource' | null {
	if (!stmt) return null;
	const head = statementHead(stmt);
	if (!head || head.name !== 'Keyword' || pos <= head.to) return null;
	return ID_KEYWORDS.get(state.sliceDoc(head.from, head.to)) ?? null;
}

/** Id completion (module comment); off with `ids: false` in the editor options. */
export function idCompletionSource(): CompletionSource {
	return (cx: CompletionContext): CompletionResult | null => {
		const state = cx.state;
		const env = state.facet(tjpEnv);
		const index = env.ids ? env.index() : null;
		if (!index) return null;
		const word = cx.matchBefore(ID_WORD);
		const from = word ? word.from : cx.pos;
		if (from === cx.pos && !cx.explicit) return null;
		if (state.sliceDoc(from - 1, from) === '!') return null;
		const tree = treeAt(state, from);
		if (inOpaqueToken(tree, from)) return null;
		const last = lastCodeBefore(state, tree, from);
		const kind =
			idKindOf(enclosingStatement(tree.resolveInner(from, -1)), from, state) ??
			(last >= 0 ? idKindOf(enclosingStatement(tree.resolveInner(last, 1)), from, state) : null);
		if (!kind) return null;
		const symbols = kind === 'task' ? index.tasks : index.resources;
		const detail = kind === 'task' ? S.completion.task : S.completion.resource;
		const options: Completion[] = [];
		for (const sym of symbols.values()) {
			options.push({ label: sym.id, type: 'variable', detail, ...infoOf(sym.name) });
		}
		return options.length === 0 ? null : { from, options, validFor: ID_VALID };
	};
}
