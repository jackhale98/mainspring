// SPDX-License-Identifier: GPL-2.0-or-later
// External changes to a folder plan (folder-changes.ts, phase-4.md 7.2, 19.14) on the in-memory
// File System Access fake: the same folder, a touch that changes no text, files changed, added and
// deleted on disk (a kept file is not missing), a folder that is gone, and the focus watcher.
import { describe, expect, it, vi } from 'vitest';
import { decodeSnapshot } from './codec';
import { createFolderProvider } from './folder';
import { folderChange, onReturn } from './folder-changes';
import { FakeFs, memoryHandles } from './testing/fake-fsa';
import type { FolderLocation } from './types';

const enc = new TextEncoder();
const INVALID = Uint8Array.of(...enc.encode('# caf'), 0xe9, ...enc.encode('\nresource r "R"\n'));

/** A folder with a three-file plan in nested folders. */
function setup(fs = new FakeFs()) {
	fs.put('plan.tjp', 'project p "P" 2026-01-05 +1m\r\n');
	fs.put('parts/people.tji', INVALID);
	fs.put('parts/deep/tasks.tji', 'task t "T"\n');
	const handles = memoryHandles();
	handles.map.set('h1', fs.root);
	const loc: FolderLocation = { kind: 'folder', handle: 'h1', name: 'plans' };
	const p = createFolderProvider({ handles });
	return { fs, loc, p };
}

describe('external changes (7.2, 19.14)', () => {
	async function based() {
		const t = setup();
		const snap = await t.p.read(t.loc);
		return { ...t, base: { ...decodeSnapshot(snap), kept: new Set<string>() } };
	}

	it('is the same while nothing changed, and only touched when the text is the same', async () => {
		const { fs, loc, p, base } = await based();
		expect(await folderChange(p, loc, base)).toEqual({ kind: 'same' });
		fs.touch('plan.tjp', fs.time + 1000);
		fs.put('parts/deep/tasks.tji', 'task t "T"\n');
		const c = await folderChange(p, loc, base);
		expect(c).toEqual({ kind: 'touched', revision: await p.head(loc) });
	});

	it('names the files changed, added or deleted on disk, and not a kept file', async () => {
		const { fs, loc, p, base } = await based();
		fs.put('parts/deep/tasks.tji', 'task t "Changed"\n');
		fs.put('more.tji', '');
		fs.remove('plan.tjp');
		const c = await folderChange(p, loc, {
			...base,
			files: new Map([...base.files, ['old.tji', '']]),
			kept: new Set(['old.tji']),
		});
		expect(c.kind).toBe('changed');
		if (c.kind !== 'changed') return;
		expect(c.paths).toEqual(['more.tji', 'parts/deep/tasks.tji', 'plan.tjp']);
		expect(c.theirs.files.get('parts/deep/tasks.tji')).toBe('task t "Changed"\n');
		expect(c.theirs.revision).toBe(await p.head(loc));
		expect([...c.theirs.lossy]).toEqual(['parts/people.tji']);
	});

	it('says when the folder is gone', async () => {
		const fs = new FakeFs();
		fs.put('in/plan.tjp', 'x');
		const handles = memoryHandles();
		handles.map.set('h', fs.dir('in'));
		const p = createFolderProvider({ handles });
		const loc: FolderLocation = { kind: 'folder', handle: 'h', name: 'in' };
		const base = decodeSnapshot(await p.read(loc));
		fs.remove('in');
		expect(await folderChange(p, loc, base)).toEqual({ kind: 'gone' });
	});

	it('looks again on focus and when the page is shown, one look at a time', async () => {
		const win = new EventTarget();
		const doc = Object.assign(new EventTarget(), {
			visibilityState: 'visible' as DocumentVisibilityState,
		});
		let done: () => void = () => undefined;
		const check = vi.fn(() => new Promise<void>((r) => (done = r)));
		const off = onReturn(check, { win, doc });
		win.dispatchEvent(new Event('focus'));
		doc.dispatchEvent(new Event('visibilitychange'));
		expect(check).toHaveBeenCalledTimes(1);
		done();
		await new Promise((r) => setTimeout(r, 0));
		doc.visibilityState = 'hidden';
		doc.dispatchEvent(new Event('visibilitychange'));
		expect(check).toHaveBeenCalledTimes(1);
		doc.visibilityState = 'visible';
		doc.dispatchEvent(new Event('visibilitychange'));
		expect(check).toHaveBeenCalledTimes(2);
		done();
		await new Promise((r) => setTimeout(r, 0));
		off();
		win.dispatchEvent(new Event('focus'));
		expect(check).toHaveBeenCalledTimes(2);
	});
});
