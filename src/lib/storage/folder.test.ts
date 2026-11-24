// SPDX-License-Identifier: GPL-2.0-or-later
// The folder provider (phase-4.md 7.2, 7.4, 13.1) on the in-memory File System Access fake:
// what it reads, the revision, the write and its `moved` refusal, limits, access and the picker
// (the handles store and external changes: folder-handles.test.ts, folder-changes.test.ts).
import { describe, expect, it, vi } from 'vitest';
import {
	createFolderProvider,
	folderError,
	folderSupported,
	revisionPaths,
	type FsDirHandle,
} from './folder';
import { decodeSnapshot } from './codec';
import { FakeFs, memoryHandles } from './testing/fake-fsa';
import { PLAN_LIMITS, StorageFailure, type FolderLocation } from './types';

const enc = new TextEncoder();
const BOM_CRLF = Uint8Array.of(0xef, 0xbb, 0xbf, ...enc.encode('project p "P" 2026-01-05 +1m\r\n'));
const INVALID = Uint8Array.of(...enc.encode('# caf'), 0xe9, ...enc.encode('\nresource r "R"\n'));

/** A folder with a three-file plan in nested folders, and files that are not plan files. */
function setup(fs = new FakeFs()) {
	fs.put('plan.tjp', BOM_CRLF);
	fs.put('parts/people.tji', INVALID);
	fs.put('parts/deep/tasks.tji', 'task t "T"\n');
	fs.put('notes.txt', 'not a plan file');
	fs.put('.git/objects/plan.tjp', 'git internals');
	const handles = memoryHandles();
	handles.map.set('h1', fs.root);
	const loc: FolderLocation = { kind: 'folder', handle: 'h1', name: 'plans' };
	const p = createFolderProvider({ handles, pick: async () => fs.root });
	return { fs, handles, loc, p };
}

const bytes = (fs: FakeFs, path: string): number[] => [...(fs.bytes(path) ?? [])];
const text = (s: string): Uint8Array => enc.encode(s);

async function rejection(p: Promise<unknown>): Promise<StorageFailure> {
	const e = await p.then(
		() => null,
		(x: unknown) => x,
	);
	expect(e).toBeInstanceOf(StorageFailure);
	return e as StorageFailure;
}

