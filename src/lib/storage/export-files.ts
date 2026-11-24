// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Exporting a plan's files (phase-4.md 4, 7.2 "Fallback", 18.11): the plan's text as it is now, as
 * files, to keep a copy where Mainspring cannot save in place (a browser-only plan; iOS above all).
 * Lazy: `fflate` (MIT, pinned) is only here.
 *
 * - **One file**: that file under its own name, its bytes from the codec (a BOM and '\r' kept).
 * - **Several**: a `.zip` of every file at its path (the workspace root is the zip's root), named
 *   after the plan as the other exports are (`Plan-plan.zip`, export/file-name.ts).
 * - **Delivery** is T18's (export/deliver.ts): on a phone the share sheet when it can take the file
 *   ("Save to Files" on iOS), else a download.
 * - **Invalid bytes** (18.11): text is all a browser-only plan keeps, so a file that had bytes that
 *   are not UTF-8 is exported with replacement characters. `lossyNames` names those files: the
 *   caller asks first.
 */
import { zipSync } from 'fflate';
import { deliverFile, browserEnv, type Delivery, type ImageEnv } from '../export/deliver';
import { exportFileName } from '../export/file-name';
import { basename } from '../workspace/paths';
import { encodePlanFile } from './codec';
import type { WorkspacePath } from './types';

export interface PlanFiles {
	/** The plan's name, for a zip's file name. */
	readonly name: string;
	readonly entry: WorkspacePath;
	/** Every file's text (the workspace's: included or not). */
	readonly files: ReadonlyMap<WorkspacePath, string>;
}

/** Bytes as a blob part (the codec's and fflate's arrays are on plain `ArrayBuffer`s). */
const part = (b: Uint8Array): BlobPart => b as Uint8Array<ArrayBuffer>;

/** The file an export makes (module comment); `mtime` stamps a zip's entries. */
export function planFile(p: PlanFiles, mtime: Date = new Date()): File {
	const only = p.files.size === 1 ? p.files.get(p.entry) : undefined;
	if (only !== undefined) {
		return new File([part(encodePlanFile(only))], basename(p.entry), { type: 'text/plain' });
	}
	const entries: Record<string, Uint8Array> = {};
	for (const [path, text] of [...p.files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		entries[path] = encodePlanFile(text);
	}
	return new File([part(zipSync(entries, { mtime }))], exportFileName(p.name, 'plan.zip'), {
		type: 'application/zip',
	});
}

/** The files of `lossy` that the export writes (all of them that the plan has): asked about first. */
export function lossyNames(p: PlanFiles, lossy: ReadonlySet<WorkspacePath>): WorkspacePath[] {
	return [...lossy].filter((path) => p.files.has(path)).sort();
}

/** Exports the plan (module comment) and says how it went, with the file's name. */
export async function exportPlanFiles(
	p: PlanFiles,
	o: { readonly phone: boolean; readonly env?: ImageEnv; readonly mtime?: Date },
): Promise<{ readonly delivery: Delivery; readonly name: string }> {
	const file = planFile(p, o.mtime);
	const delivery = await deliverFile(file, file.name, { phone: o.phone }, o.env ?? browserEnv());
	return { delivery, name: file.name };
}
