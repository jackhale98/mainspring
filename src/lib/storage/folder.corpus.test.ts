// SPDX-License-Identifier: GPL-2.0-or-later
// 13.1's corpus round trip for the folder provider (T5 review M7): every golden plan and every
// storage fixture is written to the in-memory File System Access fake as it is on disk, read back
// through the provider with identical bytes (the file with bytes that are not UTF-8 too, as bytes;
// its text is lossy); then one file is edited and saved the way the sync controller saves (only
// the files whose text changed): every other file keeps its bytes and its stamp, and the edited one
// is exactly the edited text. Also: `planNames` lists every plan-like name, in any case.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INVALID_UTF8_FILE, ROOT, goldenPlans } from '../../../tests/roundtrip/corpus';
import { decodeSnapshot, encodeFiles, encodePlanFile } from './codec';
import { createFolderProvider } from './folder';
import { FakeFs, memoryHandles } from './testing/fake-fsa';
import type { FolderLocation } from './types';

interface Case {
	readonly id: string;
	readonly root: string;
	readonly entry: string;
	readonly files: readonly string[];
}

/** The storage fixtures, each folder one plan (its `.tjp` files are the possible entries). */
function storagePlans(): Case[] {
	const base = path.join(ROOT, 'tests/fixtures/storage');
	return fs
		.readdirSync(base, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => {
			const files: string[] = [];
			const walk = (rel: string): void => {
				for (const e of fs.readdirSync(path.join(base, d.name, rel), { withFileTypes: true })) {
					const p = rel === '' ? e.name : `${rel}/${e.name}`;
					if (e.isDirectory()) walk(p);
					else files.push(p);
				}
			};
			walk('');
			const entry = files.filter((f) => f.endsWith('.tjp')).sort()[0] ?? '';
			return { id: `storage/${d.name}`, root: `tests/fixtures/storage/${d.name}`, entry, files };
		});
}

const cases = [...goldenPlans(), ...storagePlans()];

describe('the corpus through the folder provider (13.1, M7)', () => {
	it.each(cases.map((c) => [c.id, c] as const))(
		'%s: read back byte for byte; an edit of one file leaves the others untouched',
		async (_id, c) => {
			const disk = new FakeFs('plan', { step: 1000 });
			const raw = new Map<string, Uint8Array>();
			for (const f of c.files) {
				const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, c.root, f)));
				raw.set(f, bytes);
				disk.put(f, bytes);
			}
			const handles = memoryHandles();
			handles.map.set('h', disk.root);
			const loc: FolderLocation = { kind: 'folder', handle: 'h', name: 'plan' };
			const p = createFolderProvider({ handles });

			const snap = await p.read(loc);
			const plan = [...raw.keys()].filter((f) => f.endsWith('.tjp') || f.endsWith('.tji'));
			expect([...snap.files.keys()].sort()).toEqual(plan.sort());
			for (const f of plan) expect([...snap.files.get(f)!], f).toEqual([...raw.get(f)!]);
			const base = decodeSnapshot(snap);
			// Only the two files made with invalid bytes decode lossy.
			const invalid = [INVALID_UTF8_FILE, 'tests/fixtures/storage/invalid-utf8/notes.tji'];
			for (const f of base.lossy) expect(invalid).toContain(`${c.root}/${f}`);

			// Open, edit the entry, save what changed.
			const before = disk.paths().map((f) => [f, disk.stamp(f), [...disk.bytes(f)!]] as const);
			const ws = new Map(base.files);
			const edited = `${ws.get(c.entry) ?? ''}# edited\n`;
			ws.set(c.entry, edited);
			const changed = new Map([...ws].filter(([f, t]) => base.files.get(f) !== t));
			expect([...changed.keys()]).toEqual([c.entry]);
			const r = await p.write(loc, {
				base: snap.revision,
				files: encodeFiles(changed),
				message: null,
			});
			expect(r.status).toBe('written');
			for (const [f, stamp, bytes] of before) {
				if (f === c.entry) continue;
				expect(disk.stamp(f), f).toEqual(stamp);
				expect([...disk.bytes(f)!], f).toEqual(bytes);
			}
			expect([...disk.bytes(c.entry)!]).toEqual([...encodePlanFile(edited)]);
			expect(await p.head(loc)).toBe(r.status === 'written' ? r.revision : '');
		},
	);

	it('covers every golden plan and every storage fixture', () => {
		expect(cases.length).toBeGreaterThanOrEqual(goldenPlans().length + 4);
	});

	it('lists every plan-like name in any case, and nothing in .git', async () => {
		const disk = new FakeFs('d');
		for (const f of ['a.tjp', 'b/C.TJI', 'notes.Tjp', 'readme.md', '.git/x.tji']) disk.put(f, 'x');
		const handles = memoryHandles();
		handles.map.set('h', disk.root);
		const p = createFolderProvider({ handles });
		expect(await p.planNames({ kind: 'folder', handle: 'h', name: 'd' })).toEqual([
			'a.tjp',
			'b/C.TJI',
			'notes.Tjp',
		]);
	});
});
