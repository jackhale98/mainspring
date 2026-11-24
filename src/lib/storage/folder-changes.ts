// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * External changes to a folder plan (phase-4.md 7.2, 19.14): on focus and when the page is shown
 * again, never by polling (`onReturn`), the folder is compared with the plan's base (`folderChange`):
 * its revision first (the stamps, folder.ts), then, when that moved, the text, so a file only
 * touched (saved with no change) is `touched`, which moves the base's revision and asks nothing.
 * The sync controller (T7) applies a change or merges it (sync/types.ts, "Applying remote text").
 * Lazy, with folder.ts.
 */
import { decodeSnapshot } from './codec';
import type { DecodedFiles } from './store-types';
import type { FolderLocation, StorageProvider, WorkspacePath } from './types';

/** What a look at the folder found, against the base it was last read or written as (7.2). */
export type FolderChange =
	/** Its revision is the base's. */
	| { readonly kind: 'same' }
	/** The folder is gone (its handle no longer lists). */
	| { readonly kind: 'gone' }
	/** Stamps moved but every plan file's text is the base's (19.14): only the revision moves. */
	| { readonly kind: 'touched'; readonly revision: string }
	/** Text changed on disk: `paths` were changed, added or deleted there; `theirs` is the folder now. */
	| {
			readonly kind: 'changed';
			readonly theirs: DecodedFiles & { readonly author: null; readonly at: number | null };
			readonly paths: readonly WorkspacePath[];
	  };

/**
 * Compares the folder with `base` (`SyncBase`: its `kept` files are not missing): the revision
 * first, then, when it moved, the text (module comment). Rejects as `head` and `read` do.
 */
export async function folderChange(
	p: Pick<StorageProvider<FolderLocation>, 'head' | 'read'>,
	loc: FolderLocation,
	base: DecodedFiles & { readonly kept?: ReadonlySet<WorkspacePath> },
	signal?: AbortSignal,
): Promise<FolderChange> {
	const head = await p.head(loc, signal);
	if (head === null) return { kind: 'gone' };
	if (head === base.revision) return { kind: 'same' };
	const snap = await p.read(loc, signal);
	const theirs = decodeSnapshot(snap);
	const paths: WorkspacePath[] = [];
	for (const [path, text] of theirs.files) if (base.files.get(path) !== text) paths.push(path);
	for (const path of base.files.keys()) {
		if (!theirs.files.has(path) && !base.kept?.has(path)) paths.push(path);
	}
	if (paths.length === 0) return { kind: 'touched', revision: snap.revision };
	return { kind: 'changed', theirs: { ...theirs, author: null, at: snap.at }, paths: paths.sort() };
}

type ReturnPage = {
	readonly win: EventTarget;
	readonly doc: EventTarget & { readonly visibilityState: DocumentVisibilityState };
};

/**
 * Calls `check` when the window gets the focus and when the page is shown again, never by polling
 * (7.2); not again while one is running. Returns the function that stops it.
 */
export function onReturn(
	check: () => Promise<unknown>,
	page: ReturnPage = { win: globalThis.window, doc: globalThis.document },
): () => void {
	let running: Promise<unknown> | null = null;
	const run = (): void => {
		running ??= check()
			.catch(() => undefined)
			.finally(() => (running = null));
	};
	const shown = (): void => {
		if (page.doc.visibilityState === 'visible') run();
	};
	page.win.addEventListener('focus', run);
	page.doc.addEventListener('visibilitychange', shown);
	return () => {
		page.win.removeEventListener('focus', run);
		page.doc.removeEventListener('visibilitychange', shown);
	};
}
