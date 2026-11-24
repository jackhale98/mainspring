// SPDX-License-Identifier: GPL-2.0-or-later
// What the folder provider never overwrites (phase-4.md 7.2, 8.1 #2 and #4; T5 review H1, L1, L2,
// M3, M4), on the in-memory File System Access fake, whose clock stands still unless moved (a write
// and an edit of the same size have the same stamp, as on a FAT disk or a network share):
// - on a case-insensitive disk an added path never opens a file of another case (`Plan.tjp`,
//   `notes.TJI`); paths that differ only by case are refused; on a case-sensitive disk they are
//   separate files;
// - a path through `.git`, or one whose folder is a file, is refused before anything is written;
// - a file is compared with what was read, content and all, right before it is overwritten: a change
//   on disk with the same stamp, or one made while another file was being written, is `moved`, and
//   that file is not written; what was read is remembered across a new provider (a reload);
// - files that exist are written before added ones, so a failed added file leaves the others done
//   (its own empty file is the residual case of types.ts's contract note).
import { describe, expect, it, vi } from 'vitest';
import { decodeSnapshot } from './codec';
import { createFolderProvider } from './folder';
import { FakeFs, memoryHandles } from './testing/fake-fsa';
import type { FolderLocation, WriteRequest } from './types';

const enc = new TextEncoder();
const text = (s: string): Uint8Array => enc.encode(s);
const str = (b: Uint8Array | null): string | null => (b ? new TextDecoder().decode(b) : null);

function at(fs: FakeFs, handles = memoryHandles()) {
	handles.map.set('h', fs.root);
	const loc: FolderLocation = { kind: 'folder', handle: 'h', name: fs.root.name };
	const p = createFolderProvider({ handles });
	const write = async (files: Record<string, string>, base?: string) =>
		p.write(loc, {
			base: base ?? (await p.head(loc)) ?? '',
			files: new Map(Object.entries(files).map(([k, v]) => [k, text(v)])),
			message: null,
		} satisfies WriteRequest);
	return { p, loc, handles, write };
}

describe('case (H1)', () => {
	it('on a case-insensitive disk, an added path never opens a file of another case', async () => {
		const fs = new FakeFs('d', { caseInsensitive: true });
		fs.put('Plan.tjp', 'theirs');
		fs.put('notes.TJI', 'theirs too');
		fs.put('Parts/a.tji', 'kept');
		const { write } = at(fs);
		for (const path of ['plan.tjp', 'notes.tji', 'parts/A.tji']) {
			const r = await write({ [path]: 'mine' });
			expect(r.status, path).toBe('moved');
		}
		expect(str(fs.bytes('Plan.tjp'))).toBe('theirs');
		expect(str(fs.bytes('notes.TJI'))).toBe('theirs too');
		expect(str(fs.bytes('Parts/a.tji'))).toBe('kept');
		expect(fs.closes).toBe(0);
		// A new file in a folder that is there under another case goes into it.
		expect((await write({ 'parts/new.tji': 'mine' })).status).toBe('written');
		expect(str(fs.bytes('Parts/new.tji'))).toBe('mine');
	});

	it('on a case-sensitive disk, the same paths are other files and are written', async () => {
		const fs = new FakeFs('d');
		fs.put('Plan.tjp', 'theirs');
		fs.put('notes.TJI', 'theirs too');
		const { write } = at(fs);
		expect((await write({ 'plan.tjp': 'mine', 'notes.tji': 'mine' })).status).toBe('written');
		expect(str(fs.bytes('Plan.tjp'))).toBe('theirs');
		expect(str(fs.bytes('plan.tjp'))).toBe('mine');
		expect(str(fs.bytes('notes.TJI'))).toBe('theirs too');
	});

	it.each([false, true])(
		'refuses paths that differ only by case, writing nothing (case-insensitive: %s)',
		async (caseInsensitive) => {
			const fs = new FakeFs('d', { caseInsensitive });
			const { write } = at(fs);
			const r = await write({ 'ok.tjp': 'a', 'Ok.tjp': 'b' });
			expect(r).toMatchObject({
				status: 'failed',
				error: { kind: 'server', detail: 'folder: case' },
			});
			expect(fs.paths()).toEqual([]);
		},
	);
});

