// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserEnv, deliverFile, deliverImage, downloadBlob, type ImageEnv } from './deliver';

const PNG = new Blob(['png'], { type: 'image/png' });
const CSV = new Blob(['a,b'], { type: 'text/csv;charset=utf-8' });

interface Spy {
	env: ImageEnv;
	shared: File[];
	downloaded: Array<{ blob: Blob; name: string }>;
}

function spy(share: 'ok' | 'abort' | 'fail' | 'cannot' | 'none' = 'none'): Spy {
	const s: Spy = { env: null as never, shared: [], downloaded: [] };
	s.env = {
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
const copied = Promise.resolve(true);
const refused = Promise.resolve(false);

describe('deliverImage', () => {
	it('is copied when the clipboard write that the click started succeeded', async () => {
		const s = spy('ok');
		expect(await deliverImage(Promise.resolve(PNG), copied, 'a.png', phone, s.env)).toBe('copied');
		expect(s.shared).toEqual([]);
		expect(s.downloaded).toEqual([]);
	});

	it('downloads on a desktop where the clipboard cannot take it, and where it refused', async () => {
		for (const copying of [null, refused]) {
			const s = spy('ok');
			expect(await deliverImage(Promise.resolve(PNG), copying, 'a.png', desktop, s.env)).toBe(
				'downloaded',
			);
			expect(s.downloaded).toEqual([{ blob: PNG, name: 'a.png' }]);
			expect(s.shared).toEqual([]);
		}
	});

	it('offers a phone the share sheet when the clipboard is no way, with the picture as a file', async () => {
		const s = spy('ok');
		expect(await deliverImage(Promise.resolve(PNG), refused, 'plan-gantt.png', phone, s.env)).toBe(
			'shared',
		);
		expect(s.shared).toHaveLength(1);
		expect(s.shared[0]?.name).toBe('plan-gantt.png');
		expect(s.shared[0]?.type).toBe('image/png');
		expect(s.downloaded).toEqual([]);
	});

	it('rejects with the drawing’s own error when the picture could not be made', async () => {
		const s = spy('ok');
		const failed = Promise.reject(new Error('the picture could not be encoded'));
		await expect(deliverImage(failed, refused, 'a.png', phone, s.env)).rejects.toThrow(/encoded/);
		expect(s.downloaded).toEqual([]);
		expect(s.shared).toEqual([]);
	});
});

describe('deliverFile', () => {
	it('downloads on a desktop, whatever the browser can share', async () => {
		const s = spy('ok');
		expect(await deliverFile(CSV, 'p-tasks.csv', desktop, s.env)).toBe('downloaded');
		expect(s.downloaded).toEqual([{ blob: CSV, name: 'p-tasks.csv' }]);
		expect(s.shared).toEqual([]);
	});

	it('shares on a phone that can share the file, as the type it has', async () => {
		const s = spy('ok');
		expect(await deliverFile(CSV, 'p-tasks.csv', phone, s.env)).toBe('shared');
		expect(s.shared[0]?.name).toBe('p-tasks.csv');
		expect(s.shared[0]?.type).toBe('text/csv;charset=utf-8');
		expect(s.downloaded).toEqual([]);
	});

	it('downloads on a phone whose browser cannot share this file, or has no share sheet', async () => {
		for (const share of ['cannot', 'none'] as const) {
			const s = spy(share);
			expect(await deliverFile(PNG, 'a.png', phone, s.env)).toBe('downloaded');
			expect(s.shared).toEqual([]);
		}
	});

	it('does not download after the person closed the share sheet', async () => {
		const s = spy('abort');
		expect(await deliverFile(PNG, 'a.png', phone, s.env)).toBe('cancelled');
		expect(s.downloaded).toEqual([]);
	});

	it('downloads when sharing fails for another reason', async () => {
		const s = spy('fail');
		expect(await deliverFile(PNG, 'a.png', phone, s.env)).toBe('downloaded');
	});
});

describe('downloadBlob', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('clicks a link to the blob with the file name, then lets the address go', () => {
		vi.useFakeTimers();
		const revoked: string[] = [];
		vi.stubGlobal('URL', {
			createObjectURL: () => 'blob:x',
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
	});
});

describe('browserEnv', () => {
	const nav = (over: Record<string, unknown>): Navigator => over as unknown as Navigator;

	it('has the share sheet only with both share and canShare, asking canShare about the file', () => {
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
