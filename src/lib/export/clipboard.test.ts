// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyImage } from './clipboard';

const nav = (write: unknown): Navigator => ({ clipboard: { write } }) as unknown as Navigator;

function stubItem(supports?: (t: string) => boolean): Array<Record<string, Promise<Blob>>> {
	const made: Array<Record<string, Promise<Blob>>> = [];
	vi.stubGlobal(
		'ClipboardItem',
		Object.assign(
			class {
				constructor(parts: Record<string, Promise<Blob>>) {
					made.push(parts);
				}
			},
			supports ? { supports } : {},
		),
	);
	return made;
}

afterEach(() => vi.unstubAllGlobals());

describe('copyImage', () => {
	it('calls clipboard.write before it returns, with one item holding the picture’s promise', () => {
		const made = stubItem();
		const calls: unknown[][] = [];
		const write = (list: unknown[]): Promise<void> => (calls.push(list), Promise.resolve());
		const png = new Promise<Blob>(() => undefined);
		// Nothing is awaited: the write has been asked for by the time the call returns, which is
		// what keeps it inside the click that Safari requires (the picture is still being drawn).
		const done = copyImage(png, nav(write));
		expect(calls).toHaveLength(1);
		expect(done).not.toBeNull();
		expect(made).toHaveLength(1);
		expect(Object.keys(made[0] ?? {})).toEqual(['image/png']);
		expect(made[0]?.['image/png']).toBe(png);
	});

	it('resolves true when the write succeeds and false when it is refused', async () => {
		stubItem();
		const ok = copyImage(
			Promise.resolve(new Blob([])),
			nav(() => Promise.resolve()),
		);
		expect(await ok).toBe(true);
		const refused = copyImage(
			Promise.resolve(new Blob([])),
			nav(() => Promise.reject(new DOMException('no', 'NotAllowedError'))),
		);
		expect(await refused).toBe(false);
	});

	it('resolves false, not throws, when write throws at once', async () => {
		stubItem();
		const done = copyImage(
			Promise.resolve(new Blob([])),
			nav(() => {
				throw new Error('x');
			}),
		);
		expect(await done).toBe(false);
	});

	it('is null without ClipboardItem, without write, or when image/png is unsupported', () => {
		vi.stubGlobal('ClipboardItem', undefined);
		expect(
			copyImage(
				Promise.resolve(new Blob([])),
				nav(() => Promise.resolve()),
			),
		).toBeNull();
		stubItem();
		expect(copyImage(Promise.resolve(new Blob([])), nav(undefined))).toBeNull();
		stubItem((t) => t !== 'image/png');
		expect(
			copyImage(
				Promise.resolve(new Blob([])),
				nav(() => Promise.resolve()),
			),
		).toBeNull();
	});
});