describe('read and head', () => {
	it('reads every plan file under the folder as stored, and nothing else', async () => {
		const { fs, loc, p } = setup();
		const snap = await p.read(loc);
		expect([...snap.files.keys()]).toEqual([
			'parts/deep/tasks.tji',
			'parts/people.tji',
			'plan.tjp',
		]);
		expect([...snap.files.get('plan.tjp')!]).toEqual([...BOM_CRLF]);
		expect([...snap.files.get('parts/people.tji')!]).toEqual([...INVALID]);
		expect(snap.author).toBeNull();
		expect(snap.at).toBe(
			Math.max(
				...['plan.tjp', 'parts/people.tji', 'parts/deep/tasks.tji'].map(
					(f) => fs.stamp(f).lastModified,
				),
			),
		);
		// The revision is what head says while nothing changes, and it names the plan files.
		expect(await p.head(loc)).toBe(snap.revision);
		expect([...(revisionPaths(snap.revision) ?? [])].sort()).toEqual([...snap.files.keys()]);
		// The codec says which file had bytes that are not UTF-8.
		expect([...decodeSnapshot(snap).lossy]).toEqual(['parts/people.tji']);
	});

	it('gives a new revision when a file is touched (a later time), changed, added or deleted', async () => {
		const { fs, loc, p } = setup(new FakeFs('plans', { step: 1000 }));
		const seen = new Set([await p.head(loc)]);
		fs.touch('plan.tjp');
		seen.add(await p.head(loc));
		fs.put('parts/people.tji', 'resource r "R"\n');
		seen.add(await p.head(loc));
		fs.put('extra.tji', '');
		seen.add(await p.head(loc));
		fs.remove('parts/deep');
		seen.add(await p.head(loc));
		// A file that is not a plan file changes nothing.
		const before = await p.head(loc);
		fs.put('notes.txt', 'changed');
		expect(await p.head(loc)).toBe(before);
		expect(seen.size).toBe(5);
	});

	it('says the folder is gone: head null, read not-found', async () => {
		const fs = new FakeFs();
		fs.put('sub/plan.tjp', 'x');
		const handles = memoryHandles();
		handles.map.set('h', fs.dir('sub'));
		const loc: FolderLocation = { kind: 'folder', handle: 'h', name: 'sub' };
		const p = createFolderProvider({ handles });
		fs.remove('sub');
		expect(await p.head(loc)).toBeNull();
		expect((await rejection(p.read(loc))).error.kind).toBe('not-found');
		// A location whose handle is not stored is gone too.
		expect(await p.head({ ...loc, handle: 'other' })).toBeNull();
	});

	it('reads a file again when it changed while it was read', async () => {
		const { fs, loc, p } = setup();
		const original = fs.bytes('plan.tjp');
		// The first read of a file's bytes finds it changed (NotReadableError), as Chromium does.
		fs.failNext('read', 'NotReadableError');
		const snap = await p.read(loc);
		expect([...snap.files.get('plan.tjp')!]).toEqual([...original!]);
		expect(snap.revision).toBe(await p.head(loc));
	});

	it('refuses a plan past the limits before it reads any content', async () => {
		const many = new FakeFs();
		for (let i = 0; i <= PLAN_LIMITS.files; i++) many.put(`f${i}.tji`, '');
		const handles = memoryHandles();
		handles.map.set('h', many.root);
		const loc: FolderLocation = { kind: 'folder', handle: 'h', name: 'x' };
		const p = createFolderProvider({ handles });
		const e = await rejection(p.read(loc));
		expect(e.error.kind).toBe('too-large');
		expect(e.error.detail).toBe('folder: files');

		const big = new FakeFs();
		big.put('plan.tjp', new Uint8Array(PLAN_LIMITS.fileBytes + 1));
		big.put('a.tji', 'x');
		handles.map.set('h', big.root);
		const ops = vi.spyOn(big, 'fault');
		expect((await rejection(p.read(loc))).error.detail).toBe('folder: file');
		// No content was read (the sizes come from the file snapshots).
		expect(ops.mock.calls.filter(([op]) => op === 'read')).toEqual([]);

		const total = new FakeFs();
		const share = Math.floor(PLAN_LIMITS.totalBytes / 5) + 1;
		for (let i = 0; i < 5; i++) total.put(`f${i}.tji`, new Uint8Array(share));
		handles.map.set('h', total.root);
		expect((await rejection(p.read(loc))).error.detail).toBe('folder: total');
	});

	it('refuses a walk past the most entries it visits', async () => {
		const fs = new FakeFs();
		for (let i = 0; i < 12; i++) fs.put(`d/${i}.txt`, '');
		const handles = memoryHandles();
		handles.map.set('h', fs.root);
		const p = createFolderProvider({ handles, maxEntries: 10 });
		const loc: FolderLocation = { kind: 'folder', handle: 'h', name: 'x' };
		expect((await rejection(p.read(loc))).error).toMatchObject({ kind: 'too-large' });
		await expect(p.head(loc)).rejects.toBeInstanceOf(StorageFailure);
	});

	it('rejects with the reason once aborted', async () => {
		const { loc, p } = setup();
		const c = new AbortController();
		const why = new Error('stop');
		c.abort(why);
		await expect(p.read(loc, c.signal)).rejects.toBe(why);
		await expect(p.head(loc, c.signal)).rejects.toBe(why);
		await expect(
			p.write(loc, { base: '', files: new Map(), message: null }, c.signal),
		).rejects.toBe(why);
	});

	it('maps permission and other errors to their kinds', async () => {
		const { fs, loc, p } = setup();
		fs.failNext('values', 'NotAllowedError');
		expect((await rejection(p.read(loc))).error).toEqual({
			kind: 'permission',
			retryAfterMs: null,
			detail: 'folder: NotAllowedError',
		});
		expect(folderError(new DOMException('x', 'QuotaExceededError')).kind).toBe('quota');
		expect(folderError(new TypeError('x')).kind).toBe('server');
		expect(folderError(new DOMException('x', 'SecurityError')).kind).toBe('permission');
	});
});

