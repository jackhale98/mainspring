// SPDX-License-Identifier: GPL-2.0-or-later
// Autosave ordering, a model test (phase-4.md 7.1, 8.1 #7, 13.1; T4 review H1, M1, L5): random
// edits to the files of a plan, flushes that are awaited or not, timers, the page being hidden,
// saves that fail in the middle of their transaction (quota) and saves that are slow, crashes at
// any point, the same tab opening the plan again (a new workspace, whose versions start at 0 again)
// and another tab taking the plan by force (its own store instance; the old session's slow saves
// still arrive). A crash reads the plan from another connection, as the next page load would: what
// is stored is always the text of one whole workspace version of the newest session, never a mix of
// two, never a version older than one stored before, never a session that lost the plan. At the
// end, once saves succeed, the store has the owning session's text exactly. The real local store,
// on fake-indexeddb. FC_SEED replays a run; FC_RUNS sets how many (default 100).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace, type Workspace } from '../workspace/workspace';
import { createAutosave, type Autosave } from './autosave';
import { createLocalStore } from './local-store';
import type { LocalStore } from './store-types';
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
	| { readonly op: 'slow'; readonly ms: number }
	| { readonly op: 'crash' }
	| { readonly op: 'reopen' }
	| { readonly op: 'steal' };

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
	{
		arbitrary: fc.record({
			op: fc.constant('slow' as const),
			ms: fc.integer({ min: 0, max: 800 }),
		}),
		weight: 1,
	},
	{ arbitrary: fc.constant({ op: 'crash' as const }), weight: 3 },
	{ arbitrary: fc.constant({ op: 'reopen' as const }), weight: 1 },
	{ arbitrary: fc.constant({ op: 'steal' as const }), weight: 1 },
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

/** One session of the plan in one tab: its store instance, workspace and autosave. */
interface Session {
	readonly store: LocalStore;
	readonly ws: Workspace;
	readonly autosave: Autosave;
	readonly doc: Page;
	failing: number;
	lag: number;
}

