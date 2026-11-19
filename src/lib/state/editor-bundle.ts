// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Everything in the app that needs the editor packages (@codemirror/view, language, commands,
 * autocomplete, lint, search), behind one module. Nothing else in the main chunk imports them,
 * so the bundler makes this module and its dependencies a separate chunk that
 * `AppState.ensureEditor` loads with `import()` when an editor first mounts (phase-2.md 11.3).
 * A Visual-first load never fetches it. `@codemirror/state`, Lezer and the edit API stay in
 * the main chunk because Visual mode needs them.
 *
 * The keyword docs loader (engine/docs-asset.ts, ADR-0017) is here too, so it is part of this
 * chunk: only an editor needs the full docs, and a Visual-only session never fetches them.
 */
import { createEngineDocsLoader, type EngineDocsLoader } from '../../engine/docs-asset';
import { engineDirUrl } from '../../engine/engine-url';
import {
	docsAtCursor,
	docsAtCursorWithin,
	workspaceExtensions,
	type WorkspaceExtensionOptions,
} from '../tjp/cm';
import type { KeywordDocsSource } from '../tjp/syntax/docs';
import { KEYWORDS } from '../tjp/syntax/keywords';
import type { EditorSupport } from '../workspace/workspace';
import { editorSetup } from './editor-setup';
import type { HistoryCommands } from './history-keys';

export { EditorController } from './editor-controller';
export { docsAtCursor, docsAtCursorWithin };
export type { EngineDocsLoader };

/**
 * The loader of the engine's keyword docs asset, next to the engine's manifest (`<base>engine/`,
 * engine-url.ts), with the global `fetch`. It fetches nothing until `load()`.
 */
export function engineDocsLoader(): EngineDocsLoader {
	const dir = engineDirUrl(import.meta.env.BASE_URL, location.href);
	return createEngineDocsLoader({ manifestUrl: new URL('manifest.json', dir) });
}

/**
 * What hover, completion and the docs sheet read: the committed table, the engine's docs once the
 * loader has them, and whether it is still fetching them.
 */
export function docsSource(loader: EngineDocsLoader): KeywordDocsSource {
	const s = loader.state;
	return {
		table: KEYWORDS,
		engine: s.status === 'loaded' ? s.docs : null,
		loading: s.status === 'loading',
	};
}

export interface EditorSupportOptions extends Omit<WorkspaceExtensionOptions, 'docs' | 'loadDocs'> {
	/**
	 * The keyword docs (ADR-0017); `AppState.ensureEditor` starts its `load()`. The editor reads
	 * them through its env (`docs`, `loadDocs`): hover, completion info and the docs command wait
	 * for `load()` briefly before they show the table's summary (tjp/cm/docs-wait.ts).
	 */
	docs: EngineDocsLoader;
	/** The workspace history that Mod-Z and the browser's undo inputs call (history-keys.ts). */
	history: HistoryCommands;
}

/** What `Workspace.attachEditor` needs: the TJP extensions and the editor setup (with the undo keys). */
export function editorSupport(opts: EditorSupportOptions): EditorSupport {
	const { docs, history, ...rest } = opts;
	const tjp = workspaceExtensions({
		...rest,
		docs: () => docsSource(docs),
		loadDocs: () => docs.load(),
	});
	return { extensions: (path, top) => [tjp(path, top), editorSetup(path, history)] };
}
