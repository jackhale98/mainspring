// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Workspace paths (phase-1.md 5.4 `include`, 6.2; engine protocol `WorkspacePath`): POSIX,
 * relative to the workspace root, with no leading '/', no '.' or '..' segments, no empty segments
 * and no backslashes.
 *
 * `resolveIncludePath` follows TaskJuggler's `TextParser::Scanner#include`
 * (engine/tj/lib/taskjuggler/TextParser/Scanner.rb:318-352) and `rule_includeFileName`
 * (TjpSyntaxRules.rb:1953-1962):
 *
 * - the name must end in `.tji` (checked first: TaskJuggler raises `bad_include_suffix` before it
 *   opens anything);
 * - a name that starts with '/' is absolute. The engine writes the workspace into its own file
 *   system, so an absolute name never names a workspace file (`outside-workspace`);
 * - any other name is relative to the directory of the including file (`dirname + '/' + name`);
 * - the operating system resolves '.' and '..'. Like it, a '..' must follow a directory that
 *   exists, and it may not climb above the workspace root (`outside-workspace`).
 */
import type { WorkspacePath } from '../../engine/protocol';

export type { WorkspacePath };

/** Why an include name does not resolve to a workspace path. */
export type PathProblem = 'bad-suffix' | 'outside-workspace' | 'not-found';

/** True for a valid workspace path (see the module comment). */
export function isWorkspacePath(p: string): boolean {
	if (p === '' || p.includes('\\') || p.includes('\0')) return false;
	return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Throws unless `p` is a valid workspace path. */
export function assertWorkspacePath(p: string): WorkspacePath {
	if (!isWorkspacePath(p)) throw new Error(`invalid workspace path: ${JSON.stringify(p)}`);
	return p;
}

/** The directory part of a workspace path ('' at the root), as Ruby's `File.dirname` minus '.'. */
export function dirname(p: WorkspacePath): string {
	const i = p.lastIndexOf('/');
	return i < 0 ? '' : p.slice(0, i);
}

/** The last segment of a path. */
export function basename(p: WorkspacePath): string {
	return p.slice(p.lastIndexOf('/') + 1);
}

/** True when the path names an included file (`.tji`), as `rule_includeFileName` checks. */
export function hasIncludeSuffix(name: string): boolean {
	return name.endsWith('.tji');
}

/** True for a project file (`.tjp`), the kind of file a workspace schedules. */
export function isProjectFile(p: WorkspacePath): boolean {
	return p.endsWith('.tjp');
}

export type ResolvedPath =
	| { readonly ok: true; readonly path: WorkspacePath }
	| { readonly ok: false; readonly problem: PathProblem };

/** What the resolver may ask about the workspace. */
export interface PathLookup {
	/** Whether a file exists at this path. */
	file(p: WorkspacePath): boolean;
	/** Whether a directory exists: some file lies under it. `dir` has no trailing '/'. */
	dir(dir: string): boolean;
}

/** A lookup over a set of file paths; directories are the parents of those files. */
export function pathLookup(paths: Iterable<WorkspacePath>): PathLookup {
	const files = new Set(paths);
	const dirs = new Set<string>(['']);
	for (const f of files) {
		for (let i = f.indexOf('/'); i >= 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i));
	}
	return { file: (p) => files.has(p), dir: (d) => dirs.has(d) };
}

/** Resolves the name written in an `include` statement of file `from` (module comment). */
export function resolveIncludePath(
	from: WorkspacePath,
	name: string,
	lookup: PathLookup,
): ResolvedPath {
	if (!hasIncludeSuffix(name)) return { ok: false, problem: 'bad-suffix' };
	if (name.startsWith('/')) return { ok: false, problem: 'outside-workspace' };
	const dir = dirname(from);
	const segments = dir === '' ? [] : dir.split('/');
	const parts = name.split('/');
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i] ?? '';
		if (i === parts.length - 1) {
			if (part === '' || part === '.' || part === '..') return { ok: false, problem: 'not-found' };
			segments.push(part);
		} else if (part === '..') {
			if (segments.length === 0) return { ok: false, problem: 'outside-workspace' };
			if (!lookup.dir(segments.join('/'))) return { ok: false, problem: 'not-found' };
			segments.pop();
		} else if (part !== '' && part !== '.') {
			segments.push(part);
		}
	}
	const path = segments.join('/');
	if (!isWorkspacePath(path) || !lookup.file(path)) return { ok: false, problem: 'not-found' };
	return { ok: true, path };
}
