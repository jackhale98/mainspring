// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Opening plans from files and folders, Save to… a folder and Export, in the app state (phase-4.md
// 7.2, 18.11, 18.22; app-storage.ts, plan-files.ts): opened files make a browser-only plan that
// records its lossy files and survives a reload; several plans ask which; a folder opens as a plan
// kept with the folder as its location and what was read as its base, writes nothing, and opens as
// kept when picked again; Save to… writes every file once, never over one that is there, asks
// about lossy files, and keeps the workspace open at the folder; Export asks about lossy files.
// On fake-indexeddb, the fake lock manager and the in-memory File System Access fake.
// The review's cases (T5 review) are plan-files-safety.svelte.test.ts.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storageStrings } from '../strings-storage';
import { decodeSnapshot } from '../storage/codec';
import { createFolderProvider } from '../storage/folder';
import { FakeFs, memoryHandles } from '../storage/testing/fake-fsa';
import type { FolderLocation } from '../storage/types';
import type { AppState } from './app.svelte';
import { folderProvider } from './plan-files';
import { LATIN1, browser, disposeOpened, enc, picked, ready, texts } from './plan-files-testing';

const S = storageStrings.files;

afterEach(disposeOpened);

describe('open files (7.2)', () => {
	it('makes a browser-only plan of an imported folder, which records its lossy files and reopens', async () => {
		const b = browser();
		const a = await ready(b.tab());
		const ok = await a.openFiles([
			picked('plan.tjp', 'project p "P" 2026-01-05 +1m\ninclude "people/team.tji"\n'),
			picked('people/team.tji', LATIN1),
			picked('notes.txt', 'x'),
		]);
		expect(ok).toBe(true);
		expect(a.planLabel).toBe('acme');
		expect(Object.keys(texts(a)).sort()).toEqual(['people/team.tji', 'plan.tjp']);
		expect(texts(a)['people/team.tji']).toBe('# caf�\nresource r "R"\n');
		expect(a.planLocation).toEqual({ kind: 'browser' });
		const id = a.storedId ?? '';
		const stored = await b.store.open(id);
		expect(stored?.plan.from).toEqual({ opened: true, lossy: new Set(['people/team.tji']) });
		expect(stored?.base).toBeNull();

		// A reload opens it again, still knowing which file was lossy: Export asks.
		a.dispose();
		const again = await ready(b.tab());
		expect(again.storedId).toBe(id);
		b.confirm.mockReturnValueOnce(false);
		await again.exportPlan();
		expect(b.confirm).toHaveBeenLastCalledWith(S.lossy(['people/team.tji']));
	});

	it('asks which plan when there are several, and opens nothing when cancelled', async () => {
		const b = browser();
		const a = await ready(b.tab());
		const files = [
			picked('alpha.tjp', 'project a "A" 2026-01-05 +1m\n', ''),
			picked('beta.tjp', 'project b "B" 2026-01-05 +1m\n', ''),
		];
		const opening = a.openFiles(files);
		await vi.waitFor(() => expect(a.planQuestion?.plans).toEqual(['alpha.tjp', 'beta.tjp']));
		expect(a.planQuestion?.where).toBe('');
		a.planQuestion?.answer('beta.tjp');
		expect(await opening).toBe(true);
		expect(a.workspace?.snapshot().entry).toBe('beta.tjp');
		expect(a.planLabel).toBe('beta');

		const cancelled = a.openFiles(files);
		await vi.waitFor(() => expect(a.planQuestion).not.toBeNull());
		a.planQuestion?.answer(null);
		expect(await cancelled).toBe(false);
		expect(a.planLabel).toBe('beta');
		// A caller may ask itself.
		expect(await a.openFiles(files, { choose: async () => 'alpha.tjp' })).toBe(true);
		expect(a.planLabel).toBe('alpha');
	});

	it('says when there is no plan among the files, or the plan is too large', async () => {
		const b = browser();
		const a = await ready(b.tab());
		const say = vi.spyOn(a.edits!, 'say');
		expect(await a.openFiles([picked('team.tji', 'resource r "R"\n')])).toBe(false);
		expect(say).toHaveBeenLastCalledWith(S.noPlan, true);
		const huge = new File([new Uint8Array(3 * 1024 * 1024)], 'plan.tjp');
		expect(await a.openFiles([huge])).toBe(false);
		expect(say).toHaveBeenLastCalledWith(S.tooLarge, true);
		expect(a.planLabel).toBe('One');
	});
});

