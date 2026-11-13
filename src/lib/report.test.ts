// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { report } from './report';

describe('report', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('rethrows in a microtask, so the caller carries on', () => {
		const queued: Array<() => void> = [];
		vi.stubGlobal('queueMicrotask', (f: () => void) => queued.push(f));
		const error = new Error('boom');
		expect(() => report(error)).not.toThrow();
		expect(queued).toHaveLength(1);
		expect(() => queued[0]?.()).toThrow(error);
	});
});
