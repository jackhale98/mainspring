// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Everything in the app that needs the editor packages (@codemirror/view, language, commands,
 * autocomplete, lint, search), behind one module. Nothing else in the main chunk imports them,
 * so the bundler makes this module and its dependencies a separate chunk that
 * `AppState.ensureEditor` loads with `import()` when an editor first mounts (phase-2.md 11.3).
 * A Visual-first load never fetches it. `@codemirror/state`, Lezer and the edit API stay in
 * the main chunk because Visual mode needs them.
 */
import { history, isolateHistory } from '@codemirror/commands';
import type { SyntaxDocs } from '../../engine/protocol';
import { docsAtCursor, workspaceExtensions, type WorkspaceExtensionOptions } from '../tjp/cm';
import { KEYWORDS } from '../tjp/syntax/keywords';
import type { EditorSupport } from '../workspace/workspace';
import { editorSetup } from './editor-setup';

export { EditorController } from './editor-controller';
export { docsAtCursor };

export interface EditorSupportOptions extends Omit<WorkspaceExtensionOptions, 'docs'> {
	/** The engine's keyword docs once it has booted; null before. */
	engineDocs: () => SyntaxDocs | null;
}

/** What `Workspace.attachEditor` needs: history, the editor setup and the TJP extensions. */
export function editorSupport(opts: EditorSupportOptions): EditorSupport {
	const { engineDocs, ...rest } = opts;
	const tjp = workspaceExtensions({
		...rest,
		docs: () => ({ table: KEYWORDS, engine: engineDocs() }),
	});
	return {
		extensions: (path, top) => [history(), tjp(path, top), editorSetup(path)],
		isolate: isolateHistory,
	};
}