describe('open folder (7.2, 18.22)', () => {
	function seeded(): FakeFs {
		const fs = new FakeFs('acme');
		fs.put('plan.tjp', 'project p "P" 2026-01-05 +1m\r\ninclude "parts/team.tji"\r\n');
		fs.put('parts/team.tji', LATIN1);
		fs.put('readme.md', 'x');
		return fs;
	}

	it('opens the folder as a plan kept with it as the location, and writes nothing', async () => {
		const b = browser(seeded());
		const a = await ready(b.tab());
		expect(await a.openFolder()).toBe(true);
		expect(a.planLabel).toBe('acme');
		expect(a.planLocation).toMatchObject({ kind: 'folder', name: 'acme' });
		expect(texts(a)['plan.tjp']).toBe(
			'project p "P" 2026-01-05 +1m\r\ninclude "parts/team.tji"\r\n',
		);
		const stored = await b.store.open(a.storedId ?? '');
		expect(stored?.plan.location).toEqual(a.planLocation);
		const loc = a.planLocation as FolderLocation;
		expect(stored?.base?.revision).toBe(await folderProvider().head(loc));
		expect([...(stored?.base?.lossy ?? [])]).toEqual(['parts/team.tji']);
		expect(b.fs.closes).toBe(0);
	});

	it('asks which plan in a folder of several, and opens the same folder as it was kept', async () => {
		const fs = new FakeFs('two');
		fs.put('alpha.tjp', 'project a "A" 2026-01-05 +1m\n');
		fs.put('beta.tjp', 'project b "B" 2026-01-05 +1m\n');
		const b = browser(fs);
		const a = await ready(b.tab());
		expect(
			await a.openFolder({ choose: async (q) => (expect(q.where).toBe('two'), 'beta.tjp') }),
		).toBe(true);
		const id = a.storedId;
		expect(a.planLabel).toBe('two: beta.tjp');
		await a.openSample('one');
		// Picked again: the plan kept for it opens, with no question.
		const choose = vi.fn(async () => 'alpha.tjp');
		expect(await a.openFolder({ choose })).toBe(true);
		expect(choose).not.toHaveBeenCalled();
		expect(a.storedId).toBe(id);
		expect(a.workspace?.snapshot().entry).toBe('beta.tjp');
	});

	it('opens nothing when the picker is closed, and says when the folder has no plan', async () => {
		const empty = new FakeFs('empty');
		empty.put('notes.txt', 'x');
		const b = browser(empty);
		const a = await ready(b.tab());
		const say = vi.spyOn(a.edits!, 'say');
		expect(await a.openFolder()).toBe(false);
		expect(say).toHaveBeenLastCalledWith(S.noPlan, true);
		folderProvider(
			createFolderProvider({
				handles: memoryHandles(),
				pick: () => Promise.reject(new DOMException('closed', 'AbortError')),
			}),
		);
		expect(await a.openFolder()).toBe(false);
		expect(a.planLabel).toBe('One');
	});
});

