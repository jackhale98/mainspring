// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The engine's in-memory WASI file system (browser_wasi_shim):
 *
 * - `/tj`: the engine bundle (TaskJuggler's lib, the stubs, the bridge), read-only;
 * - `/workspace`: writable and empty at boot. The bridge replaces its contents with the request's
 *   files on every schedule (engine/bridge/request.rb `write_workspace`); the runtime also
 *   empties it first, so nothing can leak from one request into the next;
 * - stdin is empty; stdout and stderr go line by line to a log callback.
 *
 * Paths in the bundle are absolute POSIX paths under `/tj/`. Pure: no fetch, no Ruby.
 */
import {
	ConsoleStdout,
	Directory,
	File,
	OpenFile,
	PreopenDirectory,
	type Fd,
	type Inode,
} from '@bjorn3/browser_wasi_shim';

export const BUNDLE_ROOT = '/tj';
export const WORKSPACE_ROOT = '/workspace';

export type LogFn = (stream: 'stdout' | 'stderr', line: string) => void;

export interface EngineFs {
	/** stdin, stdout, stderr, then the preopened `/tj` and `/workspace`. */
	fds: Fd[];
	bundle: PreopenDirectory;
	workspace: PreopenDirectory;
}

/** The path segments of `path` below `root`; throws for anything that is not a clean path. */
export function segmentsUnder(root: string, path: string): string[] {
	const prefix = `${root}/`;
	if (!path.startsWith(prefix) || path.includes('\\') || path.includes('\0')) {
		throw new Error(`not a path under ${root}: ${JSON.stringify(path)}`);
	}
	const segments = path.slice(prefix.length).split('/');
	if (segments.some((s) => s === '' || s === '.' || s === '..')) {
		throw new Error(`not a clean path: ${JSON.stringify(path)}`);
	}
	return segments;
}

/**
 * A directory tree holding `files` (absolute path -> text, all under `root`), encoded as UTF-8.
 * Files are read-only when `readonly` is set.
 */
export function buildTree(
	files: Readonly<Record<string, string>>,
	root: string,
	readonly: boolean,
): Map<string, Inode> {
	// Collect plain maps first, then build Directory objects bottom-up: the shim sets a child
	// directory's parent (used for "..") only for children present when the parent is created.
	type Node = Map<string, Node> | string;
	const top = new Map<string, Node>();
	for (const [path, text] of Object.entries(files)) {
		const segments = segmentsUnder(root, path);
		const name = segments.pop() ?? '';
		let dir = top;
		for (const segment of segments) {
			const next: Node = dir.get(segment) ?? new Map<string, Node>();
			if (typeof next === 'string') throw new Error(`${path}: a parent is a file`);
			dir.set(segment, next);
			dir = next;
		}
		if (dir.has(name)) throw new Error(`${path}: is also a directory`);
		dir.set(name, text);
	}
	const encoder = new TextEncoder();
	const toInodes = (nodes: Map<string, Node>): Map<string, Inode> => {
		const out = new Map<string, Inode>();
		for (const name of [...nodes.keys()].sort()) {
			const node = nodes.get(name) ?? '';
			out.set(
				name,
				typeof node === 'string'
					? new File(encoder.encode(node), { readonly })
					: new Directory(toInodes(node)),
			);
		}
		return out;
	};
	return toInodes(top);
}

/** Sets up the file descriptors for the WASI instance; see the module comment. */
export function createEngineFs(bundleFiles: Readonly<Record<string, string>>, log: LogFn): EngineFs {
	const bundle = new PreopenDirectory(BUNDLE_ROOT, buildTree(bundleFiles, BUNDLE_ROOT, true));
	const workspace = new PreopenDirectory(WORKSPACE_ROOT, new Map());
	const fds: Fd[] = [
		new OpenFile(new File(new Uint8Array(0), { readonly: true })),
		ConsoleStdout.lineBuffered((line) => log('stdout', line)),
		ConsoleStdout.lineBuffered((line) => log('stderr', line)),
		bundle,
		workspace,
	];
	return { fds, bundle, workspace };
}

/** Removes everything in a preopened directory. */
export function clearDirectory(dir: PreopenDirectory): void {
	dir.dir.contents.clear();
}

/** Every file under `dir` as absolute path -> bytes, for diagnostics and tests. */
export function listFiles(dir: Directory, root: string): Map<string, Uint8Array> {
	const out = new Map<string, Uint8Array>();
	const walk = (d: Directory, prefix: string): void => {
		for (const [name, inode] of d.contents) {
			const path = `${prefix}/${name}`;
			if (inode instanceof Directory) walk(inode, path);
			else if (inode instanceof File) out.set(path, inode.data);
		}
	};
	walk(dir, root);
	return out;
}
