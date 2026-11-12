// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the TJP editor extensions know about the file they edit (phase-1.md 6.7): its workspace
 * path and top context, the keyword docs, and optionally the workspace and the symbol index.
 * `tjp(opts)` (cm/index.ts) puts it in a facet, so completion, hover, the format command and the
 * lint layer read it from the state. The workspace reconfigures the facet with the rest of the
 * extensions when the file's parse context changes (workspace.ts, §15.7).
 */
import { Facet, type EditorState } from '@codemirror/state';
import type { WorkspacePath } from '../../../engine/protocol';
import type { Workspace } from '../../workspace/workspace';
import type { TjpFile, TopContext } from '../document';
import type { RefusalReason } from '../edit/types';
import type { FormatRefusalReason } from '../format';
import type { SymbolIndex } from '../index/types';
import { KEYWORDS } from '../syntax/keywords';
import type { KeywordDocsSource } from '../syntax/docs';
import type { SourceRange } from '../tree';

/** What the format command did, for the caller's toast or status line. */
export type FormatOutcome =
	| { readonly status: 'formatted'; readonly changes: number; readonly unit: string }
	| { readonly status: 'unchanged' }
	| {
			readonly status: 'refused';
			readonly reason: FormatRefusalReason | RefusalReason;
			readonly at: readonly SourceRange[];
	  };

export interface TjpEditorOptions {
	readonly top: TopContext;
	/** Keyword docs: the committed table, plus the engine's once `syntax()` resolves. */
	readonly docs: () => KeywordDocsSource;
	/** The file's workspace path; '' for an editor outside a workspace. */
	readonly path?: WorkspacePath;
	/**
	 * The workspace that holds the file. A getter, because the workspace creates each file's
	 * state (and so calls the extension factory) before `createWorkspace` returns.
	 */
	readonly workspace?: () => Workspace | null;
	/** The latest symbol index, or null before the first build. */
	readonly index?: () => SymbolIndex | null;
	/**
	 * Complete task and resource ids after `depends`, `allocate` and the like (default true;
	 * ADR-0004 ships id completion in Phase 1).
	 */
	readonly ids?: boolean;
	/** Called after each run of the format command. */
	readonly onFormat?: (outcome: FormatOutcome) => void;
}

export interface TjpEnv {
	readonly top: TopContext;
	readonly path: WorkspacePath;
	readonly docs: () => KeywordDocsSource;
	readonly workspace: () => Workspace | null;
	readonly index: () => SymbolIndex | null;
	readonly ids: boolean;
	readonly onFormat: (outcome: FormatOutcome) => void;
}

const TABLE_ONLY: KeywordDocsSource = { table: KEYWORDS, engine: null };

export function envOf(opts: TjpEditorOptions): TjpEnv {
	return {
		top: opts.top,
		path: opts.path ?? '',
		docs: opts.docs,
		workspace: opts.workspace ?? (() => null),
		index: opts.index ?? (() => null),
		ids: opts.ids ?? true,
		onFormat: opts.onFormat ?? (() => {}),
	};
}

const DEFAULT_ENV: TjpEnv = envOf({ top: 'global', docs: () => TABLE_ONLY });

/** The editor's TJP environment; the first value wins. */
export const tjpEnv = Facet.define<TjpEnv, TjpEnv>({
	combine: (values) => values[0] ?? DEFAULT_ENV,
});

/**
 * The workspace's file for this state when its text is the state's document, so its tree and
 * the index built from it describe what the editor shows; null otherwise.
 */
export function workspaceFile(state: EditorState): TjpFile | null {
	const env = state.facet(tjpEnv);
	const ws = env.workspace();
	if (!ws || env.path === '') return null;
	const file = ws.snapshot().files.get(env.path);
	if (!file) return null;
	return file.text === state.doc || file.text.eq(state.doc) ? file : null;
}

/** The index when it was built from the workspace version whose text the editor shows. */
export function currentIndex(state: EditorState): SymbolIndex | null {
	const env = state.facet(tjpEnv);
	const index = env.index();
	const ws = env.workspace();
	if (!index || !ws) return null;
	if (index.version !== ws.snapshot().version) return null;
	return workspaceFile(state) ? index : null;
}