describe('Save to… a folder', () => {
	async function target(a: AppState): Promise<FolderLocation> {
		const loc = await a.pickFolder();
		if (!loc) throw new Error('no folder');
		return loc;
	}

	it('writes every file of a sample’s copy once, then keeps the plan at the folder', async () => {
		const b = browser(new FakeFs('dest'));
		const a = await ready(b.tab());
		const ws = a.workspace;
		const loc = await target(a);
		const r = await a.saveTo(loc);
		expect(r.kind).toBe('synced');
		expect([...(b.fs.bytes('plan.tjp') ?? [])]).toEqual([
			...enc.encode('﻿project p "P" 2026-01-05 +1m\r\ninclude "lib/x.tji"\r\n'),
		]);
		expect([...(b.fs.bytes('lib/x.tji') ?? [])]).toEqual([...enc.encode('task x "X"\n')]);
		// The same workspace, now kept at the folder with what was written as its base.
		expect(a.workspace).toBe(ws);
		expect(a.planLocation).toEqual(loc);
		expect(a.planLabel).toBe('dest');
		const stored = await b.store.open(a.storedId ?? '');
		expect(stored?.plan).toMatchObject({ location: loc, from: { sample: 'one' } });
		expect(stored?.base?.revision).toBe(r.kind === 'synced' ? r.revision : '');
		expect(decodeSnapshot(await folderProvider().read(loc)).files).toEqual(stored?.base?.files);
		// It is there now: Save to… again is refused.
		expect(await a.saveTo(loc)).toMatchObject({ kind: 'failed', error: { kind: 'unsupported' } });
	});

	it('moves a stored browser plan: the copy here is removed, what was typed is kept', async () => {
		const b = browser(new FakeFs('dest'));
		const a = await ready(b.tab());
		expect(await a.openFiles([picked('plan.tjp', 'project p "P" 2026-01-05 +1m\n', '')])).toBe(
			true,
		);
		const old = a.storedId ?? '';
		const r = await a.saveTo(await target(a));
		expect(r.kind).toBe('synced');
		expect(await b.store.open(old)).toBeNull();
		expect((await b.store.plans()).map((p) => p.location.kind)).toEqual(['folder']);
		// A change after the move is kept in the plan at the folder.
		const state = a.workspace!.state('plan.tjp');
		a.workspace!.commit(
			'plan.tjp',
			state.update({ changes: { from: 0, insert: '# later\n' } }),
			'typing',
		);
		await a.flush();
		const stored = await b.store.open(a.storedId ?? '');
		expect(stored?.files.get('plan.tjp')).toBe('# later\nproject p "P" 2026-01-05 +1m\n');
		expect([...(b.fs.bytes('plan.tjp') ?? [])]).toEqual([
			...enc.encode('project p "P" 2026-01-05 +1m\n'),
		]);
	});

	it('never writes over a file that is there', async () => {
		const fs = new FakeFs('dest');
		fs.put('lib/x.tji', 'theirs');
		const b = browser(fs);
		const a = await ready(b.tab());
		expect(await a.saveTo(await target(a))).toEqual({ kind: 'exists', files: ['lib/x.tji'] });
		expect(fs.paths()).toEqual(['lib/x.tji']);
		expect(fs.closes).toBe(0);
		expect(a.planLocation).toEqual({ kind: 'browser' });
	});

	it('asks before writing files that had bytes that are not UTF-8, and needs the permission', async () => {
		const b = browser(new FakeFs('dest'));
		const a = await ready(b.tab());
		expect(
			await a.openFiles([
				picked('plan.tjp', 'project p "P" 2026-01-05 +1m\n', ''),
				picked('team.tji', LATIN1, ''),
			]),
		).toBe(true);
		const loc = await target(a);
		b.confirm.mockReturnValueOnce(false);
		expect(await a.saveTo(loc)).toEqual({ kind: 'cancelled' });
		expect(b.confirm).toHaveBeenLastCalledWith(S.lossy(['team.tji']));
		expect(b.fs.closes).toBe(0);
		b.fs.permission = 'prompt';
		expect(await a.saveTo(loc)).toEqual({ kind: 'needs-access', access: 'prompt' });
		b.fs.permission = 'granted';
		expect((await a.saveTo(loc)).kind).toBe('synced');
		// Written with replacement characters, as asked; the new base has no lossy file.
		expect([...(b.fs.bytes('team.tji') ?? [])]).toEqual([
			...enc.encode('# caf\uFFFD\nresource r "R"\n'),
		]);
		expect((await b.store.open(a.storedId ?? ''))?.base?.lossy).toEqual(new Set());
	});

	it('leaves the plan here when another opened while it was being saved', async () => {
		const b = browser(new FakeFs('dest'));
		const a = await ready(b.tab());
		expect(await a.openFiles([picked('plan.tjp', 'project p "P" 2026-01-05 +1m\n', '')])).toBe(
			true,
		);
		const kept = a.storedId ?? '';
		const loc = await target(a);
		// The write waits until another plan has opened.
		const real = folderProvider();
		let release: () => void = () => undefined;
		const gate = new Promise<void>((r) => (release = r));
		let writing = false;
		folderProvider({
			...real,
			write: async (l, req, sig) => {
				writing = true;
				await gate;
				return real.write(l, req, sig);
			},
		});
		const saving = a.saveTo(loc);
		await vi.waitFor(() => expect(writing).toBe(true));
		expect(await a.openSample('two')).toBe(true);
		release();
		expect((await saving).kind).toBe('synced');
		// The other plan stays open as it was; the plan saved there is kept, and so is the copy here.
		expect(a.planKey).toBe('two');
		expect(a.planLocation).toEqual({ kind: 'browser' });
		expect(await b.store.open(kept)).not.toBeNull();
		expect((await b.store.plans()).map((p) => p.location.kind).sort()).toEqual([
			'browser',
			'folder',
		]);
	});

	it('leaves GitHub and the browser to their own tasks', async () => {
		const b = browser();
		const a = await ready(b.tab());
		expect(await a.saveTo({ kind: 'browser' })).toEqual({ kind: 'browser-only' });
		expect(
			await a.saveTo({
				kind: 'github',
				account: '1',
				owner: 'o',
				repo: 'r',
				branch: 'main',
				dir: '',
			}),
		).toMatchObject({ kind: 'failed', error: { kind: 'unsupported' } });
	});
});

describe('Export', () => {
	it('downloads the plan and says so', async () => {
		const b = browser();
		const a = await ready(b.tab());
		const say = vi.spyOn(a.edits!, 'say');
		const url = vi.fn(() => 'blob:x');
		Object.assign(URL, { createObjectURL: url, revokeObjectURL: () => undefined });
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => undefined);
		await a.exportPlan();
		expect(click).toHaveBeenCalled();
		expect(say).toHaveBeenLastCalledWith(S.downloaded('One-plan.zip'), false);
		click.mockRestore();
	});
});
