// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Opening and Save to… where files could be lost (T5 review: H1, M1, M2, M4, M5, M6, L1, L3), in
// the app state on the in-memory File System Access fake:
// - Save to… never writes over a file that is there, in any case: a folder holding plan files is
//   refused (`exists`, naming them), unless they are this plan's own files with its bytes, left by
//   a Save to… that did not finish, which a new Save to… then finishes; a plan whose paths differ
//   only by case is refused, saying so;
// - Save to… right after a sample's first change leaves no copy of it behind;
// - opened files whose paths differ only by case are refused, saying so; files inside `.git` are
//   left out;
// - a plan opened while the store refuses still knows its lossy files and its folder;
// - what Save to… says (for T15's flow) never reads the error's detail.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storageStrings } from '../strings-storage';
import { createLocalStore } from '../storage/local-store';
import { FakeFs } from '../storage/testing/fake-fsa';
import { storageError, type FolderLocation } from '../storage/types';
import type { AppState } from './app.svelte';
import { saveToSentence } from './plan-files';
import { LATIN1, browser, disposeOpened, enc, picked, ready, texts } from './plan-files-testing';

const S = storageStrings.files;
const str = (b: Uint8Array | null): string | null =>
	b ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(b) : null;
const PLAN = '﻿project p "P" 2026-01-05 +1m\r\ninclude "lib/x.tji"\r\n';

afterEach(disposeOpened);

async function target(a: AppState): Promise<FolderLocation> {
	const loc = await a.pickFolder();
	if (!loc) throw new Error('no folder');
	return loc;
}

describe('Save to… never writes over a file that is there', () => {
	it('refuses a folder holding Plan.tjp on a disk that ignores case (H1, M5)', async () => {
		const fs = new FakeFs('dest', { caseInsensitive: true });
		fs.put('Plan.tjp', 'theirs');
		const b = browser(fs);
		const a = await ready(b.tab());
		expect(await a.saveTo(await target(a))).toEqual({ kind: 'exists', files: ['Plan.tjp'] });
		expect(str(fs.bytes('Plan.tjp'))).toBe('theirs');
		expect(fs.closes).toBe(0);
		expect(a.planLocation).toEqual({ kind: 'browser' });
	});

	it('refuses a folder that holds another plan, its files named in any case (M5)', async () => {
		const fs = new FakeFs('dest');
		fs.put('other.tjp', 'project o "O" 2026-01-05 +1m\n');
		fs.put('old/NOTES.TJI', 'x');
		fs.put('readme.md', 'not a plan file');
		const b = browser(fs);
		const a = await ready(b.tab());
		expect(await a.saveTo(await target(a))).toEqual({
			kind: 'exists',
			files: ['old/NOTES.TJI', 'other.tjp'],
		});
		expect(fs.closes).toBe(0);
	});

	it("finishes a Save to… that did not: the plan's own files with its bytes are taken (M4)", async () => {
		const fs = new FakeFs('dest');
		fs.put('plan.tjp', PLAN);
		const before = fs.stamp('plan.tjp');
		const b = browser(fs);
		const a = await ready(b.tab());
		const r = await a.saveTo(await target(a));
		expect(r.kind).toBe('synced');
		expect(fs.stamp('plan.tjp')).toEqual(before);
		expect(str(fs.bytes('lib/x.tji'))).toBe('task x "X"\n');
		expect(fs.closes).toBe(1);
		expect(a.planLocation).toMatchObject({ kind: 'folder' });
	});

	it('says some files may be there when it fails part way, and a new Save to… finishes (M4)', async () => {
		const fs = new FakeFs('dest');
		const b = browser(fs);
		const a = await ready(b.tab());
		const loc = await target(a);
		let closes = 0;
		const real = fs.fault.bind(fs);
		const spy = vi.spyOn(fs, 'fault').mockImplementation((op) => {
			if (op === 'close' && ++closes === 2) throw new DOMException('full', 'QuotaExceededError');
			real(op);
		});
		const r = await a.saveTo(loc);
		expect(r).toMatchObject({ kind: 'failed', error: { kind: 'quota' } });
		expect(saveToSentence(r, 'dest')).toBe(S.saveFailed('dest'));
		expect(a.planLocation).toEqual({ kind: 'browser' });
		spy.mockRestore();
		expect((await a.saveTo(loc)).kind).toBe('synced');
		expect(str(fs.bytes('plan.tjp'))).toBe(PLAN);
		expect(str(fs.bytes('lib/x.tji'))).toBe('task x "X"\n');
	});

	it('refuses a plan whose files differ only by case, saying so (H1)', async () => {
		const b = browser(new FakeFs('dest'));
		const a = await ready(b.tab());
		expect(await a.openSample('cases')).toBe(true);
		const say = vi.spyOn(a.edits!, 'say');
		expect(await a.saveTo(await target(a))).toEqual({ kind: 'cancelled' });
		expect(say).toHaveBeenLastCalledWith(S.sameNameSave('LIB.tji', 'lib.tji'), true);
		expect(b.fs.paths()).toEqual([]);
	});

	it("leaves no copy behind when it runs right after a sample's first change (M2)", async () => {
		const b = browser(new FakeFs('dest'));
		const a = await ready(b.tab());
		const loc = await target(a);
		const ws = a.workspace!;
		ws.commit(
			'plan.tjp',
			ws.state('plan.tjp').update({ changes: { from: 0, insert: '# mine\n' } }),
			'typing',
		);
		// No wait for autosave: the copy is stored by Save to…'s own flush.
		expect((await a.saveTo(loc)).kind).toBe('synced');
		await a.flush();
		expect((await b.store.plans()).map((p) => p.location.kind)).toEqual(['folder']);
		expect(str(b.fs.bytes('plan.tjp'))).toBe(`# mine\n${PLAN}`);
	});

	it('words its outcomes for T15 without reading the error detail (M6, L3)', () => {
		expect(
			saveToSentence({ kind: 'synced', revision: 'r', pulled: false, pushed: 1 }, 'dest'),
		).toBe(S.savedTo('dest'));
		expect(saveToSentence({ kind: 'exists', files: ['a.tjp'] }, 'dest')).toBe(
			S.planThere(['a.tjp']),
		);
		expect(saveToSentence({ kind: 'needs-access', access: 'prompt' }, 'dest')).toBe(S.permission);
		for (const detail of ['save-to: already at a provider', 'anything'])
			expect(
				saveToSentence({ kind: 'failed', error: storageError('unsupported', detail) }, 'dest'),
			).toBe(S.saveFailed('dest'));
		expect(saveToSentence({ kind: 'failed', error: storageError('not-owner', 'x') }, 'dest')).toBe(
			S.readOnly,
		);
		expect(saveToSentence({ kind: 'cancelled' }, 'dest')).toBeNull();
		expect(S.savedTo('dest')).not.toMatch(/kept there/);
	});
});

