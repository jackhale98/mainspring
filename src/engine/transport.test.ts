// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { FromWorker } from './protocol';
import { FakeWorker } from './testing/fake-worker';
import { createDefaultWorker, describeThrown, describeWorkerError, listen, send } from './transport';

describe('transport', () => {
	it('passes object messages through and non-objects as null', () => {
		const worker = new FakeWorker();
		const messages: Array<FromWorker | null> = [];
		const errors: string[] = [];
		listen(worker, (m) => messages.push(m), (e) => errors.push(e.type));
		worker.boot();
		worker.emitRaw('text');
		worker.emitRaw(null);
		worker.emitError('error');
		worker.emitError('messageerror');
		expect(messages.map((m) => m?.type ?? null)).toEqual(['ready', null, null]);
		expect(errors).toEqual(['error', 'messageerror']);
	});

	it('reports whether a message was sent', () => {
		const worker = new FakeWorker();
		expect(send(null, { type: 'syntax', id: 1 })).toBe(false);
		expect(send(worker, { type: 'syntax', id: 1 })).toBe(true);
		worker.postError = new Error('DataCloneError');
		expect(send(worker, { type: 'syntax', id: 2 })).toBe(false);
		expect(worker.posted).toHaveLength(1);
	});

	it('describes worker error events', () => {
		const error = new Event('error');
		Object.defineProperty(error, 'message', { value: 'RuntimeError: unreachable' });
		expect(describeWorkerError(error)).toEqual({
			reason: 'stopped unexpectedly',
			detail: 'RuntimeError: unreachable',
		});
		expect(describeWorkerError(new Event('messageerror'))).toEqual({
			reason: 'sent a message that could not be read',
		});
	});

	it('describes thrown values', () => {
		expect(describeThrown(new TypeError('bad'))).toEqual({ detail: 'TypeError: bad' });
		expect(describeThrown('oops')).toEqual({ detail: 'oops' });
		expect(describeThrown(undefined)).toEqual({});
	});

	it('needs a Worker global only when the default worker is created', () => {
		expect(typeof globalThis.Worker).toBe('undefined');
		expect(() => createDefaultWorker(undefined)).toThrow(ReferenceError);
	});
});
