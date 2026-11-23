// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserEnv, deliverImage, downloadBlob, type ImageEnv } from './deliver';

const PNG = new Blob(['png'], { type: 'image/png' });

interface Spy {
	env: ImageEnv;
	copied: Promise<Blob>[];
	shared: File[];
	downloaded: Array<{ blob: Blob; name: string }>;
}

function spy(
	over: {
		copy?: 'ok' | 'refuse' | 'none';
		share?: 'ok' | 'abort' | 'fail' | 'cannot' | 'none';
	} = {},
): Spy {
	const s: Spy = { env: null as never, copied: [], shared: [], downloaded: [] };
	const copy = over.copy ?? 'ok';
	const share = over.share ?? 'none';
	s.env = {
		copy:
			copy === 'none'
				? null
				: (png) => {
						s.copied.push(png);
						return copy === 'ok'
							? Promise.resolve()
							: Promise.reject(new DOMException('no', 'NotAllowedError'));
					},
		share:
			share === 'none'
				? null
				: {
						can: () => share !== 'cannot',
						send: (file) => {
							s.shared.push(file);
							if (share === 'abort') return Promise.reject(new DOMException('x', 'AbortError'));
							return share === 'fail' ? Promise.reject(new Error('boom')) : Promise.resolve();
						},
					},
		download: (blob, name) => s.downloaded.push({ blob, name }),
	};
	return s;
}

const phone = { phone: true };
const desktop = { phone: false };

describe('deliverImage', () => {
	it('copies where the clipboard takes a picture, handing it over as a promise', async () => {
		const s = spy();
		const png = Promise.resolve(PNG);
		expect(await deliverImage(png, 'a.png', desktop, s.env)).toBe('copied');
		expect(s.copied).toEqual([png]);
		expect(s.downloaded).toEqual([]);
	});

	it('copies on a phone too, before it offers the share sheet', async () => {
		const s = spy({ share: 'ok' });
		expect(await deliverImage(Promise.resolve(PNG), 'a.png', phone, s.env)).toBe('copied');
		expect(s.shared).toEqual([]);
	});

	it('downloads on a desktop where the clipboard cannot take it, and where it refuses', async () => {
		for (const copy of ['none', 'refuse'] as const) {
			const s = spy({ copy, share: 'ok' });
			expect(await deliverImage(Promise.resolve(PNG), 'a.png', desktop, s.env)).toBe('downloaded');
			expect(s.downloaded).toEqual([{ blob: PNG, name: 'a.png' }]);
			expect(s.shared).toEqual([]);
		}
	});

	it('offers a phone the share sheet when the clipboard is no way, with the picture as a file', async () => {
		const s = spy({ copy: 'refuse', share: 'ok' });
		expect(await deliverImage(Promise.resolve(PNG), 'plan-gantt.png', phone, s.env)).toBe('shared');
		expect(s.shared).toHaveLength(1);
		expect(s.shared[0]?.name).toBe('plan-gantt.png');
		expect(s.shared[0]?.type).toBe('image/png');
		expect(s.downloaded).toEqual([]);
	});

	it('downloads on a phone whose browser cannot share this file, or has no share sheet', async () => {
		for (const share of ['cannot', 'none'] as const) {
			const s = spy({ copy: 'none', share });
			expect(await deliverImage(Promise.resolve(PNG), 'a.png', phone, s.env)).toBe('downloaded');
			expect(s.shared).toEqual([]);
		}
	});

	it('does not download after the person closed the share sheet', async () => {
		const s = spy({ copy: 'none', share: 'abort' });
		expect(await deliverImage(Promise.resolve(PNG), 'a.png', phone, s.env)).toBe('cancelled');
		expect(s.downloaded).toEqual([]);
	});

	it('downloads when sharing fails for another reason', async () => {
		const s = spy({ copy: 'none', share: 'fail' });
		expect(await deliverImage(Promise.resolve(PNG), 'a.png', phone, s.env)).toBe('downloaded');
	});

	it('rejects with the drawing’s own error when the picture could not be made', async () => {
		const s = spy({ copy: 'refuse', share: 'ok' });
		const failed = Promise.reject(new Error('the picture could not be encoded'));
		await expect(deliverImage(failed, 'a.png', phone, s.env)).rejects.toThrow(/encoded/);
		expect(s.downloaded).toEqual([]);
		expect(s.shared).toEqual([]);
	});
});

