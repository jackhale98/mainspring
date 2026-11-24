// SPDX-License-Identifier: GPL-2.0-or-later
// The folder provider's disk helpers (folder-disk.ts): the revision's stamps read back, paths that
// differ only by case, the paths it may write, the lookup that never creates, and the content
// check before an overwrite. The provider's behaviour is folder*.test.ts's.
import { describe, expect, it } from 'vitest';
import {
	caseClash,
	present,
	revisionOf,
	revisionPaths,
	sha256,
	stampsOf,
	unchanged,
	writable,
} from './folder-disk';
import { FakeFs } from './testing/fake-fsa';

describe('folder-disk', () => {
	it('reads its own revisions back, and nothing else', () => {
		const r = revisionOf(
			new Map([
				['b.tji', [2, 20]],
				['a.tjp', [1, 10]],
			]),
		);
		expect([...(stampsOf(r) ?? [])]).toEqual([
			['a.tjp', [1, 10]],
			['b.tji', [2, 20]],
		]);
		expect([...(revisionPaths(r) ?? [])]).toEqual(['a.tjp', 'b.tji']);
		expect(stampsOf('3f2a91b')).toBeNull();
		expect(stampsOf('folder:1:{"a":1}')).toBeNull();
		expect(stampsOf('folder:1:[["a",1]]')).toBeNull();
	});

	it('finds two paths that differ only by case', () => {
		expect(caseClash(['a.tji', 'b.tji', 'parts/x.tji'])).toBeNull();
		expect(caseClash(['ok.tjp', 'b.tji', 'Ok.tjp'])).toEqual(['ok.tjp', 'Ok.tjp']);
		expect(caseClash(['parts/x.tji', 'Parts/x.tji'])).toEqual(['parts/x.tji', 'Parts/x.tji']);
	});

	it('writes only plan files at workspace paths, never through .git', () => {
		expect(writable('plan.tjp')).toBe(true);
		expect(writable('parts/a.tji')).toBe(true);
		expect(writable('notes.txt')).toBe(false);
		expect(writable('plan.TJP')).toBe(false);
		expect(writable('../a.tji')).toBe(false);
		expect(writable('.git/a.tji')).toBe(false);
		expect(writable('x/.git/a.tji')).toBe(false);
	});

	it('looks a path up without creating anything; case as the disk has it', async () => {
		const ci = new FakeFs('d', { caseInsensitive: true });
		ci.put('Parts/A.tji', 'x');
		ci.put('dir.tji/inner.tji', 'x');
		expect(await present(ci.root, 'parts/a.tji')).toBe(true);
		expect(await present(ci.root, 'parts/b.tji')).toBe(false);
		expect(await present(ci.root, 'other/b.tji')).toBe(false);
		// A folder where the file would be is something there.
		expect(await present(ci.root, 'dir.tji')).toBe(true);
		expect(ci.paths()).toEqual(['Parts/A.tji', 'dir.tji/inner.tji']);
		const cs = new FakeFs('d');
		cs.put('Parts/A.tji', 'x');
		cs.put('file', 'x');
		expect(await present(cs.root, 'parts/a.tji')).toBe(false);
		await expect(present(cs.root, 'file/a.tji')).rejects.toMatchObject({
			name: 'TypeMismatchError',
		});
	});

	it('says a file is unchanged only with the base stamp and, when known, the same content', async () => {
		const fs = new FakeFs('d');
		fs.put('x.tji', 'xxxx');
		const h = await fs.root.getFileHandle('x.tji');
		const { size, lastModified } = fs.stamp('x.tji');
		const hash = await sha256(new TextEncoder().encode('xxxx'));
		expect(await unchanged(h, [size, lastModified], [size, lastModified, hash])).toBe(true);
		expect(await unchanged(h, [size, lastModified], undefined)).toBe(true);
		expect(await unchanged(h, [size, lastModified + 1], [size, lastModified, hash])).toBe(false);
		fs.put('x.tji', 'yyyy');
		expect(await unchanged(h, [size, lastModified], [size, lastModified, hash])).toBe(false);
		// Without a digest at that stamp, the stamp is all there is.
		expect(await unchanged(h, [size, lastModified], [size, lastModified - 5, hash])).toBe(true);
	});
});
