// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The one part of the export that a first load carries (phase-4.md 12.1, T18): the clipboard write
 * of the picture. Safari lets a page write to the clipboard only from the click that asked for it,
 * so the write is made in the same tick as the menu's click, before the export's code has even been
 * fetched: the `ClipboardItem` holds a promise of the picture, which the browser waits for while it
 * is being drawn. Everything else (the drawing, the other ways to deliver, the words) is the lazy
 * chunk `run-export.ts`.
 */

interface ClipboardItemCtor {
	supports?: (type: string) => boolean;
}

/**
 * Starts writing a picture to the clipboard, synchronously. Resolves true once it is there, false
 * when the browser refused (or the picture failed); null where `ClipboardItem` cannot take
 * `image/png` at all. It never rejects.
 */
export function copyImage(png: Promise<Blob>, nav: Navigator = navigator): Promise<boolean> | null {
	const item = (globalThis as { ClipboardItem?: ClipboardItemCtor }).ClipboardItem;
	if (
		item === undefined ||
		typeof nav.clipboard?.write !== 'function' ||
		item.supports?.('image/png') === false
	)
		return null;
	try {
		return nav.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
			() => true,
			() => false,
		);
	} catch {
		return Promise.resolve(false);
	}
}