describe('write', () => {
	it('writes only the files given, creates new folders, and deletes nothing', async () => {
		const { fs, loc, p } = setup();
		const snap = await p.read(loc);
		const untouched = fs.stamp('parts/people.tji');
		const r = await p.write(loc, {
			base: snap.revision,
			files: new Map([
				['plan.tjp', text('﻿project p "P" 2026-01-05 +2m\r\n')],
				['new/sub/added.tji', text('task a "A"\n')],
			]),
			message: null,
		});
		expect(r.status).toBe('written');
		expect(bytes(fs, 'plan.tjp')).toEqual([...text('﻿project p "P" 2026-01-05 +2m\r\n')]);
		expect(bytes(fs, 'new/sub/added.tji')).toEqual([...text('task a "A"\n')]);
		// The lossy file was not named, so its bytes and stamp are as they were.
		expect(bytes(fs, 'parts/people.tji')).toEqual([...INVALID]);
		expect(fs.stamp('parts/people.tji')).toEqual(untouched);
		expect(fs.paths()).toEqual([
			'.git/objects/plan.tjp',
			'new/sub/added.tji',
			'notes.txt',
			'parts/deep/tasks.tji',
			'parts/people.tji',
			'plan.tjp',
		]);
		expect(fs.closes).toBe(2);
		// The revision written is the folder's now: no change shows, and the next write follows it.
		if (r.status !== 'written') return;
		expect(await p.head(loc)).toBe(r.revision);
		const again = await p.write(loc, {
			base: r.revision,
			files: new Map([['parts/deep/tasks.tji', text('task t "T2"\n')]]),
			message: null,
		});
		expect(again.status).toBe('written');
	});

	it('an empty write writes nothing and keeps the revision', async () => {
		const { fs, loc, p } = setup();
		const snap = await p.read(loc);
		expect(await p.write(loc, { base: snap.revision, files: new Map(), message: null })).toEqual({
			status: 'written',
			revision: snap.revision,
		});
		expect(fs.closes).toBe(0);
	});

	it.each([
		['changed', (fs: FakeFs) => fs.put('parts/deep/tasks.tji', 'task t "Other"\n')],
		['only touched', (fs: FakeFs) => fs.touch('parts/deep/tasks.tji', fs.time + 1000)],
		['added', (fs: FakeFs) => fs.put('other.tji', '')],
		['deleted', (fs: FakeFs) => fs.remove('parts/deep/tasks.tji')],
		['the added path made', (fs: FakeFs) => fs.put('new.tji', 'theirs')],
	])('is moved, with nothing written, when a plan file was %s on disk', async (_, change) => {
		const { fs, loc, p } = setup();
		const snap = await p.read(loc);
		change(fs);
		const before = fs.paths().map((f) => [f, bytes(fs, f)]);
		const r = await p.write(loc, {
			base: snap.revision,
			files: new Map([
				['plan.tjp', text('mine')],
				['new.tji', text('mine')],
			]),
			message: null,
		});
		expect(r).toEqual({ status: 'moved', head: await p.head(loc), commit: null });
		expect(fs.paths().map((f) => [f, bytes(fs, f)])).toEqual(before);
		expect(fs.closes).toBe(0);
	});

	it('leaves the old file whole when a write fails before close, and says why', async () => {
		const { fs, loc, p } = setup();
		const snap = await p.read(loc);
		fs.failNext('close', 'QuotaExceededError');
		const r = await p.write(loc, {
			base: snap.revision,
			files: new Map([['plan.tjp', text('new text')]]),
			message: null,
		});
		expect(r).toEqual({
			status: 'failed',
			error: { kind: 'quota', retryAfterMs: null, detail: 'folder: QuotaExceededError' },
		});
		expect(bytes(fs, 'plan.tjp')).toEqual([...BOM_CRLF]);
	});

	it('is not atomic across files: the files before a failure are written, the rest are not', async () => {
		const { fs, loc, p } = setup();
		const snap = await p.read(loc);
		let calls = 0;
		const real = fs.fault.bind(fs);
		vi.spyOn(fs, 'fault').mockImplementation((op) => {
			if (op === 'write' && ++calls === 2) throw new DOMException('x', 'NotAllowedError');
			real(op);
		});
		const r = await p.write(loc, {
			base: snap.revision,
			files: new Map([
				['parts/deep/tasks.tji', text('A')],
				['plan.tjp', text('B')],
			]),
			message: null,
		});
		expect(r.status === 'failed' && r.error.kind).toBe('permission');
		expect(bytes(fs, 'parts/deep/tasks.tji')).toEqual([...text('A')]);
		expect(bytes(fs, 'plan.tjp')).toEqual([...BOM_CRLF]);
		// The next attempt on the old base finds the written file moved (7.2: pull, merge, write the rest).
		const next = await p.write(loc, {
			base: snap.revision,
			files: new Map([['plan.tjp', text('B')]]),
			message: null,
		});
		expect(next.status).toBe('moved');
	});

	it('refuses what it cannot write: not a plan file, not a folder revision, past the limits', async () => {
		const { fs, loc, p } = setup();
		const snap = await p.read(loc);
		const w = (files: [string, Uint8Array][], base = snap.revision) =>
			p.write(loc, { base, files: new Map(files), message: null });
		expect(await w([['notes.txt', text('x')]])).toMatchObject({
			status: 'failed',
			error: { kind: 'server' },
		});
		expect(await w([['../up.tji', text('x')]])).toMatchObject({ status: 'failed' });
		expect(await w([['plan.tjp', text('x')]], 'abc123')).toMatchObject({
			status: 'failed',
			error: { kind: 'server', detail: 'folder: not a folder revision' },
		});
		expect(await w([['plan.tjp', new Uint8Array(PLAN_LIMITS.fileBytes + 1)]])).toMatchObject({
			status: 'failed',
			error: { kind: 'too-large' },
		});
		expect(
			await p.write(
				{ ...loc, handle: 'none' },
				{ base: snap.revision, files: new Map(), message: null },
			),
		).toMatchObject({ status: 'failed', error: { kind: 'not-found' } });
		expect(fs.closes).toBe(0);
	});
});