describe('downloadBlob', () => {
	afterEach(() => vi.useRealTimers());

	it('clicks a link to the blob with the file name, then lets the address go', () => {
		vi.useFakeTimers();
		const urls: string[] = [];
		const revoked: string[] = [];
		vi.stubGlobal('URL', {
			createObjectURL: () => (urls.push('blob:x'), 'blob:x'),
			revokeObjectURL: (u: string) => revoked.push(u),
		});
		const clicks: Array<{ href: string; download: string }> = [];
		const body: unknown[] = [];
		const doc = {
			createElement: () => {
				const a = {
					href: '',
					download: '',
					rel: '',
					click: () => clicks.push({ href: a.href, download: a.download }),
					remove: () => undefined,
				};
				return a;
			},
			body: { append: (a: unknown) => body.push(a) },
		} as unknown as Document;
		downloadBlob(PNG, 'p-tasks.csv', doc);
		expect(clicks).toEqual([{ href: 'blob:x', download: 'p-tasks.csv' }]);
		expect(body).toHaveLength(1);
		expect(revoked).toEqual([]);
		vi.advanceTimersByTime(30_000);
		expect(revoked).toEqual(['blob:x']);
		vi.unstubAllGlobals();
	});
});

describe('browserEnv', () => {
	afterEach(() => vi.unstubAllGlobals());

	const nav = (over: Record<string, unknown>): Navigator => over as unknown as Navigator;

	it('has no clipboard way without ClipboardItem, without write, or when image/png is unsupported', () => {
		vi.stubGlobal('ClipboardItem', undefined);
		expect(browserEnv(nav({ clipboard: { write: () => Promise.resolve() } })).copy).toBeNull();
		vi.stubGlobal('ClipboardItem', class {});
		expect(browserEnv(nav({})).copy).toBeNull();
		vi.stubGlobal(
			'ClipboardItem',
			Object.assign(class {}, { supports: (t: string) => t !== 'image/png' }),
		);
		expect(browserEnv(nav({ clipboard: { write: () => Promise.resolve() } })).copy).toBeNull();
	});

	it('writes one ClipboardItem of image/png with the promise', async () => {
		const items: Array<Record<string, Promise<Blob>>> = [];
		vi.stubGlobal(
			'ClipboardItem',
			class {
				constructor(public parts: Record<string, Promise<Blob>>) {
					items.push(parts);
				}
			},
		);
		const written: unknown[][] = [];
		const env = browserEnv(
			nav({
				clipboard: {
					write: (list: unknown[]) => {
						written.push(list);
						return Promise.resolve();
					},
				},
			}),
		);
		const png = Promise.resolve(PNG);
		await env.copy?.(png);
		expect(written).toHaveLength(1);
		expect(Object.keys(items[0] ?? {})).toEqual(['image/png']);
		expect(items[0]?.['image/png']).toBe(png);
	});

	it('has the share sheet only with both share and canShare, asking canShare about the file', () => {
		vi.stubGlobal('ClipboardItem', undefined);
		expect(browserEnv(nav({ share: () => Promise.resolve() })).share).toBeNull();
		const asked: unknown[] = [];
		const env = browserEnv(
			nav({
				share: () => Promise.resolve(),
				canShare: (d: unknown) => (asked.push(d), true),
			}),
		);
		const file = new File(['x'], 'a.png', { type: 'image/png' });
		expect(env.share?.can(file)).toBe(true);
		expect(asked).toEqual([{ files: [file] }]);
	});
});
