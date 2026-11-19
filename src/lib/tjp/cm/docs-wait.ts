// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The short wait for the engine's keyword docs (ADR-0017, "Before the docs arrive"). Hover,
 * completion info and the docs command (and so the phone docs sheet) ask for the full docs when
 * they show a keyword. While the docs asset is not in yet they start or join its load
 * (`TjpEnv.loadDocs`) and wait at most `DOCS_WAIT_MS` for it:
 *
 * - docs that arrive within the bound give the full doc at once, on the first hover;
 * - past the bound the committed table's syntax line and summary show, with the loading note
 *   while the load is still running (`KeywordDocView.loading`);
 * - when the docs are unavailable (offline before the first fetch, an old manifest, a failed
 *   check) the load settles as failed, the summary shows with no note, and the next hover starts a
 *   new load (the loader retries after a failure).
 *
 * Once the docs have loaded nothing waits: the source is read as it is.
 */
import type { KeywordDocsSource } from '../syntax/docs';

/** How long a hover, a completion info or the docs command waits for the engine's docs. */
export const DOCS_WAIT_MS = 300;

/** Whether the engine's docs are in, so there is nothing to wait for. */
export const hasEngineDocs = (src: KeywordDocsSource): boolean => src.engine !== null;

/**
 * The docs source once the engine's docs have loaded or failed, or once `bound` ms have passed,
 * whichever is first (module comment). Resolves at once when they are in. Never rejects.
 */
export function docsWithin(
	docs: () => KeywordDocsSource,
	load: () => Promise<unknown>,
	bound: number = DOCS_WAIT_MS,
): Promise<KeywordDocsSource> {
	const now = docs();
	if (hasEngineDocs(now)) return Promise.resolve(now);
	return new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = (): void => {
			clearTimeout(timer);
			resolve(docs());
		};
		timer = setTimeout(done, bound);
		try {
			load().then(done, done);
		} catch {
			done();
		}
	});
}