describe('access and the picker', () => {
	it('answers the folder permission, and asks for it', async () => {
		const { fs, loc, p } = setup();
		expect(await p.access(loc)).toBe('granted');
		fs.permission = 'prompt';
		expect(await p.access(loc)).toBe('prompt');
		fs.answer = 'denied';
		expect(await p.requestAccess(loc)).toBe('denied');
		expect(await p.access(loc)).toBe('denied');
		fs.answer = 'granted';
		expect(await p.requestAccess(loc)).toBe('granted');
		// No stored handle: only picking the folder again helps.
		expect(await p.access({ ...loc, handle: 'gone' })).toBe('denied');
		// A handle without the permission methods (an origin-private folder) is granted.
		const bare = memoryHandles();
		const plain: FsDirHandle = {
			...fs.root,
			kind: 'directory',
			name: 'x',
			values: () => fs.root.values(),
		} as FsDirHandle;
		bare.map.set('h', plain);
		expect(await createFolderProvider({ handles: bare }).access({ ...loc, handle: 'h' })).toBe(
			'granted',
		);
	});

	it('stores the picked folder, and keeps its key when the same folder is picked again', async () => {
		const fs = new FakeFs('acme');
		const handles = memoryHandles();
		const p = createFolderProvider({ handles, pick: async () => fs.root });
		const a = await p.pick();
		expect(a).toMatchObject({ kind: 'folder', name: 'acme' });
		const b = await p.pick();
		expect(b?.handle).toBe(a?.handle);
		expect(handles.map.size).toBe(1);
		const other = new FakeFs('other');
		const c = await createFolderProvider({ handles, pick: async () => other.root }).pick();
		expect(c?.handle).not.toBe(a?.handle);
		expect(handles.map.size).toBe(2);
	});

	it('answers null when the picker is closed, and refuses where there is none', async () => {
		const p = createFolderProvider({
			handles: memoryHandles(),
			pick: () => Promise.reject(new DOMException('closed', 'AbortError')),
		});
		expect(await p.pick()).toBeNull();
		const none = createFolderProvider({ handles: memoryHandles(), pick: null });
		expect((await rejection(none.pick())).error.kind).toBe('unsupported');
		expect(folderSupported({})).toBe(false);
		expect(folderSupported({ showDirectoryPicker: () => undefined })).toBe(true);
	});
});
