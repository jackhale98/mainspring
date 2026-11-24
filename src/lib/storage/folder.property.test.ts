// SPDX-License-Identifier: GPL-2.0-or-later
// The folder round trip (phase-4.md 13.1, 18.11; ADR-0003 #1 amended), on the in-memory File
// System Access fake: a folder of plan files with any bytes (BOM, CRLF, a lone '\r', astral
// characters, bytes that are not UTF-8) is read, decoded, edited, and saved the way the sync
// controller saves (only the files whose text changed, encoded; lossy ones named first), then read
// again. Unchanged files keep their bytes exactly, invalid ones too; changed files are exactly the
// edited text; files that are not plan files and files not named are untouched; nothing is
// deleted; with no edit nothing is written. FC_SEED replays a run; FC_RUNS sets how many (100).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeFiles, lossyChanged } from './codec';
import { createWorkspace } from '../workspace/workspace';
import { createFolderProvider } from './folder';
import { FakeFs, memoryHandles } from './testing/fake-fsa';
import type { FolderLocation } from './types';

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['FC_RUNS'] ?? 100);
const enc = new TextEncoder();

const PATHS = ['plan.tjp', 'a.tji', 'parts/b.tji', 'parts/deep/c.tji', 'x/y.tjp'] as const;

/** Text with what round trips must keep: a BOM, CRLF and lone '\r', astral characters. */
const text = fc
	.array(
		fc.oneof(
			fc.string({ unit: 'binary', maxLength: 12 }),
			fc.constantFrom('\r\n', '\r', '\n', '﻿', '😀', 'task t "T" {\n}\n', '�'),
		),
		{ maxLength: 8 },
	)
	.map((parts) => parts.join(''));

/** A file's bytes: valid UTF-8 (maybe with a BOM) or arbitrary bytes (often not UTF-8). */
const bytes = fc.oneof(
	text.map((t) => enc.encode(t)),
	fc.tuple(fc.boolean(), text).map(([bom, t]) => enc.encode((bom ? '﻿' : '') + t)),
	fc.uint8Array({ maxLength: 40 }),
	fc
		.tuple(text, fc.constantFrom(0xff, 0xc3, 0xe9, 0x80), text)
		.map(([a, bad, b]) => Uint8Array.of(...enc.encode(a), bad, ...enc.encode(b))),
);

/** The folder: plan files, and two files that are not plan files. */
const folder = fc.dictionary(fc.constantFrom(...PATHS), bytes, { minKeys: 1 });

/** What the user does: new text for some files, maybe one added file. */
const edits = fc.record({
	changed: fc.dictionary(fc.constantFrom(...PATHS), text),
	added: fc.option(text, { nil: null }),
});

describe('folder round trip (13.1)', () => {
	it('keeps every unchanged byte and writes exactly the edited text', async () => {
		await fc.assert(
			fc.asyncProperty(folder, edits, async (files, e) => {
				const fs = new FakeFs();
				for (const [p, b] of Object.entries(files)) fs.put(p, b);
				fs.put('notes.txt', Uint8Array.of(0xff, 0x00));
				fs.put('parts/readme.md', 'x');
				const handles = memoryHandles();
				handles.map.set('h', fs.root);
				const loc: FolderLocation = { kind: 'folder', handle: 'h', name: 'plans' };
				const p = createFolderProvider({ handles });

				const read = decodeSnapshot(await p.read(loc));
				// The workspace after the edits (only files the folder has, plus the added one).
				const ws = new Map(read.files);
				for (const [path, t] of Object.entries(e.changed)) if (ws.has(path)) ws.set(path, t);
				if (e.added !== null) ws.set('added/new.tji', e.added);
				const changed = new Map([...ws].filter(([path, t]) => read.files.get(path) !== t));
				// Only a changed lossy file is named for the question (18.11).
				expect(lossyChanged(read, ws).sort()).toEqual(
					[...read.lossy].filter((path) => changed.has(path)).sort(),
				);
				const before = fs.paths().map((f) => [f, fs.bytes(f), fs.stamp(f)] as const);

				const r = await p.write(loc, {
					base: read.revision,
					files: encodeFiles(changed),
					message: null,
				});
				expect(r.status).toBe('written');
				if (r.status !== 'written') return;
				expect(fs.closes).toBe(changed.size);
				expect(await p.head(loc)).toBe(r.revision);

				for (const [f, b, stamp] of before) {
					if (changed.has(f)) continue;
					// Untouched: same bytes, same stamp.
					expect([...(fs.bytes(f) ?? [])]).toEqual([...(b ?? [])]);
					expect(fs.stamp(f)).toEqual(stamp);
				}
				const again = await p.read(loc);
				const decoded = decodeSnapshot(again);
				for (const [path, t] of changed) {
					expect([...(again.files.get(path) ?? [])]).toEqual([...enc.encode(t)]);
					expect(decoded.files.get(path)).toBe(t);
				}
				// Nothing was deleted; the added file is the only new one.
				const after = new Set(fs.paths());
				for (const [f] of before) expect(after.has(f)).toBe(true);
				expect(after.size).toBe(before.length + (changed.has('added/new.tji') ? 1 : 0));
			}),
			{ numRuns: RUNS, ...SEED },
		);
	});

	it('writes nothing when the plan is opened and saved without an edit', async () => {
		await fc.assert(
			fc.asyncProperty(folder, async (files) => {
				const fs = new FakeFs();
				for (const [p, b] of Object.entries(files)) fs.put(p, b);
				const handles = memoryHandles();
				handles.map.set('h', fs.root);
				const loc: FolderLocation = { kind: 'folder', handle: 'h', name: 'plans' };
				const p = createFolderProvider({ handles });
				const read = decodeSnapshot(await p.read(loc));
				// Opened as the app opens it: a workspace of the decoded text (T5 review L5), whose
				// text now is what a save compares with the base.
				const entry = [...read.files.keys()][0] ?? 'plan.tjp';
				const ws = createWorkspace({ entry, files: Object.fromEntries(read.files) });
				const now = ws.texts();
				expect(Object.keys(now).sort()).toEqual([...read.files.keys()].sort());
				const changed = new Map(
					Object.entries(now).filter(([path, t]) => read.files.get(path) !== t),
				);
				const r = await p.write(loc, {
					base: read.revision,
					files: encodeFiles(changed),
					message: null,
				});
				expect(r).toEqual({ status: 'written', revision: read.revision });
				expect(fs.closes).toBe(0);
				for (const [path, b] of Object.entries(files))
					expect([...(fs.bytes(path) ?? [])]).toEqual([...b]);
			}),
			{ numRuns: RUNS, ...SEED },
		);
	});
});
