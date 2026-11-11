// SPDX-License-Identifier: GPL-2.0-or-later
/** Client recovery (spec 3.3 rule 6): crash and timeout restarts, and boot failures. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineRequestError, createEngineClient, type EngineClient, type EngineState } from './client';
import {
	FakeWorker,
	FakeWorkerFactory,
	SYNTAX,
	VERSIONS,
	flush,
	observe,
	makeRequest as req,
	makeResult as res,
} from './testing/fake-worker';

const TIMEOUT = 1_000;

let factory: FakeWorkerFactory;
let client: EngineClient;
let states: EngineState[];

function setup(timeoutMs = TIMEOUT): void {
	factory = new FakeWorkerFactory();
	client = createEngineClient({ transport: factory.create, timeoutMs });
	states = [];
	client.onState((s) => states.push(s));
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	setup();
});

afterEach(() => {
	client.dispose();
	vi.useRealTimers();
});

describe('crash and restart (rule 6)', () => {
	it.each(['error event', 'crash message'] as const)(
		'fails the in-flight request, restarts, and posts the pending one after ready (%s)',
		async (how) => {
			const first = factory.current;
			first.boot();
			const one = client.schedule(req(1));
			const two = client.schedule(req(2));
			if (how === 'error event') first.emitError('error', 'RuntimeError: unreachable');
			else first.emit({ type: 'failed', revision: 1, error: { kind: 'crash', message: 'oom' } });
			const outcome = await one;
			expect(outcome).toMatchObject({ status: 'failed', revision: 1, error: { kind: 'crash' } });
			if (how === 'error event' && outcome.status === 'failed') {
				expect(outcome.error.detail).toBe('RuntimeError: unreachable');
			}
			expect(first.terminated).toBe(true);
			expect(factory.workers).toHaveLength(2);
			expect(client.state).toBe('booting');
			expect(factory.current.posted).toEqual([]);
			factory.current.boot();
			expect(factory.current.postedRevisions()).toEqual([2]);
			factory.current.answerNext();
			await expect(two).resolves.toMatchObject({ status: 'done', latest: true });
			expect(states).toEqual(['idle', 'busy', 'booting', 'busy', 'idle']);
		},
	);

	it('ignores everything the terminated worker sends afterwards', async () => {
		const first = factory.current;
		first.boot();
		const one = client.schedule(req(1));
		first.emitError('messageerror');
		await expect(one).resolves.toMatchObject({ status: 'failed', error: { kind: 'crash' } });
		first.emit({ type: 'scheduled', result: res(1) });
		first.boot();
		first.emitError();
		expect(client.state).toBe('booting');
		expect(factory.workers).toHaveLength(2);
	});

	it('makes ready() wait for the restarted worker', async () => {
		factory.current.boot();
		await client.ready();
		factory.current.emitError();
		const box = observe(client.ready());
		await flush();
		expect(box.value).toBeUndefined();
		factory.current.boot();
		await flush();
		expect(box.value).toEqual(VERSIONS);
	});

	it('restarts on a failure that names no request', async () => {
		factory.current.boot();
		const one = client.schedule(req(1));
		factory.current.emit({ type: 'failed', error: { kind: 'internal', message: 'lost' } });
		await expect(one).resolves.toMatchObject({ status: 'failed', error: { kind: 'internal' } });
		expect(factory.workers).toHaveLength(2);
	});

	it('goes to failed when the restart itself fails', async () => {
		factory.current.boot();
		const one = client.schedule(req(1));
		factory.failNext = new Error('no more workers');
		factory.current.emitError();
		await expect(one).resolves.toMatchObject({ status: 'failed', error: { kind: 'crash' } });
		expect(client.state).toBe('failed');
		await expect(client.ready()).rejects.toMatchObject({ error: { kind: 'boot' } });
		await expect(client.schedule(req(2))).resolves.toMatchObject({
			status: 'failed',
			error: { kind: 'boot', detail: 'Error: no more workers' },
		});
	});

	it('cannot restart a single worker instance, so a crash leaves it failed', async () => {
		client.dispose();
		const worker = new FakeWorker();
		client = createEngineClient({ transport: worker });
		worker.boot();
		const one = client.schedule(req(1));
		const two = client.schedule(req(2));
		worker.emitError();
		await expect(one).resolves.toMatchObject({ status: 'failed', error: { kind: 'crash' } });
		await expect(two).resolves.toMatchObject({ status: 'failed', error: { kind: 'crash' } });
		expect(worker.terminated).toBe(true);
		expect(client.state).toBe('failed');
	});
});

describe('timeout (rule 6)', () => {
	it('terminates a silent worker, fails with timeout, and reboots', async () => {
		factory.current.boot();
		const one = client.schedule(req(1));
		const two = client.schedule(req(2));
		vi.advanceTimersByTime(TIMEOUT - 1);
		expect(factory.workers).toHaveLength(1);
		vi.advanceTimersByTime(1);
		await expect(one).resolves.toMatchObject({ status: 'failed', error: { kind: 'timeout' } });
		expect(factory.workers[0]?.terminated).toBe(true);
		factory.current.boot();
		factory.current.answerNext();
		await expect(two).resolves.toMatchObject({ status: 'done' });
	});

	it('times each reply separately and stops timing when idle', async () => {
		factory.current.boot();
		const docs = client.syntax();
		const one = client.schedule(req(1));
		vi.advanceTimersByTime(TIMEOUT - 10);
		factory.current.answerNext();
		await expect(docs).resolves.toEqual(SYNTAX);
		vi.advanceTimersByTime(TIMEOUT - 10);
		factory.current.answerNext();
		await expect(one).resolves.toMatchObject({ status: 'done' });
		vi.advanceTimersByTime(TIMEOUT * 10);
		expect(factory.workers).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not time the boot, and Infinity turns the watchdog off', () => {
		vi.advanceTimersByTime(TIMEOUT * 10);
		expect(client.state).toBe('booting');
		client.dispose();
		setup(Number.POSITIVE_INFINITY);
		factory.current.boot();
		void client.schedule(req(1));
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([0, -1, Number.NaN])('rejects timeoutMs %s', (timeoutMs) => {
		expect(() => createEngineClient({ transport: factory.create, timeoutMs })).toThrow(RangeError);
	});
});

describe('boot failure', () => {
	it.each(['failed message', 'error event'] as const)(
		'goes to failed and fails everything (%s)',
		async (how) => {
			const versions = client.ready();
			const one = client.schedule(req(1));
			const docs = client.syntax();
			if (how === 'failed message') {
				factory.current.emit({ type: 'failed', error: { kind: 'boot', message: 'hash mismatch' } });
			} else {
				factory.current.emitError('error', 'SyntaxError');
			}
			expect(client.state).toBe('failed');
			expect(states).toEqual(['failed']);
			const error = await versions.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(EngineRequestError);
			expect(error).toMatchObject({ error: { kind: 'boot' } });
			await expect(one).resolves.toMatchObject({ status: 'failed', error: { kind: 'boot' } });
			await expect(docs).rejects.toMatchObject({ error: { kind: 'boot' } });
			await expect(client.schedule(req(2))).resolves.toMatchObject({ status: 'failed' });
			await expect(client.syntax()).rejects.toBeInstanceOf(EngineRequestError);
			expect(factory.workers).toHaveLength(1);
			expect(factory.current.terminated).toBe(true);
		},
	);

	it('treats a failing first factory call as a boot failure', async () => {
		client.dispose();
		factory = new FakeWorkerFactory();
		factory.failNext = new Error('blocked');
		client = createEngineClient({ transport: factory.create });
		expect(client.state).toBe('failed');
		await expect(client.ready()).rejects.toMatchObject({ error: { kind: 'boot' } });
	});

	it('fails the default transport cleanly where Worker does not exist', async () => {
		expect(typeof globalThis.Worker).toBe('undefined');
		client.dispose();
		client = createEngineClient();
		expect(client.state).toBe('failed');
		await expect(client.ready()).rejects.toMatchObject({ error: { kind: 'boot' } });
		client.dispose();
		client = createEngineClient({ workerUrl: new URL('https://example.invalid/w.js') });
		expect(client.state).toBe('failed');
	});
});
