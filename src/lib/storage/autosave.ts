// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Autosave (phase-4.md 7.1): every change to the open plan's workspace is stored, 400 ms after the
 * last one, in an idle task, and at once when the page is hidden or goes away (`visibilitychange`,
 * `pagehide`). It never blocks typing: nothing here runs inside a change, which only notes the file.
 *
 * - **A complete version, never a mix.** Saves run one after another. Each takes, when it starts,
 *   every file changed since the last save that succeeded, at the workspace version then, and hands
 *   them to `save` in one call (the local store writes them in one transaction). So what is stored
 *   is always the text of one whole version: a failed save stores nothing, and its files stay
 *   noted for the next one.
 * - **Ordered by version.** Versions only grow from one save to the next (store-types.ts
 *   `saveFiles` drops a lower one anyway).
 * - **Failures** are reported (`onState`), never swallowed (8.1 #8); the next change or flush tries
 *   again with the files still noted.
 * - `flush()` saves what is noted now and resolves once the store has it (the owner lock's
 *   handover waits for it); it never rejects.
 */
import type { StorageError, WorkspacePath } from './types';
import { isStorageFailure, storageError } from './types';
import type { Workspace, WorkspaceSnapshot } from '../workspace/workspace';

/** How long after the last change a save starts (7.1). */
export const AUTOSAVE_MS = 400;
/**
 * At most this long in addition for an idle moment: a change is stored within a second (12.2,
 * T4 review L2), however busy the page is.
 */
export const IDLE_MS = 600;

export type AutosaveState =
	| { readonly kind: 'saved'; readonly at: number; readonly version: number }
	| { readonly kind: 'failed'; readonly error: StorageError };

export interface AutosaveOptions {
	readonly workspace: Workspace;
	/** Stores the whole text of each file in `files`, which is `snap` at `snap.version`. */
	readonly save: (
		files: ReadonlyMap<WorkspacePath, string>,
		snap: WorkspaceSnapshot,
	) => Promise<void>;
	readonly onState?: (s: AutosaveState) => void;
	/** Every file is noted from the start (a plan not stored yet: its first save is all of it). */
	readonly all?: boolean;
	/** Where `visibilitychange` and `pagehide` come from; default the page's, null for none. */
	readonly page?: { readonly doc: PageDoc; readonly win: EventTarget } | null;
	readonly delay?: number;
	readonly now?: () => number;
}

type PageDoc = EventTarget & { readonly visibilityState: DocumentVisibilityState };

export interface Autosave {
	/** Changes not stored yet: noted files, or a save in flight. */
	readonly pending: boolean;
	flush(): Promise<void>;
	dispose(): void;
}

export function createAutosave(o: AutosaveOptions): Autosave {
	const ws = o.workspace;
	const noted = new Set<WorkspacePath>();
	const page =
		o.page !== undefined
			? o.page
			: globalThis.document
				? { doc: globalThis.document, win: globalThis.window }
				: null;
	let chain: Promise<void> = Promise.resolve();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let off = false;
	let saving = false;

	const step = async (): Promise<void> => {
		if (off || noted.size === 0) return;
		const snap = ws.snapshot();
		const files = new Map<WorkspacePath, string>();
		for (const p of noted) {
			const f = snap.files.get(p);
			if (f) files.set(p, f.text.toString());
		}
		noted.clear();
		saving = true;
		try {
			await o.save(files, snap);
			o.onState?.({ kind: 'saved', at: (o.now ?? Date.now)(), version: snap.version });
		} catch (e) {
			for (const p of files.keys()) noted.add(p);
			o.onState?.({
				kind: 'failed',
				error: isStorageFailure(e) ? e.error : storageError('server', 'autosave'),
			});
		} finally {
			saving = false;
		}
	};
	const flush = (): Promise<void> => {
		clearTimeout(timer);
		return (chain = chain.then(step));
	};
	const idle = (): void => {
		const ric = globalThis.requestIdleCallback;
		if (ric) ric(() => void flush(), { timeout: IDLE_MS });
		else void flush();
	};
	const hidden = (e: Event): void => {
		if (e.type === 'pagehide' || page?.doc.visibilityState === 'hidden') void flush();
	};
	const unsubscribe = ws.subscribe((_s, _origin, info) => {
		for (const p of info.paths) noted.add(p);
		clearTimeout(timer);
		timer = setTimeout(idle, o.delay ?? AUTOSAVE_MS);
	});
	if (o.all) {
		for (const p of ws.snapshot().files.keys()) noted.add(p);
		timer = setTimeout(idle, o.delay ?? AUTOSAVE_MS);
	}
	page?.doc.addEventListener('visibilitychange', hidden);
	page?.win.addEventListener('pagehide', hidden);

	return {
		get pending() {
			return saving || noted.size > 0;
		},
		flush,
		dispose() {
			off = true;
			clearTimeout(timer);
			unsubscribe();
			page?.doc.removeEventListener('visibilitychange', hidden);
			page?.win.removeEventListener('pagehide', hidden);
		},
	};
}