async function run(ops: readonly Op[]): Promise<void> {
	// Only the debounce's and the slow saves' timers are fake: fake-indexeddb runs on setImmediate.
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	const factory = new IDBFactory();
	const tabs = [
		createLocalStore({ indexedDB: factory, marker: null }),
		createLocalStore({ indexedDB: factory, marker: null }),
	] as const;
	const first = createWorkspace({
		entry: 'plan.tjp',
		files: {
			'plan.tjp': 'project p "P" 2026-01-05 +1m\ninclude "a.tji"\n',
			'a.tji': '',
			'loose.tji': '',
		},
	});
	const id = await tabs[0].create(
		{ name: 'm', entry: 'plan.tjp', location: { kind: 'browser' }, from: { opened: true } },
		new Map(Object.entries(first.texts())),
		null,
	);
	/** Every state of every session, in order; a session's own states follow its base. */
	const states: Array<Record<string, string>> = [first.texts()];
	/** No state before this index may be stored any more (an older session's). */
	let seen = 0;
	let tab = 0;
	const start = (store: LocalStore, ws: Workspace): Session => {
		const doc = new Page();
		const s: Session = {
			store,
			ws,
			doc,
			failing: 0,
			lag: 0,
			autosave: createAutosave({
				workspace: ws,
				save: async (files, snap) => {
					const f = s.failing > 0 && files.size > 0 ? (s.failing--, poisoned(files)) : files;
					if (s.lag > 0) await new Promise((r) => setTimeout(r, s.lag));
					return store.saveFiles(id, f, snap.version);
				},
				page: { doc, win: new EventTarget() },
			}),
		};
		return s;
	};
	let session = start(tabs[0], first);
	/** Runs the fake clock until `p` settles (a slow save waits on a timer). */
	const drive = async (p: Promise<unknown>): Promise<void> => {
		let done = false;
		void p.finally(() => (done = true));
		for (let i = 0; i < 100 && !done; i++) await vi.advanceTimersByTimeAsync(100);
		await p;
	};
	const crash = async (): Promise<void> => {
		// The next page load: another connection to the same database.
		const reader = createLocalStore({ indexedDB: factory, marker: null });
		const stored = Object.fromEntries((await reader.open(id))?.files ?? []);
		const at = states.findIndex((v, i) => i >= seen && canon(v) === canon(stored));
		expect(
			at,
			`stored ${JSON.stringify(stored)} is no state at or after ${seen}`,
		).toBeGreaterThanOrEqual(0);
		seen = at;
	};
	/** A new session of the plan in tab `t`, from what the store has: it takes ownership. */
	const open = async (t: number): Promise<void> => {
		const opened = await tabs[t]!.open(id, { own: true });
		const files = Object.fromEntries(opened?.files ?? []);
		states.push(files);
		seen = states.length - 1;
		tab = t;
		session = start(tabs[t]!, createWorkspace({ entry: 'plan.tjp', files }));
	};
	for (const o of ops) {
		switch (o.op) {
			case 'edit':
				replace(session.ws, FILES[o.file] ?? 'plan.tjp', o.text);
				states.push(session.ws.texts());
				break;
			case 'flush':
				if (o.wait) await drive(session.autosave.flush());
				else void session.autosave.flush();
				break;
			case 'time':
				await vi.advanceTimersByTimeAsync(o.ms);
				break;
			case 'hide':
				session.doc.visibilityState = 'hidden';
				session.doc.dispatchEvent(new Event('visibilitychange'));
				session.doc.visibilityState = 'visible';
				break;
			case 'fail':
				session.failing = o.saves;
				break;
			case 'slow':
				session.lag = o.ms;
				break;
			case 'crash':
				await crash();
				break;
			case 'reopen': {
				// The same tab opens the plan again: what autosave holds is stored first (the app's
				// teardown), then a new workspace starts at version 0 on the same store instance.
				const old = session;
				await drive(old.autosave.flush());
				old.autosave.dispose();
				await open(tab);
				break;
			}
			case 'steal': {
				// The other tab takes the plan by force: the old session stops, and a save of it that
				// is still on its way arrives late, after the new owner has read the plan.
				session.autosave.dispose();
				await open(1 - tab);
				break;
			}
		}
	}
	session.failing = 0;
	await drive(session.autosave.flush());
	// Slow saves of sessions that lost the plan arrive now, and are refused.
	await vi.advanceTimersByTimeAsync(2000);
	await crash();
	const reader = createLocalStore({ indexedDB: factory, marker: null });
	expect(Object.fromEntries((await reader.open(id))?.files ?? [])).toEqual(session.ws.texts());
	session.autosave.dispose();
	vi.useRealTimers();
}

/** The review's cases, always run first (T4 review H1 and M1). */
const EXAMPLES: Array<[Op[]]> = [
	// H1: the tab saved up to version 2, opens the plan again (versions restart at 0) and types.
	[
		[
			{ op: 'edit', file: 0, text: 'a' },
			{ op: 'flush', wait: true },
			{ op: 'edit', file: 1, text: 'b' },
			{ op: 'flush', wait: true },
			{ op: 'reopen' },
			{ op: 'edit', file: 2, text: 'again' },
			{ op: 'flush', wait: true },
			{ op: 'crash' },
		],
	],
	// H1 through another tab: A, B takes it, A takes it back and types (each on its own instance).
	[
		[
			{ op: 'edit', file: 0, text: 'a' },
			{ op: 'flush', wait: true },
			{ op: 'edit', file: 0, text: 'a2' },
			{ op: 'flush', wait: true },
			{ op: 'steal' },
			{ op: 'edit', file: 1, text: 'b' },
			{ op: 'flush', wait: true },
			{ op: 'steal' },
			{ op: 'edit', file: 2, text: 'a again' },
			{ op: 'flush', wait: true },
		],
	],
	// M1: A's save takes 500 ms; B takes the plan meanwhile and types; A's write arrives late.
	[
		[
			{ op: 'slow', ms: 500 },
			{ op: 'edit', file: 1, text: 'from A' },
			{ op: 'flush', wait: false },
			{ op: 'time', ms: 200 },
			{ op: 'steal' },
			{ op: 'edit', file: 0, text: 'from B' },
			{ op: 'flush', wait: true },
			{ op: 'time', ms: 600 },
			{ op: 'crash' },
		],
	],
];

describe('autosave ordering (model test)', () => {
	it('always stores one complete version of the owning session, in order, and the last one in the end', async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(op, { maxLength: 40 }), (ops) => run(ops)),
			{ numRuns: RUNS, ...SEED, examples: EXAMPLES },
		);
	});
});
