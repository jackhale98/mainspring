// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pub = (p: string): URL => new URL(`../../../public/${p}`, import.meta.url);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: URL): [number, number] {
	const b = readFileSync(file);
	expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
	return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('web manifest', () => {
	const manifest = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8')) as {
		start_url: string;
		scope: string;
		icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
	};

	it('uses relative URLs, so it works under the Pages base path', () => {
		expect(manifest.start_url.startsWith('/')).toBe(false);
		expect(manifest.scope.startsWith('/')).toBe(false);
		for (const i of manifest.icons) expect(i.src.startsWith('/')).toBe(false);
	});

	it('lists icons that exist at their stated sizes, including a maskable one', () => {
		for (const i of manifest.icons) {
			expect(existsSync(pub(i.src)), i.src).toBe(true);
			if (i.type === 'image/png') {
				const [w, h] = pngSize(pub(i.src));
				expect(`${w}x${h}`).toBe(i.sizes);
			}
		}
		expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
		expect(pngSize(pub('icons/apple-touch-icon.png'))).toEqual([180, 180]);
	});
});
