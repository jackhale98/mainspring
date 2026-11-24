// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The end-to-end hook for files and folders (files-hook.ts): it calls the app's own methods, hands
// the inputs' files to `openFiles`, and leaves nothing behind once uninstalled.
import { describe, expect, it, vi } from 'vitest';
import { FILES_HOOK_KEY, installFilesHook, type FilesHook } from './files-hook';

function fakeApp() {
	return {
		openFolder: vi.fn(async () => true),
		openFiles: vi.fn(async (_f: readonly File[]) => true),
		pickFolder: vi.fn(async () => ({ kind: 'folder', handle: 'h', name: 'dest' }) as const),
		saveTo: vi.fn(async () => ({ kind: 'cancelled' }) as const),
		exportPlan: vi.fn(async () => undefined),
		planLocation: { kind: 'browser' } as const,
	};
}

const hook = (): FilesHook =>
	(window as unknown as Record<string, FilesHook>)[FILES_HOOK_KEY] as FilesHook;

describe('files hook', () => {
	it('calls the app’s own methods', async () => {
		const app = fakeApp();
		const off = installFilesHook(app);
		expect(await hook().openFolder()).toBe(true);
		expect(await hook().saveToFolder()).toEqual({ kind: 'cancelled' });
		expect(app.saveTo).toHaveBeenCalledWith({ kind: 'folder', handle: 'h', name: 'dest' });
		await hook().exportPlan();
		expect(app.exportPlan).toHaveBeenCalled();
		expect(hook().location()).toEqual({ kind: 'browser' });
		app.pickFolder.mockResolvedValueOnce(null as never);
		expect(await hook().saveToFolder()).toBeNull();
		off();
	});

	it('gives the files of its inputs to openFiles, and removes everything when uninstalled', () => {
		const app = fakeApp();
		const off = installFilesHook(app);
		const input = document.querySelector<HTMLInputElement>('[data-testid="hook-open-files"]');
		const folder = document.querySelector<HTMLInputElement>('[data-testid="hook-import-folder"]');
		expect(input?.multiple).toBe(true);
		expect(folder?.webkitdirectory).toBe(true);
		const file = new File(['x'], 'plan.tjp');
		Object.defineProperty(input, 'files', { value: [file], configurable: true });
		input?.dispatchEvent(new Event('change'));
		expect(app.openFiles).toHaveBeenCalledWith([file]);
		off();
		expect(document.querySelector('[data-testid^="hook-"]')).toBeNull();
		expect(FILES_HOOK_KEY in window).toBe(false);
	});
});
