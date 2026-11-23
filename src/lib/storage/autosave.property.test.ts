// SPDX-License-Identifier: GPL-2.0-or-later
// Autosave ordering, a model test (phase-4.md 7.1, 13.1): random edits to the files of a plan,
// flushes that are awaited or not, timers, the page being hidden, saves that fail in the middle of
// their transaction (quota), and crashes at any point. A crash reads the plan from another
// connection, as the next page load would: what is stored is always the text of one whole workspace
// version, never a mix of two, and versions never go back. At the end, once saves succeed again,
// the store has the workspace's text exactly. The real local store, on fake-indexeddb.
// FC_SEED replays a run; FC_RUNS sets how many (default 100).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace, type Workspace } from '../workspace/workspace';
import { createAutosave } from './autosave';
import { createLocalStore } from './local-store';
import type { WorkspacePath } from './types';

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['FC_RUNS'] ?? 100);
const FILES = ['plan.tjp', 'a.tji', 'loose.tji'] as const;

type Op =
	| { readonly op: 'edit'; readonly file: number; readonly text: string }
	| { readonly op: 'flush'; readonly wait: boolean }
	| { readonly op: 'time'; readonly ms: number }
	| { readonly op: 'hide' }
	| { readonly op: 'fail'; readonly saves: number }
	| { readonly op: 'crash' };

const text = fc
	.array(fc.constantFrom('task x "X"\n', '\r\n', '﻿', 'é', '\u{1F600}', '# n\n', ''), {
		maxLength: 4,
	})
	.map((p) => p.join(''));

const op: fc.Arbitrary<Op> = fc.oneof(
	{ arbitrary: fc.record({ op: fc.constant('edit' as const), file: fc.nat(2), text }), weight: 6 },
	{ arbitrary: fc.record({ op: fc.constant('flush' as const), wait: fc.boolean() }), weight: 2 },
	{
		arbitrary: fc.record({
			op: fc.constant('time' as const),
			ms: fc.integer({ min: 1, max: 900 }),
		}),
		weight: 2,
	},
	{ arbitrary: fc.constant({ op: 'hide' as const }), weight: 1 },
	{
		arbitrary: fc.record({
			op: fc.constant('fail' as const),
			saves: fc.integer({ min: 1, max: 3 }),
		}),
		weight: 1,
	},
	{ arbitrary: fc.constant({ op: 'crash' as const }), weight: 3 },
);

/** Replaces the whole text of a file, as typing over it would. */
function replace(ws: Workspace, path: WorkspacePath, insert: string): void {
	const state = ws.state(path);
	ws.commit(path, state.update({ changes: { from: 0, to: state.doc.length, insert } }), 'typing');
}

/** Files whose second entry throws while the transaction writes them: a failure mid-way. */
function poisoned(files: ReadonlyMap<WorkspacePath, string>): ReadonlyMap<WorkspacePath, string> {
	const entries = [...files];
	return {
		*[Symbol.iterator]() {
			yield* entries.slice(0, 1);
			throw new DOMException('full', 'QuotaExceededError');
		},
	} as unknown as ReadonlyMap<WorkspacePath, string>;
}

/** A plan's files in path order, to compare. */
const canon = (files: Record<string, string>): string =>
	JSON.stringify(
		Object.keys(files)
			.sort()
			.map((k) => [k, files[k]]),
	);

class Page extends EventTarget {
	visibilityState: DocumentVisibilityState = 'visible';
}

afterEach(() => {
	vi.useRealTimers();
});

async function run(ops: readonly Op[]): Promise<void> {
	// Only the debounce's timers are fake: fake-indexeddb runs on setImmediate.
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	const factory = new IDBFactory();
	const store = createLocalStore({ indexedDB: factory, marker: null });
	const ws = createWorkspace({
		entry: 'plan.tjp',
		files: {
			'plan.tjp': 'project p "P" 2026-01-05 +1m\ninclude "a.tji"\n',
			'a.tji': '',
			'loose.tji': '',
		},
	});
	const id = await store.create(
		{ name: 'm', entry: 'plan.tjp', location: { kind: 'browser' }, from: { opened: true } },
		new Map(Object.entries(ws.texts())),
		null,
	);
	const versions: Array<Record<string, string>> = [ws.texts()];
	let failing = 0;
	const doc = new Page();
	const autosave = createAutosave({
		workspace: ws,
		save: (files, snap) => {
			const f = failing > 0 && files.size > 0 ? (failing--, poisoned(files)) : files;
			return store.saveFiles(id, f, snap.version);
		},
		page: { doc, win: new EventTarget() },
	});
	let seen = 0;
	const crash = async (): Promise<void> => {
		// The next page load: another connection to the same database.
		const reader = createLocalStore({ indexedDB: factory, marker: null });
		const stored = Object.fromEntries((await reader.open(id))?.files ?? []);
		const at = versions.findIndex((v, i) => i >= seen && canon(v) === canon(stored));
		expect(
			at,
			`stored ${JSON.stringify(stored)} is no version at or after ${seen}`,
		).toBeGreaterThanOrEqual(0);
		seen = at;
	};
	for (const o of ops) {
		switch (o.op) {
			case 'edit':
				replace(ws, FILES[o.file] ?? 'plan.tjp', o.text);
				versions[ws.snapshot().version] = ws.texts();
				break;
			case 'flush':
				if (o.wait) await autosave.flush();
				else void autosave.flush();
				break;
			case 'time':
				await vi.advanceTimersByTimeAsync(o.ms);
				break;
			case 'hide':
				doc.visibilityState = 'hidden';
				doc.dispatchEvent(new Event('visibilitychange'));
				doc.visibilityState = 'visible';
				break;
			case 'fail':
				failing = o.saves;
				break;
			case 'crash':
				await crash();
				break;
		}
	}
	failing = 0;
	await autosave.flush();
	await crash();
	const reader = createLocalStore({ indexedDB: factory, marker: null });
	expect(Object.fromEntries((await reader.open(id))?.files ?? [])).toEqual(ws.texts());
	autosave.dispose();
	vi.useRealTimers();
}

describe('autosave ordering (model test)', () => {
	it('always stores one complete version, in order, and the last one in the end', async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(op, { maxLength: 40 }), (ops) => run(ops)),
			{ numRuns: RUNS, ...SEED },
		);
	});
});
