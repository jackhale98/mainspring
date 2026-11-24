// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the person can do about a plan this tab cannot keep or write (phase-4.md 7.1, T4 re-check
 * N1), shared by the notice under the top bar (PlanNotice.svelte) and the Sync panel (T14), so the
 * two do the same thing.
 */
import type { AppState } from './app.svelte';

/** What "Copy the text" copied the text of (or failed to), for the button to say. */
export interface Copied {
	readonly path: string;
	readonly ok: boolean;
}

/** The open file's text to the clipboard: what this tab could not keep (export is T5's). */
export async function copyOpenText(
	app: Pick<AppState, 'activeFile' | 'workspace'>,
): Promise<Copied> {
	const path = app.activeFile;
	const text = app.workspace?.texts()[path] ?? '';
	try {
		await navigator.clipboard.writeText(text);
		return { path, ok: true };
	} catch {
		return { path, ok: false };
	}
}

/**
 * "Open here instead": takes the open plan from the tab that has it (`steal`); `AppState` asks first
 * when this tab holds changes it could not keep. False when no plan is stored or the open failed.
 */
export function openHere(app: Pick<AppState, 'storedId' | 'openStored'>): Promise<boolean> {
	return app.storedId === null
		? Promise.resolve(false)
		: app.openStored(app.storedId, { steal: true });
}
