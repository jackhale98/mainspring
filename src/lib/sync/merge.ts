// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The workspace merge (phase-4.md 6.4, 8; tjp/merge/types.ts is the contract). Lazy: only the
 * sync controller and the conflict view import it, never a first load (12.1).
 *
 * `mergeFile` (`mergeFileSteps` in steps) applies the table of types.ts to the sides that have
 * the file, and merges a file
 * all three have with tjp/merge/file.ts. `mergeWorkspace` is the same loop over every path of
 * ours, then theirs, then the base, without yielding; conflicts come out by file (code-unit
 * order), then by position. `resolve` is tjp/merge/resolve.ts.
 */
import { drive, mergeTextSteps } from '../tjp/merge/file';
import { hash } from '../tjp/merge/out';
import type {
	FileMerge,
	MergeConflict,
	MergeFileFn,
	MergeFileStepsFn,
	MergeWorkspaceFn,
	ResolveFn,
} from '../tjp/merge/types';
import { resolve as resolveMerge } from '../tjp/merge/resolve';
import type { WorkspacePath } from '../workspace/paths';

const clean = (text: string): FileMerge => ({ text, conflicts: [] });

/** A whole-file conflict (`text` is what the merged file holds). */
function fileConflict(
	file: WorkspacePath,
	change: 'deleted-ours' | 'deleted-theirs' | 'added-twice',
	base: string | null,
	ours: string | null,
	theirs: string | null,
): FileMerge {
	const text = (change === 'deleted-ours' ? theirs : ours) ?? '';
	const c: MergeConflict = {
		id: `${file}#file:${change}@0-${base?.length ?? 0}:${hash(theirs ?? '\u0000none')}`,
		file,
		subject: { kind: 'file', change },
		base,
		ours,
		theirs,
		at: { file, from: 0, to: text.length },
		atOurs: ours === null ? null : { file, from: 0, to: ours.length },
		both: false,
	};
	return { text, conflicts: [c] };
}

/** `mergeFile` in steps (types.ts rule 5): a file all sides have is merged by file.ts's steps. */
export const mergeFileSteps: MergeFileStepsFn = function* (file, base, ours, theirs, ctx) {
	if (ours !== null && theirs !== null && base !== null) {
		return yield* mergeTextSteps(file, base, ours, theirs, ctx);
	}
	return mergeFile(file, base, ours, theirs, ctx);
};

export const mergeFile: MergeFileFn = (file, base, ours, theirs, ctx) => {
	if (ours !== null && theirs !== null) {
		if (base !== null) return drive(mergeTextSteps(file, base, ours, theirs, ctx));
		return ours === theirs ? clean(ours) : fileConflict(file, 'added-twice', null, ours, theirs);
	}
	if (ours !== null) {
		if (base === null || ours === base) return clean(ours);
		return fileConflict(file, 'deleted-theirs', base, ours, null);
	}
	if (theirs !== null) {
		if (base === null || theirs === base) return clean(theirs);
		return fileConflict(file, 'deleted-ours', base, null, theirs);
	}
	return { text: null, conflicts: [] };
};

export const mergeWorkspace: MergeWorkspaceFn = (base, ours, theirs, ctx) => {
	const paths = [...new Set([...ours.keys(), ...theirs.keys(), ...base.keys()])];
	const files = new Map<WorkspacePath, string>();
	const conflicts: MergeConflict[] = [];
	for (const p of paths) {
		const m = mergeFile(p, base.get(p) ?? null, ours.get(p) ?? null, theirs.get(p) ?? null, ctx);
		if (m.text !== null) files.set(p, m.text);
		conflicts.push(...m.conflicts);
	}
	conflicts.sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : x.at.from - y.at.from));
	return { files, conflicts };
};

export const resolve: ResolveFn = resolveMerge;

export { isUnresolved } from '../tjp/merge/types';
