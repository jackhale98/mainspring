// SPDX-License-Identifier: GPL-2.0-or-later
// Autosave (phase-4.md 7.1, 8.1 #8): 400 ms after the last change, at once when the page is hidden
// or goes away, the whole text of each changed file at one version, failures reported and kept for
// the next save, and nothing after dispose.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace, type Workspace } from '../workspace/workspace';
import { AUTOSAVE_MS, IDLE_MS, createAutosave, type AutosaveState } from './autosave';
import { StorageFailure, storageError, type WorkspacePath } from './types';

const PLAN = 'project p "P" 2026-01-05 +1m\ninclude "a.tji"\n';

function workspace(): Workspace {
	return createWorkspace({
		entry: 'plan.tjp',
		files: { 'plan.tjp': PLAN, 'a.tji': 'task a "A"\n', 'loose.tji': 'task l "L"\n' },
	});
}

function type(ws: Workspace, path: WorkspacePath, insert: string): void {
	const state = ws.state(path);
	ws.commit(path, state.update({ changes: { from: state.doc.length, insert } }), 'typing');
}

class Page extends EventTarget {
	visibilityState: DocumentVisibilityState = 'visible';
}

interface Saved {
	readonly files: Record<string, string>;
	readonly version: number;
}

function rig(opts: { fail?: () => boolean; all?: boolean } = {}) {
	const ws = workspace();
	const saved: Saved[] = [];
	const states: AutosaveState[] = [];
	const doc = new Page();
	const win = new EventTarget();
	const a = createAutosave({
		workspace: ws,
		save: async (files, snap) => {
			await Promise.resolve();
			if (opts.fail?.()) throw new StorageFailure(storageError('quota', 'full'));
			saved.push({ files: Object.fromEntries(files), version: snap.version });
		},
		onState: (s) => states.push(s),
		page: { doc, win },
		now: () => 7,
		...(opts.all !== undefined && { all: opts.all }),
	});
	return { ws, a, saved, states, doc, win };
}

afterEach(() => {
	vi.useRealTimers();
});

describe('autosave', () => {
	it('saves the changed files 400 ms after the last change, once, at the newest version', async () => {
		vi.useFakeTimers();
		const { ws, a, saved, states } = rig();
		type(ws, 'a.tji', '# 1\n');
		vi.advanceTimersByTime(AUTOSAVE_MS - 1);
		type(ws, 'loose.tji', '# 2\n');
		vi.advanceTimersByTime(AUTOSAVE_MS - 1);
		expect(saved).toEqual([]);
		expect(a.pending).toBe(true);
		await vi.advanceTimersByTimeAsync(1);
		await a.flush();
		expect(saved).toEqual([
			{
				files: { 'a.tji': 'task a "A"\n# 1\n', 'loose.tji': 'task l "L"\n# 2\n' },
				version: ws.snapshot().version,
			},
		]);
		expect(states).toEqual([{ kind: 'saved', at: 7, version: 2 }]);
		expect(a.pending).toBe(false);
	});

	it('saves at once when the page is hidden or goes away', async () => {
		const { ws, a, saved, doc, win } = rig();
		type(ws, 'plan.tjp', '# hidden\n');
		doc.visibilityState = 'hidden';
		doc.dispatchEvent(new Event('visibilitychange'));
		await a.flush();
		expect(saved.map((s) => Object.keys(s.files))).toEqual([['plan.tjp']]);
		type(ws, 'a.tji', '# gone\n');
		win.dispatchEvent(new Event('pagehide'));
		await a.flush();
		expect(saved.map((s) => Object.keys(s.files))).toEqual([['plan.tjp'], ['a.tji']]);
		// Shown again: nothing to save, nothing saved.
		doc.visibilityState = 'visible';
		doc.dispatchEvent(new Event('visibilitychange'));
		await a.flush();
		expect(saved).toHaveLength(2);
		a.dispose();
	});

	it('reports a failure and keeps its files for the next save, which then has them all', async () => {
		let fail = true;
		const { ws, a, saved, states } = rig({ fail: () => fail });
		type(ws, 'a.tji', '# 1\n');
		await a.flush();
		expect(saved).toEqual([]);
		expect(states).toEqual([
			{ kind: 'failed', error: { kind: 'quota', retryAfterMs: null, detail: 'full' } },
		]);
		expect(a.pending).toBe(true);
		fail = false;
		type(ws, 'plan.tjp', '# 2\n');
		await a.flush();
		expect(Object.keys(saved[0]?.files ?? {}).sort()).toEqual(['a.tji', 'plan.tjp']);
		expect(states.at(-1)?.kind).toBe('saved');
	});

	it('never rejects, also when the save throws something that is not a storage failure', async () => {
		const ws = workspace();
		const states: AutosaveState[] = [];
		const a = createAutosave({
			workspace: ws,
			save: () => Promise.reject(new Error('bug')),
			onState: (s) => states.push(s),
			page: null,
		});
		type(ws, 'a.tji', 'x');
		await expect(a.flush()).resolves.toBeUndefined();
		expect(states[0]).toMatchObject({ kind: 'failed', error: { kind: 'server' } });
	});

	it('with `all`, notes every file from the start (a plan not stored yet)', async () => {
		vi.useFakeTimers();
		const { a, saved } = rig({ all: true });
		await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
		await a.flush();
		expect(Object.keys(saved[0]?.files ?? {}).sort()).toEqual(['a.tji', 'loose.tji', 'plan.tjp']);
	});

	it('does nothing after dispose', async () => {
		vi.useFakeTimers();
		const { ws, a, saved, doc } = rig();
		type(ws, 'a.tji', 'x');
		a.dispose();
		doc.visibilityState = 'hidden';
		doc.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
		await a.flush();
		expect(saved).toEqual([]);
	});

	it('waits for an idle moment at most so long that a change is stored within a second (L2)', async () => {
		vi.useFakeTimers();
		const asked: number[] = [];
		vi.stubGlobal('requestIdleCallback', (f: () => void, o: { timeout: number }) => {
			asked.push(o.timeout);
			setTimeout(f, o.timeout);
			return 1;
		});
		try {
			const { ws, a, saved } = rig();
			type(ws, 'a.tji', 'x');
			await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + IDLE_MS);
			await a.flush();
			expect(saved).toHaveLength(1);
			expect(asked).toEqual([IDLE_MS]);
			expect(AUTOSAVE_MS + IDLE_MS).toBeLessThanOrEqual(1000);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('does not save on a change itself: typing only notes the file', () => {
		const save = vi.fn(() => Promise.resolve());
		const ws = workspace();
		createAutosave({ workspace: ws, save, page: null });
		for (let i = 0; i < 50; i++) type(ws, 'a.tji', 'x');
		expect(save).not.toHaveBeenCalled();
	});
});
