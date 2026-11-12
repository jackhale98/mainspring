// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * CodeMirror 6 extensions for TJP (phase-1.md 6.7). `tjp(opts)` is the full set for one file:
 *
 * - language: the LRLanguage for the file's top context, with highlighting, folding, comment
 *   tokens and the `}` re-indent trigger (language.ts);
 * - indentation by the format rules, with the file's indent unit (indent.ts);
 * - completion: keywords for the context at the cursor, scenario prefixes, and task and
 *   resource ids (ADR-0004; `ids: false` turns them off) (complete.ts);
 * - hover: keyword docs and id declarations (hover.ts), also by keyboard (docs-tooltip.ts);
 * - lint: pushed diagnostics with a gutter (lint.ts);
 * - the editor keys: format, docs at the cursor, Enter in strings, lint (commands.ts);
 * - CodeMirror's own phrases from strings.ts (`codemirrorPhrases`);
 * - the theme (theme.ts);
 * - '\n' as the only line separator, so '\r' stays in the text (spec 6; the workspace sets it
 *   too).
 *
 * The editor adds the rest of its setup (line numbers, history keymap, search, bracket
 * matching). `workspaceExtensions` is the factory for `createWorkspace`'s `opts.extensions`; the
 * workspace keeps the result in a compartment and reconfigures it when a file's parse context
 * changes (workspace.ts, §15.7).
 */
import { autocompletion } from '@codemirror/autocomplete';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { WorkspacePath } from '../../../engine/protocol';
import type { TopContext } from '../document';
import { LINE_SEPARATOR } from '../document';
import { codemirrorPhrases } from '../../strings';
import { tjpKeymap } from './commands';
import { idCompletionSource, keywordCompletionSource } from './complete';
import { envOf, tjpEnv, type TjpEditorOptions } from './env';
import { docsTooltipField } from './docs-tooltip';
import { keywordHover } from './hover';
import { tjpIndent } from './indent';
import { tjpLanguage } from './language';
import { tjpLint } from './lint';
import { tjpTheme } from './theme';

export { contextAt } from './context';
export { docsAtCursor, docsTooltipField, hideDocsCommand, showDocsCommand } from './docs-tooltip';
export {
	formatCommand,
	formatTransaction,
	originOf,
	tjpKeymap,
	tjpOrigin,
	workspaceDispatch,
} from './commands';
export { idCompletionSource, keywordCompletionSource } from './complete';
export { currentIndex, tjpEnv, workspaceFile } from './env';
export type { FormatOutcome, TjpEditorOptions, TjpEnv } from './env';
export { hoverContent, hoverInfo, keywordAtCursor, keywordHover } from './hover';
export type { HoverContent, HoverInfo } from './hover';
export { enterInString, inQuotedString, setIndentUnit, textIndentUnit, tjpIndent } from './indent';
export { tjpLanguage, tjpLanguageSupport } from './language';
export {
	drawnDiagnostics,
	redrawDiagnostics,
	setEngineDiagnostics,
	setLocalDiagnostics,
	setTjpDiagnostics,
	STALE_CLASS,
	tjpDiagnosticsField,
	tjpLint,
	type DiagnosticChannel,
} from './lint';
export { tjpEditorTheme, tjpHighlightStyle, tjpTheme } from './theme';

export interface TjpExtensionOptions extends TjpEditorOptions {
	/** Draw the lint gutter (default true). */
	readonly gutter?: boolean;
	/** Include the theme (default true); tests and embedders may bring their own. */
	readonly theme?: boolean;
}

/** The full TJP extension set for one file (module comment). */
export function tjp(opts: TjpExtensionOptions): Extension {
	const lang = tjpLanguage(opts.top);
	return [
		EditorState.lineSeparator.of(LINE_SEPARATOR),
		tjpEnv.of(envOf(opts)),
		lang,
		lang.data.of({ autocomplete: keywordCompletionSource(opts.docs) }),
		lang.data.of({ autocomplete: idCompletionSource() }),
		autocompletion(),
		tjpIndent(),
		keywordHover(opts.docs),
		docsTooltipField,
		EditorState.phrases.of(codemirrorPhrases),
		tjpLint({ gutter: opts.gutter ?? true }),
		Prec.high(keymap.of(tjpKeymap)),
		opts.theme === false ? [] : tjpTheme(),
	];
}

/** Options for every file of a workspace; the path and top come from the workspace. */
export type WorkspaceExtensionOptions = Omit<TjpExtensionOptions, 'path' | 'top'>;

/** The `opts.extensions` factory for `createWorkspace` (module comment). */
export function workspaceExtensions(
	opts: WorkspaceExtensionOptions,
): (path: WorkspacePath, top: TopContext) => Extension {
	return (path, top) => tjp({ ...opts, path, top });
}
