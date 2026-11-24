// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A hook for end-to-end tests (T5): `/app?hooks=files` installs `window.__mainspringFiles`, which
 * calls the app's own open, Save to… and export methods (state/app-storage.ts) as T15's controls
 * will, and adds two file inputs for `setInputFiles` (`hook-open-files`, and `hook-import-folder`
 * with `webkitdirectory`), whose files go to `openFiles`. The app has no controls of its own for
 * these until T15, so the specs drive them here; it does nothing a person could not do with those
 * controls. Without the parameter nothing is installed, and this module is never fetched.
 */
import type { SyncOutcome } from '../sync/types';
import type { Location } from '../storage/types';
import type { AppState } from './app.svelte';

export const FILES_HOOK_KEY = '__mainspringFiles';

export interface FilesHook {
	openFolder(): Promise<boolean>;
	/** Picks a folder, then Save to… it; null when the picker was closed. */
	saveToFolder(): Promise<SyncOutcome | null>;
	exportPlan(): Promise<void>;
	location(): Location;
}

type HookApp = Pick<
	AppState,
	'openFolder' | 'openFiles' | 'pickFolder' | 'saveTo' | 'exportPlan'
> & {
	readonly planLocation: Location;
};

/** Installs the hook in `doc`'s window; returns the uninstall. */
export function installFilesHook(app: HookApp, doc: Document = document): () => void {
	const input = (testId: string, folder: boolean): HTMLInputElement => {
		const i = doc.createElement('input');
		i.type = 'file';
		i.multiple = true;
		if (folder) i.webkitdirectory = true;
		i.hidden = true;
		i.dataset['testid'] = testId;
		i.addEventListener('change', () => {
			const files = [...(i.files ?? [])];
			i.value = '';
			if (files.length > 0) void app.openFiles(files);
		});
		doc.body.append(i);
		return i;
	};
	const inputs = [input('hook-open-files', false), input('hook-import-folder', true)];
	const hook: FilesHook = {
		openFolder: () => app.openFolder(),
		saveToFolder: async () => {
			const loc = await app.pickFolder();
			return loc && app.saveTo(loc);
		},
		exportPlan: () => app.exportPlan(),
		location: () => app.planLocation,
	};
	const win = doc.defaultView as (Window & { [FILES_HOOK_KEY]?: FilesHook }) | null;
	if (win) win[FILES_HOOK_KEY] = hook;
	return () => {
		for (const i of inputs) i.remove();
		if (win && win[FILES_HOOK_KEY] === hook) delete win[FILES_HOOK_KEY];
	};
}
