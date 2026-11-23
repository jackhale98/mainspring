// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Getting an exported file to the person (phase-4.md 18.20, T18).
 *
 * A picture goes the first way that works: the clipboard (already being written, started in the
 * click itself by `clipboard.ts`, because Safari allows it nowhere else); where that is no way, on
 * a phone the share sheet if the browser can share the file; else a download. A refused clipboard
 * write falls through the same way. A person who closes the share sheet has chosen: nothing is
 * downloaded after that. The CSV has no clipboard way: on a phone the share sheet if it can share
 * the file, else a download.
 *
 * The browser is behind `ImageEnv`, so that the order of the ways is tested without one.
 */

export type Delivery = 'copied' | 'shared' | 'downloaded' | 'cancelled';

export interface ImageEnv {
	/** The share sheet with a file; null where the browser has none. */
	readonly share: {
		can(file: File): boolean;
		send(file: File): Promise<void>;
	} | null;
	download(blob: Blob, name: string): void;
}

/** Whether a rejection is the person dismissing the share sheet. */
const aborted = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/** A file to a phone's share sheet when it can take it, else to a download. */
export async function deliverFile(
	blob: Blob,
	name: string,
	opts: { readonly phone: boolean },
	env: ImageEnv,
): Promise<Delivery> {
	if (opts.phone && env.share) {
		const file = new File([blob], name, { type: blob.type });
		if (env.share.can(file)) {
			try {
				await env.share.send(file);
				return 'shared';
			} catch (e) {
				if (aborted(e)) return 'cancelled';
			}
		}
	}
	env.download(blob, name);
	return 'downloaded';
}

/**
 * Delivers a picture. `copying` is the clipboard write that was started with the click (null where
 * the clipboard cannot take a picture). `png` may still be drawing: a failed drawing rejects from
 * here, after the clipboard has been tried (which fails with it).
 */
export async function deliverImage(
	png: Promise<Blob>,
	copying: Promise<boolean> | null,
	name: string,
	opts: { readonly phone: boolean },
	env: ImageEnv,
): Promise<Delivery> {
	if (copying && (await copying)) return 'copied';
	return deliverFile(await png, name, opts, env);
}

/** Saves a blob under a name, as a click on a link to it would. */
export function downloadBlob(blob: Blob, name: string, doc: Document = document): void {
	const url = URL.createObjectURL(blob);
	const a = doc.createElement('a');
	a.href = url;
	a.download = name;
	a.rel = 'noopener';
	doc.body.append(a);
	a.click();
	a.remove();
	// The browser has started the save by the time the task ends; the address can go a while after.
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** The browser's ways of delivering a file. */
export function browserEnv(nav: Navigator = navigator, doc?: Document): ImageEnv {
	const canShare = typeof nav.share === 'function' && typeof nav.canShare === 'function';
	return {
		share: canShare
			? {
					can: (file) => nav.canShare({ files: [file] }),
					send: (file) => nav.share({ files: [file] }),
				}
			: null,
		download: (blob, name) => downloadBlob(blob, name, doc ?? document),
	};
}
