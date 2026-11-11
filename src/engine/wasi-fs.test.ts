// SPDX-License-Identifier: GPL-2.0-or-later
import { Directory, File, OpenFile, wasi } from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';
import {
	BUNDLE_ROOT,
	WORKSPACE_ROOT,
	buildTree,
	clearDirectory,
	createEngineFs,
	listFiles,
	segmentsUnder,
} from './wasi-fs';

const files = {
	'/tj/lib/taskjuggler/Task.rb': 'class Task; end\n',
	'/tj/lib/tj3.rb': '# tj3\n',
	'/tj/bridge/tj_bridge.rb': 'module TJBridge; end\n',
	'/tj/bridge/wasm/tj_wasm_tz.rb': '# tz é\n',
	'/tj/COPYING': 'GPL\n',
};

const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

describe('segmentsUnder', () => {
	it('splits clean paths under the root', () => {
		expect(segmentsUnder('/tj', '/tj/lib/a.rb')).toEqual(['lib', 'a.rb']);
	});

	it.each(['/tjx/a', 'tj/a', '/tj/', '/tj//a', '/tj/./a', '/tj/../a', '/tj/a\\b', '/tj/a\0'])(
		'rejects %j',
		(path) => {
			expect(() => segmentsUnder('/tj', path)).toThrow();
		},
	);
});

describe('buildTree', () => {
	it('nests directories and encodes text as UTF-8', () => {
		const tree = buildTree(files, BUNDLE_ROOT, true);
		expect([...tree.keys()]).toEqual(['COPYING', 'bridge', 'lib']);
		const all = listFiles(new Directory(tree), BUNDLE_ROOT);
		expect([...all.keys()].sort()).toEqual(Object.keys(files).sort());
		expect(text(all.get('/tj/bridge/wasm/tj_wasm_tz.rb'))).toBe('# tz é\n');
	});

	it('links child directories to their parent', () => {
		const tree = buildTree(files, BUNDLE_ROOT, true);
		const lib = tree.get('lib');
		const top = new Directory(tree);
		expect(lib).toBeInstanceOf(Directory);
		const inner = (lib as Directory).contents.get('taskjuggler') as Directory;
		expect(inner.parent_ino()).toBe(lib?.ino);
		expect((lib as Directory).parent_ino()).toBe(top.ino);
	});

	it('makes files read-only on request', () => {
		const readonly = buildTree({ '/tj/a': 'x' }, BUNDLE_ROOT, true).get('a') as File;
		const writable = buildTree({ '/w/a': 'x' }, '/w', false).get('a') as File;
		expect(readonly.readonly).toBe(true);
		expect(writable.readonly).toBe(false);
		const rights = BigInt(wasi.RIGHTS_FD_WRITE);
		expect(readonly.path_open(0, rights, 0).ret).toBe(wasi.ERRNO_PERM);
		expect(writable.path_open(0, rights, 0).ret).toBe(wasi.ERRNO_SUCCESS);
	});

	it('rejects a file that is also a directory', () => {
		expect(() => buildTree({ '/tj/a': 'x', '/tj/a/b': 'y' }, BUNDLE_ROOT, true)).toThrow();
		expect(() => buildTree({ '/tj/a/b': 'y', '/tj/a': 'x' }, BUNDLE_ROOT, true)).toThrow();
	});
});

describe('createEngineFs', () => {
	it('preopens /tj and an empty /workspace after stdio', () => {
		const lines: string[] = [];
		const fs = createEngineFs(files, (stream, line) => lines.push(`${stream}:${line}`));
		expect(fs.fds).toHaveLength(5);
		expect(fs.fds[3]).toBe(fs.bundle);
		expect(fs.fds[4]).toBe(fs.workspace);
		expect(fs.bundle.prestat_name).toBe(BUNDLE_ROOT);
		expect(fs.workspace.prestat_name).toBe(WORKSPACE_ROOT);
		expect(fs.workspace.dir.contents.size).toBe(0);

		const opened = fs.bundle.path_open(0, 'lib/tj3.rb', 0, BigInt(wasi.RIGHTS_FD_READ), 0n, 0);
		expect(opened.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(text((opened.fd_obj as OpenFile).fd_read(100).data)).toBe('# tj3\n');

		const out = new TextEncoder().encode('one\ntwo\npartial');
		fs.fds[1]?.fd_write(out);
		fs.fds[2]?.fd_write(new TextEncoder().encode('err\n'));
		expect(lines).toEqual(['stdout:one', 'stdout:two', 'stderr:err']);
	});

	it('lets Ruby create files in /workspace, and clearDirectory empties it', () => {
		const fs = createEngineFs(files, () => {});
		expect(fs.workspace.path_create_directory('sub')).toBe(wasi.ERRNO_SUCCESS);
		const created = fs.workspace.path_open(
			0,
			'sub/plan.tjp',
			wasi.OFLAGS_CREAT,
			BigInt(wasi.RIGHTS_FD_WRITE),
			0n,
			0,
		);
		expect(created.ret).toBe(wasi.ERRNO_SUCCESS);
		(created.fd_obj as OpenFile).fd_write(new TextEncoder().encode('project'));
		expect(text(listFiles(fs.workspace.dir, WORKSPACE_ROOT).get('/workspace/sub/plan.tjp'))).toBe(
			'project',
		);
		clearDirectory(fs.workspace);
		expect(listFiles(fs.workspace.dir, WORKSPACE_ROOT).size).toBe(0);
	});
});
