// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the folder and files specs share (phase-4.md 13.2, 13.4): the storage fixtures read from disk,
 * the folder picker's stand-in, folders of the origin-private file system filled and read from the
 * test, the share sheet's stand-in, and the chooser's file entries.
 *
 * - **The picker** (Chromium only, where `showDirectoryPicker` exists): an init script replaces it
 *   with one that returns a folder of `navigator.storage.getDirectory()`, a real handle, named by
 *   `sessionStorage['picker-folder']`. Real pickers cannot be driven. The permission methods are
 *   stubbed on `FileSystemHandle.prototype` (not on an object: WebKit can drop a property set on a
 *   host object, 8cffc0ea): `queryPermission` answers `sessionStorage['folder-permission']`
 *   (default granted), `requestPermission` grants.
 * - **Without the API**: an init script takes `showDirectoryPicker` away on Chromium, so the
 *   fallback branch runs there as it does on the iPhone, where the browser has none.
 * - **The share sheet** (a finger's export): stubbed on `Navigator.prototype`; what was shared is
 *   kept in the page (`sharedFile`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { strings } from '../../../src/lib/strings';

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/storage');

/** Every file of a storage fixture folder, by path (bytes as on disk). */
export function fixture(name: string): Record<string, Buffer> {
	const out: Record<string, Buffer> = {};
	const walk = (rel: string): void => {
		for (const e of fs.readdirSync(path.join(FIXTURES, name, rel), { withFileTypes: true })) {
			const p = rel === '' ? e.name : `${rel}/${e.name}`;
			if (e.isDirectory()) walk(p);
			else out[p] = fs.readFileSync(path.join(FIXTURES, name, p));
		}
	};
	walk('');
	return out;
}

/** A fixture's file paths on disk, for `setInputFiles`. */
export const fixturePath = (...parts: string[]): string => path.join(FIXTURES, ...parts);

export const chooser = (page: Page): Locator => page.getByLabel(strings.topBar.sample);

/** Chooses one of the chooser's file entries (strings.planFiles). */
export async function chooseEntry(
	page: Page,
	entry: keyof typeof strings.planFiles,
): Promise<void> {
	await chooser(page).selectOption({ label: strings.planFiles[entry] });
}

/** Installs the picker's stand-in and the permission stubs (module comment). Before `goto`. */
export async function withPicker(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const w = window as unknown as { showDirectoryPicker?: unknown };
		if (typeof w.showDirectoryPicker !== 'function') return;
		w.showDirectoryPicker = async () => {
			const root = await navigator.storage.getDirectory();
			return root.getDirectoryHandle(sessionStorage.getItem('picker-folder') ?? 'picked', {
				create: true,
			});
		};
		const proto = FileSystemHandle.prototype as unknown as Record<string, unknown>;
		proto['queryPermission'] = async () =>
			(sessionStorage.getItem('folder-permission') ?? 'granted') as PermissionState;
		proto['requestPermission'] = async () => {
			sessionStorage.setItem('folder-permission', 'granted');
			return 'granted' as PermissionState;
		};
	});
}

/** Takes the folder API away (module comment). Before `goto`. */
export async function withoutFolderApi(page: Page): Promise<void> {
	await page.addInitScript(() => {
		for (const o of [window, Object.getPrototypeOf(window)] as Record<string, unknown>[]) {
			try {
				delete o['showDirectoryPicker'];
			} catch {
				// Not configurable: the check below fails the test.
			}
		}
	});
}

/** Whether the page has the File System Access API's folder picker. */
export const hasFolderApi = (page: Page): Promise<boolean> =>
	page.evaluate(
		() => typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function',
	);

/** Which folder the next pick gives. */
export async function pickNext(page: Page, folder: string): Promise<void> {
	await page.evaluate((f) => sessionStorage.setItem('picker-folder', f), folder);
}

/** Fills an origin-private folder with files (paths with folders), replacing what was there. */
export async function seedFolder(
	page: Page,
	folder: string,
	files: Record<string, Uint8Array | string>,
): Promise<void> {
	const data = Object.fromEntries(
		Object.entries(files).map(([p, b]) => [
			p,
			[...(typeof b === 'string' ? new TextEncoder().encode(b) : b)],
		]),
	);
	await page.evaluate(
		async ({ folder, data }) => {
			const root = await navigator.storage.getDirectory();
			await root.removeEntry(folder, { recursive: true }).catch(() => undefined);
			const top = await root.getDirectoryHandle(folder, { create: true });
			for (const [p, bytes] of Object.entries(data)) {
				const parts = p.split('/');
				const name = parts.pop() ?? p;
				let dir = top;
				for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
				const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
				await w.write(new Uint8Array(bytes));
				await w.close();
			}
		},
		{ folder, data },
	);
}

export interface OnDisk {
	readonly bytes: number[];
	readonly lastModified: number;
}

/** Every file of an origin-private folder, by path, with its bytes and `lastModified`. */
export function readFolder(page: Page, folder: string): Promise<Record<string, OnDisk>> {
	return page.evaluate(async (folder) => {
		const out: Record<string, { bytes: number[]; lastModified: number }> = {};
		const root = await navigator.storage.getDirectory();
		const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
			for await (const h of (
				dir as unknown as { values(): AsyncIterable<FileSystemHandle> }
			).values()) {
				if (h.kind === 'directory')
					await walk(h as FileSystemDirectoryHandle, `${prefix}${h.name}/`);
				else {
					const f = await (h as FileSystemFileHandle).getFile();
					out[prefix + h.name] = {
						bytes: [...new Uint8Array(await f.arrayBuffer())],
						lastModified: f.lastModified,
					};
				}
			}
		};
		await walk(await root.getDirectoryHandle(folder, { create: true }), '');
		return out;
	}, folder);
}

/** The bytes of each file, without the times. */
export const bytesOf = (files: Record<string, OnDisk>): Record<string, number[]> =>
	Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.bytes]));

/** A finger's share sheet that takes every file and keeps the last (module comment). Before `goto`. */
export async function withShareStub(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const proto = Navigator.prototype as unknown as Record<string, unknown>;
		proto['canShare'] = () => true;
		proto['share'] = async (data: ShareData) => {
			const f = data.files?.[0];
			if (!f) return;
			(window as unknown as { __shared?: unknown }).__shared = {
				name: f.name,
				bytes: [...new Uint8Array(await f.arrayBuffer())],
			};
		};
	});
}

/** What the share sheet's stand-in was last given, once it has something. */
export async function sharedFile(page: Page): Promise<{ name: string; bytes: number[] }> {
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { __shared?: unknown }).__shared ?? null))
		.not.toBeNull();
	return page.evaluate(
		() => (window as unknown as { __shared: { name: string; bytes: number[] } }).__shared,
	);
}