describe('opening files', () => {
	it('refuses files whose paths differ only by case, saying so (H1)', async () => {
		const b = browser();
		const a = await ready(b.tab());
		const say = vi.spyOn(a.edits!, 'say');
		const files = [
			picked('ok.tjp', 'project a "A" 2026-01-05 +1m\n', ''),
			picked('Ok.tjp', 'x', ''),
		];
		expect(await a.openFiles(files)).toBe(false);
		expect(say).toHaveBeenLastCalledWith(S.sameNameOpen('ok.tjp', 'Ok.tjp'), true);
		expect(a.planLabel).toBe('One');
	});

	it('leaves out files inside .git (L1)', async () => {
		const b = browser();
		const a = await ready(b.tab());
		expect(
			await a.openFiles([
				picked('plan.tjp', 'project p "P" 2026-01-05 +1m\n'),
				picked('.git/x.tji', 'git internals'),
			]),
		).toBe(true);
		expect(Object.keys(texts(a))).toEqual(['plan.tjp']);
	});

	it('keeps the lossy files and the folder of a plan opened while the store refuses (M1)', async () => {
		const fs = new FakeFs('acme');
		fs.put('plan.tjp', 'project p "P" 2026-01-05 +1m\ninclude "team.tji"\n');
		fs.put('team.tji', LATIN1);
		const b = browser(fs, {
			store: () => createLocalStore({ indexedDB: undefined, marker: null }),
		});
		const a = await ready(b.tab());
		expect(
			await a.openFiles([
				picked('plan.tjp', 'project q "Q" 2026-01-05 +1m\n', ''),
				picked('n.tji', LATIN1, ''),
			]),
		).toBe(true);
		expect(a.storedId).toBeNull();
		b.confirm.mockReturnValueOnce(false);
		await a.exportPlan();
		expect(b.confirm).toHaveBeenLastCalledWith(S.lossy(['n.tji']));

		expect(await a.openFolder()).toBe(true);
		expect(a.storedId).toBeNull();
		expect(a.planLocation).toMatchObject({ kind: 'folder', name: 'acme' });
		b.confirm.mockReturnValueOnce(false);
		await a.exportPlan();
		expect(b.confirm).toHaveBeenLastCalledWith(S.lossy(['team.tji']));
		expect(enc).toBeDefined();
	});
});
