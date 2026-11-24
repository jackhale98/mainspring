// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Bytes and text of plan files (phase-4.md 6.2, 18.11; ADR-0002 #13, ADR-0003 #1 amended): the
 * only place where bytes become text and text becomes bytes (store-types.ts, "Text in the store,
 * bytes at providers").
 *
 * - **Decoding** is ADR-0002 #13's: UTF-8, invalid sequences replaced by U+FFFD, a BOM kept as
 *   U+FEFF (the bridge strips it), '\r' kept. `lossy` says that something was replaced.
 * - **Encoding** is UTF-8 with nothing added or dropped, so `encode(decode(b).text)` is `b` byte for
 *   byte whenever `decode(b).lossy` is false, and `decode(encode(s)).text` is `s` for every
 *   well-formed string.
 * - **Invalid bytes** (18.11). A lossy file cannot be written back as it was read. A file whose text
 *   is unchanged is never written (6.2), so its bytes stay as they are where it lives. A changed one
 *   asks first: `lossyChanged` names those files, which the save flow asks about (T7, T14); here the
 *   flag is only carried, in `DecodedFiles.lossy`.
 *
 * Only providers, imports and exports call it, so it is not part of a first load.
 */
import type { DecodedFiles, DecodePlanFile, EncodePlanFile } from './store-types';
import type { RemoteSnapshot, WorkspacePath } from './types';

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const loose = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

export const decodePlanFile: DecodePlanFile = (bytes) => {
	try {
		return { text: strict.decode(bytes), lossy: false };
	} catch {
		return { text: loose.decode(bytes), lossy: true };
	}
};

export const encodePlanFile: EncodePlanFile = (text) => encoder.encode(text);

/** A provider's snapshot as text (`SyncBase` and `StoredConflict.theirs` are made of this). */
export function decodeSnapshot(s: Pick<RemoteSnapshot, 'revision' | 'files'>): DecodedFiles {
	const files = new Map<WorkspacePath, string>();
	const lossy = new Set<WorkspacePath>();
	for (const [path, bytes] of s.files) {
		const d = decodePlanFile(bytes);
		files.set(path, d.text);
		if (d.lossy) lossy.add(path);
	}
	return { revision: s.revision, files, lossy };
}

/** Text as the bytes to write (`WriteRequest.files`). */
export function encodeFiles(
	files: ReadonlyMap<WorkspacePath, string>,
): Map<WorkspacePath, Uint8Array> {
	return new Map([...files].map(([path, text]) => [path, encodePlanFile(text)]));
}

/**
 * The files of `files` that had invalid bytes when read (`read.lossy`) and whose text is no longer
 * the text read: saving them puts U+FFFD where those bytes were, so the save asks first (18.11).
 * An unchanged lossy file is not listed: it is never written.
 */
export function lossyChanged(
	read: DecodedFiles,
	files: ReadonlyMap<WorkspacePath, string>,
): WorkspacePath[] {
	return [...read.lossy].filter((p) => files.has(p) && files.get(p) !== read.files.get(p));
}
