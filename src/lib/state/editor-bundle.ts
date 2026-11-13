// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Everything in the app that needs the editor packages (@codemirror/view, language, commands,
 * autocomplete, lint, search), behind one module. Nothing else in the main chunk imports them,
 * so the bundler makes this module and its dependencies a separate chunk that
 * `AppState.ensureEditor` loads with `import()` when an editor first mounts (phase-2.md 11.3).
 * A Visual-first load never fetches it. `@codemirror/state`, Lezer and the edit API stay in
 * the main chunk because Visual mode needs them.
 */
import type { SyntaxDocs } from '../../engine/protocol';
import { docsAtCursor, workspaceExtensions, type WorkspaceExtensionOptions } from '../tjp/cm';
import { KEYWORDS } from '../tjp/syntax/keywords';
import type { EditorSupport } from '../workspace/workspace';
import { editorSetup } from './editor-setup';
import type { HistoryCommands } from './history-keys';

export { EditorController } from './editor-controller';
export { docsAtCursor };

export interface EditorSupportOptions extends Omit<WorkspaceExtensionOptions, 'docs'> {
	/** The engine's keyword docs once it has booted; null before. */
	engineDocs: () => SyntaxDocs | null;
	/** The workspace history that Mod-Z and the browser's undo inputs call (history-keys.ts). */
	history: HistoryCommands;
}

/** What `Workspace.attachEditor` needs: the TJP extensions and the editor setup (with the undo keys). */
export function editorSupport(opts: EditorSupportOptions): EditorSupport {
	const { engineDocs, history, ...rest } = opts;
	const tjp = workspaceExtensions({
		...rest,
		docs: () => ({ table: KEYWORDS, engine: engineDocs() }),
	});
	return { extensions: (path, top) => [tjp(path, top), editorSetup(path, history)] };
}
