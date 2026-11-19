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
 *   check, a stalled fetch) the load settles as failed, the summary shows with no note, and a
 *   hover after the loader's cooldown starts a new load.
 *
 * Once the docs have loaded nothing waits: the source is read as it is. Nor does anything wait
 * while the loader rests after a failed load (`KeywordDocsSource.coolingDown`, a few seconds,
 * engine/docs-asset.ts): a look then shows the summary at once and starts no load.
 */
import type { KeywordDocsSource } from '../syntax/docs';

/** How long a hover, a completion info or the docs command waits for the engine's docs. */
export const DOCS_WAIT_MS = 300;

/**
 * Whether a look should start or join a load of the engine's docs and wait for it: not once they
 * are in, and not while the loader rests after a failed load (`coolingDown`), when it would give
 * null at once anyway.
 */
export const waitsForDocs = (src: KeywordDocsSource): boolean =>
	src.engine === null && src.coolingDown !== true;

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
	if (!waitsForDocs(now)) return Promise.resolve(now);
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
