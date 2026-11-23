// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Getting an exported file to the person (phase-4.md 18.20, T18).
 *
 * A picture goes the first way that works: the clipboard, where `ClipboardItem` takes `image/png`
 * (the picture is handed over as a promise, so that Safari keeps the click's permission while the
 * canvas is drawn); on a phone, where there is no clipboard for it, the share sheet if the browser
 * can share a file; else a download. A refused clipboard write (the page not focused, no
 * permission) falls through the same way. A person who closes the share sheet has chosen: nothing
 * is downloaded after that. A file such as the CSV is always a download.
 *
 * The browser is behind `ImageEnv`, so that the order of the ways is tested without one.
 */

export type Delivery = 'copied' | 'shared' | 'downloaded' | 'cancelled';

export interface ImageEnv {
	/** Puts a picture on the clipboard; null where `ClipboardItem` cannot take `image/png`. */
	readonly copy: ((png: Promise<Blob>) => Promise<void>) | null;
	/** The share sheet with a file; null where the browser has none. */
	readonly share: {
		can(file: File): boolean;
		send(file: File): Promise<void>;
	} | null;
	download(blob: Blob, name: string): void;
}

/** Whether a rejection is the person dismissing the share sheet. */
const aborted = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/**
 * Delivers a picture. `png` may still be drawing; a failed drawing rejects from here (after the
 * clipboard has been tried, which fails with it).
 */
export async function deliverImage(
	png: Promise<Blob>,
	name: string,
	opts: { readonly phone: boolean },
	env: ImageEnv,
): Promise<Delivery> {
	if (env.copy) {
		try {
			await env.copy(png);
			return 'copied';
		} catch {
			// Refused, or the drawing failed: the next way (which says if the drawing failed).
		}
	}
	const blob = await png;
	if (opts.phone && env.share) {
		const file = new File([blob], name, { type: 'image/png' });
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

interface ClipboardItemCtor {
	supports?: (type: string) => boolean;
}

/** The browser's ways of delivering a picture. */
export function browserEnv(nav: Navigator = navigator, doc?: Document): ImageEnv {
	const item = (globalThis as { ClipboardItem?: ClipboardItemCtor }).ClipboardItem;
	const canCopy =
		item !== undefined &&
		typeof nav.clipboard?.write === 'function' &&
		(item.supports?.('image/png') ?? true);
	const canShare = typeof nav.share === 'function' && typeof nav.canShare === 'function';
	return {
		copy: canCopy ? (png) => nav.clipboard.write([new ClipboardItem({ 'image/png': png })]) : null,
		share: canShare
			? {
					can: (file) => nav.canShare({ files: [file] }),
					send: (file) => nav.share({ files: [file] }),
				}
			: null,
		download: (blob, name) => downloadBlob(blob, name, doc ?? document),
	};
}