describe('paths (L1, L2)', () => {
	it('refuses a path through .git, writing nothing', async () => {
		const fs = new FakeFs('d');
		fs.put('a.tji', 'a');
		const { write } = at(fs);
		const r = await write({ 'a.tji': 'changed', '.git/x.tji': 'x' });
		expect(r).toMatchObject({ status: 'failed', error: { detail: 'folder: not a plan file' } });
		expect(str(fs.bytes('a.tji'))).toBe('a');
		expect(fs.closes).toBe(0);
	});

	it('refuses, before writing anything, a path whose folder is a file', async () => {
		const fs = new FakeFs('d');
		fs.put('a.tji', 'a');
		fs.put('parts', 'a file, not a folder');
		const { write } = at(fs);
		const r = await write({ 'a.tji': 'changed', 'parts/x.tji': 'x' });
		expect(r).toMatchObject({ status: 'failed', error: { detail: 'folder: TypeMismatchError' } });
		expect(str(fs.bytes('a.tji'))).toBe('a');
		expect(fs.closes).toBe(0);
	});
});

describe('content before an overwrite (M3)', () => {
	it('refuses to overwrite a file changed on disk with the same size and time', async () => {
		const fs = new FakeFs('d');
		fs.put('x.tji', 'xxxx');
		const { p, loc, write } = at(fs);
		const read = await p.read(loc);
		// Another program writes 4 bytes within the same tick of a coarse clock: the same stamp.
		fs.put('x.tji', 'yyyy');
		expect(await p.head(loc)).toBe(read.revision);
		const r = await write({ 'x.tji': 'mine' }, read.revision);
		expect(r.status).toBe('moved');
		expect(str(fs.bytes('x.tji'))).toBe('yyyy');
	});

	it('refuses to overwrite a file changed while another file was being written', async () => {
		const fs = new FakeFs('d');
		fs.put('a.tji', 'a');
		fs.put('b.tji', 'b');
		const { p, loc, write } = at(fs);
		const read = await p.read(loc);
		fs.afterClose = (name) => {
			if (name === 'a.tji') fs.put('b.tji', 'B');
		};
		const r = await write({ 'a.tji': 'mine a', 'b.tji': 'mine b' }, read.revision);
		expect(r).toEqual({ status: 'moved', head: await p.head(loc), commit: null });
		// The file before it is written; the one changed on disk keeps the change.
		expect(str(fs.bytes('a.tji'))).toBe('mine a');
		expect(str(fs.bytes('b.tji'))).toBe('B');
	});

	it('remembers what it read across a new provider on the same store (a reload)', async () => {
		const fs = new FakeFs('d');
		fs.put('x.tji', 'xxxx');
		const handles = memoryHandles();
		const first = at(fs, handles);
		const read = await first.p.read(first.loc);
		fs.put('x.tji', 'yyyy');
		const second = at(fs, handles);
		expect((await second.write({ 'x.tji': 'mine' }, read.revision)).status).toBe('moved');
		expect(str(fs.bytes('x.tji'))).toBe('yyyy');
	});

	it('knows the content it wrote, so the next write on its revision goes through', async () => {
		const fs = new FakeFs('d');
		fs.put('x.tji', 'xxxx');
		const { p, loc, write } = at(fs);
		const read = await p.read(loc);
		const one = await write({ 'x.tji': 'one!' }, read.revision);
		expect(one.status).toBe('written');
		if (one.status !== 'written') return;
		expect((await write({ 'x.tji': 'two' }, one.revision)).status).toBe('written');
		expect(str(fs.bytes('x.tji'))).toBe('two');
		// The same text read back decodes as written.
		expect(decodeSnapshot(await p.read(loc)).files.get('x.tji')).toBe('two');
	});
});

describe('added files (M4)', () => {
	it('writes the files that exist first; a failed added file leaves them written', async () => {
		const fs = new FakeFs('d');
		fs.put('b.tji', 'b');
		const { p, loc, write } = at(fs);
		const read = await p.read(loc);
		let closes = 0;
		const real = fs.fault.bind(fs);
		vi.spyOn(fs, 'fault').mockImplementation((op) => {
			if (op === 'close' && ++closes === 2) throw new DOMException('full', 'QuotaExceededError');
			real(op);
		});
		const r = await write({ 'a-new.tji': 'added', 'b.tji': 'changed' }, read.revision);
		expect(r).toMatchObject({ status: 'failed', error: { kind: 'quota' } });
		expect(str(fs.bytes('b.tji'))).toBe('changed');
		// The residual case (types.ts, contract notes T5): the added file exists, empty.
		expect(str(fs.bytes('a-new.tji'))).toBe('');
	});
});
