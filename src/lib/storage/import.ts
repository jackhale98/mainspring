// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Opening plan files as a copy (phase-4.md 4, 7.2 "Fallback", 7.4), on every browser: files from
 * `<input type=file multiple>`, or a whole folder (`webkitdirectory`, where it exists). The app
 * makes a browser-only plan of them (state/app-storage.ts `openFiles`). Lazy.
 *
 * - **Paths**: a folder import's `webkitRelativePath` without its first segment (the folder that
 *   was picked), else the file's name. Only plan files whose path is a workspace path are kept
 *   (7.4), none inside `.git` (as the folder provider's walk); a path given twice keeps the first.
 *   Two paths that differ only by case are refused (`case`): macOS and Windows keep one file for
 *   both, so a Save to… or a folder would write one over the other (T5 review H1).
 * - **Limits** (`PLAN_LIMITS`) are checked on the sizes, before any content is read: `too-large`.
 * - **Text** comes from the codec (ADR-0002 #13). `lossy` names the files that had bytes that are
 *   not UTF-8: the plan records them (store-types.ts `StoredPlan.from`), so that Export and Save
 *   to… say that those files will be written with replacement characters before they write them
 *   (18.11; a browser-only plan keeps text, never the bytes it was opened from).
 * - **The entry** is one of the `.tjp` files (`plans`, the shallowest first, then by path); with
 *   several, the caller asks which (18.22). With none, there is no plan (`no-plan`).
 */
import { decodePlanFile } from './codec';
import { caseClash } from './folder-disk';
import { basename, isWorkspacePath } from '../workspace/paths';
import {
	isPlanFile,
	planLimitProblem,
	storageError,
	type StorageError,
	type WorkspacePath,
} from './types';

/** What an opened `File` gives (structural, so tests need no DOM). */
export interface ImportFile {
	readonly name: string;
	readonly webkitRelativePath?: string;
	readonly size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ImportedPlan {
	/** The folder's name for a folder import, else null. */
	readonly folder: string | null;
	readonly files: ReadonlyMap<WorkspacePath, string>;
	/** Files whose bytes were not valid UTF-8 (module comment). */
	readonly lossy: ReadonlySet<WorkspacePath>;
	/** The `.tjp` files, the shallowest first, then by path: the possible entries. */
	readonly plans: readonly WorkspacePath[];
}

export type ImportResult =
	| { readonly kind: 'plan'; readonly plan: ImportedPlan }
	/** No `.tjp` among the files. */
	| { readonly kind: 'no-plan' }
	/** Two paths that differ only by case: one file on macOS and Windows (T5 review H1). */
	| { readonly kind: 'case'; readonly paths: readonly [string, string] }
	/** Past the limits (`too-large`), or a file could not be read. */
	| { readonly kind: 'failed'; readonly error: StorageError };

/** The path a file is imported at (module comment); not checked here. */
export function importPath(f: ImportFile): string {
	const rel = f.webkitRelativePath ?? '';
	const cut = rel.indexOf('/');
	return cut >= 0 ? rel.slice(cut + 1) : f.name;
}

const depth = (p: string): number => p.split('/').length;

/** The `.tjp` files among `paths`, the shallowest first, then by path: a plan's possible entries. */
export function planEntries(paths: Iterable<WorkspacePath>): WorkspacePath[] {
	return [...paths]
		.filter((p) => p.endsWith('.tjp'))
		.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Reads the plan files among `files` (module comment). Never rejects. */
export async function readImport(files: readonly ImportFile[]): Promise<ImportResult> {
	const picked = new Map<WorkspacePath, ImportFile>();
	let folder: string | null = null;
	for (const f of files) {
		const rel = f.webkitRelativePath ?? '';
		if (rel.includes('/')) folder ??= rel.slice(0, rel.indexOf('/'));
		const path = importPath(f);
		const kept = isWorkspacePath(path) && isPlanFile(path) && !path.split('/').includes('.git');
		if (kept && !picked.has(path)) picked.set(path, f);
	}
	const plans = planEntries(picked.keys());
	if (plans.length === 0) return { kind: 'no-plan' };
	const clash = caseClash(picked.keys());
	if (clash) return { kind: 'case', paths: clash };
	const problem = planLimitProblem([...picked.values()].map((f) => f.size));
	if (problem) return { kind: 'failed', error: storageError('too-large', `import: ${problem}`) };
	const texts = new Map<WorkspacePath, string>();
	const lossy = new Set<WorkspacePath>();
	try {
		for (const [path, f] of picked) {
			const d = decodePlanFile(new Uint8Array(await f.arrayBuffer()));
			texts.set(path, d.text);
			if (d.lossy) lossy.add(path);
		}
	} catch (e) {
		const name = (e as { name?: unknown } | null)?.name;
		const n = typeof name === 'string' ? name : 'error';
		return {
			kind: 'failed',
			error: storageError(n === 'NotFoundError' ? 'not-found' : 'server', `import: ${n}`),
		};
	}
	return { kind: 'plan', plan: { folder, files: texts, lossy, plans } };
}

/** What a plan made of opened files is listed as: the folder's name, else the entry's, less `.tjp`. */
export function importName(plan: ImportedPlan, entry: WorkspacePath): string {
	return plan.folder ?? basename(entry).replace(/\.tjp$/, '');
}
