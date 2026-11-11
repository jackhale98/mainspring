// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineRequestError, createEngineClient, type EngineClient, type EngineState } from './client';
import {
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

describe('createEngineClient', () => {
	it('boots: booting, then idle on ready, and ready() resolves the versions', async () => {
		expect(client.state).toBe('booting');
		const versions = client.ready();
		factory.current.boot();
		expect(client.state).toBe('idle');
		expect(states).toEqual(['idle']);
		await expect(versions).resolves.toEqual(VERSIONS);
		await expect(client.ready()).resolves.toEqual(VERSIONS);
	});

	it('posts a schedule after ready and resolves done with latest=true', async () => {
		factory.current.boot();
		const outcome = client.schedule(req(1));
		expect(factory.current.postedRevisions()).toEqual([1]);
		expect(client.state).toBe('busy');
		factory.current.answerNext();
		await expect(outcome).resolves.toEqual({ status: 'done', result: res(1), latest: true });
		expect(states).toEqual(['idle', 'busy', 'idle']);
	});

	it('holds requests while booting and runs only the newest', async () => {
		const first = client.schedule(req(1));
		const second = client.schedule(req(2));
		expect(factory.current.posted).toEqual([]);
		await expect(first).resolves.toEqual({ status: 'superseded', revision: 1, by: 2 });
		factory.current.boot();
		expect(factory.current.postedRevisions()).toEqual([2]);
		factory.current.answerNext();
		await expect(second).resolves.toMatchObject({ status: 'done', latest: true });
	});

	it('delivers a run that finishes behind a newer edit with latest=false, then runs the newest', async () => {
		factory.current.boot();
		const first = client.schedule(req(1));
		const second = client.schedule(req(2));
		const third = client.schedule(req(3));
		await expect(second).resolves.toEqual({ status: 'superseded', revision: 2, by: 3 });
		factory.current.answerNext();
		await expect(first).resolves.toMatchObject({ status: 'done', latest: false });
		expect(factory.current.postedRevisions()).toEqual([1, 3]);
		factory.current.answerNext();
		await expect(third).resolves.toMatchObject({ status: 'done', latest: true });
	});

	it('cancels pending requests at once and in-flight ones when they finish', async () => {
		factory.current.boot();
		const first = client.schedule(req(1));
		const second = client.schedule(req(2));
		client.cancel(2);
		client.cancel(1);
		client.cancel(42);
		await expect(second).resolves.toEqual({ status: 'cancelled', revision: 2 });
		const box = observe(first);
		await flush();
		expect(box.value).toBeUndefined();
		factory.current.answerNext();
		await expect(first).resolves.toEqual({ status: 'cancelled', revision: 1 });
		expect(factory.current.postedRevisions()).toEqual([1]);
		expect(factory.current.posted.some((m) => m.type === 'cancel')).toBe(false);
	});

	it('rejects a non-increasing revision with RangeError and keeps working', async () => {
		factory.current.boot();
		const first = client.schedule(req(5));
		await expect(client.schedule(req(5))).rejects.toBeInstanceOf(RangeError);
		await expect(client.schedule(req(4))).rejects.toBeInstanceOf(RangeError);
		factory.current.answerNext();
		await expect(first).resolves.toMatchObject({ status: 'done' });
		expect(factory.current.postedRevisions()).toEqual([5]);
	});

	it('settles a bridge failure as failed without restarting the worker', async () => {
		factory.current.boot();
		const first = client.schedule(req(1));
		const second = client.schedule(req(2));
		factory.current.failNext({ kind: 'invalid-request', message: 'entry not in files' });
		await expect(first).resolves.toEqual({
			status: 'failed',
			revision: 1,
			error: { kind: 'invalid-request', message: 'entry not in files' },
		});
		expect(factory.workers).toHaveLength(1);
		expect(factory.current.postedRevisions()).toEqual([1, 2]);
		factory.current.answerNext();
		await expect(second).resolves.toMatchObject({ status: 'done' });
	});

	it('ignores late results, unknown messages and non-object data', async () => {
		factory.current.boot();
		const first = client.schedule(req(1));
		factory.current.emit({ type: 'scheduled', result: res(0) });
		factory.current.emitRaw({ type: 'progress' });
		factory.current.emitRaw(null);
		factory.current.emitRaw('scheduled');
		expect(client.state).toBe('busy');
		factory.current.answerNext();
		await expect(first).resolves.toMatchObject({ status: 'done' });
		factory.current.emit({ type: 'scheduled', result: res(1) });
		factory.current.emit({ type: 'failed', revision: 1, error: { kind: 'internal', message: 'x' } });
		expect(client.state).toBe('idle');
	});

	describe('syntax (rule 7)', () => {
		it('is posted at once while a schedule runs, served in order, and cached', async () => {
			factory.current.boot();
			const one = client.schedule(req(1));
			const two = client.schedule(req(2));
			const docs = client.syntax();
			expect(client.syntax()).toBe(docs);
			expect(factory.current.posted.map((m) => m.type)).toEqual(['schedule', 'syntax']);
			factory.current.answerNext();
			await expect(one).resolves.toMatchObject({ status: 'done', latest: false });
			factory.current.answerNext();
			await expect(docs).resolves.toEqual(SYNTAX);
			factory.current.answerNext();
			await expect(two).resolves.toMatchObject({ status: 'done' });
			await expect(client.syntax()).resolves.toBe(SYNTAX);
			expect(factory.current.posted.filter((m) => m.type === 'syntax')).toHaveLength(1);
		});

		it('waits for boot and goes before the pending schedule', () => {
			void client.schedule(req(1));
			client.syntax().catch(() => undefined); // rejected by dispose in afterEach
			factory.current.boot();
			expect(factory.current.posted.map((m) => m.type)).toEqual(['syntax', 'schedule']);
		});

		it('does not cache a failure and retries on the next call', async () => {
			factory.current.boot();
			const first = client.syntax();
			factory.current.failNext();
			await expect(first).rejects.toMatchObject({ error: { kind: 'internal' } });
			const second = client.syntax();
			expect(second).not.toBe(first);
			factory.current.answerNext();
			await expect(second).resolves.toEqual(SYNTAX);
		});

		it('rejects when the worker crashes', async () => {
			factory.current.boot();
			const docs = client.syntax();
			factory.current.emitError();
			await expect(docs).rejects.toMatchObject({ error: { kind: 'crash' } });
		});
	});

	it('fails a request the worker cannot take, and moves on', async () => {
		factory.current.boot();
		factory.current.postError = new Error('DataCloneError');
		const one = client.schedule(req(1));
		const docs = client.syntax();
		await expect(one).resolves.toMatchObject({
			status: 'failed',
			error: { kind: 'invalid-request' },
		});
		await expect(docs).rejects.toMatchObject({ error: { kind: 'invalid-request' } });
		factory.current.postError = null;
		const two = client.schedule(req(2));
		factory.current.answerNext();
		await expect(two).resolves.toMatchObject({ status: 'done' });
		expect(client.state).toBe('idle');
	});

	it('gives later listeners the current state when an earlier listener changes it', () => {
		client.onState((s) => {
			if (s === 'idle') void client.schedule(req(1));
		});
		const seenByB: EngineState[] = [];
		client.onState((s) => seenByB.push(s));
		factory.current.boot();
		expect(client.state).toBe('busy');
		expect(seenByB.at(-1)).toBe(client.state);
		expect(seenByB).toEqual(['busy']);
		expect(states).toEqual(['idle', 'busy']);
		expect(factory.current.postedRevisions()).toEqual([1]);
	});

	it('keeps working when a state listener throws', async () => {
		const unsubscribe = client.onState(() => {
			throw new Error('listener bug');
		});
		const seen: EngineState[] = [];
		client.onState((s) => seen.push(s));
		const uncaught = vi.fn();
		process.on('uncaughtException', uncaught);
		try {
			factory.current.boot();
			await flush();
		} finally {
			process.off('uncaughtException', uncaught);
		}
		expect(seen).toEqual(['idle']);
		expect(uncaught).toHaveBeenCalledOnce();
		unsubscribe();
		void client.schedule(req(1));
		expect(seen).toEqual(['idle', 'busy']);
	});

	it('dispose cancels schedules, rejects the rest, terminates the worker and stays quiet', async () => {
		const versions = client.ready();
		factory.current.boot();
		await versions;
		const one = client.schedule(req(1));
		const two = client.schedule(req(2));
		const docs = client.syntax();
		const worker = factory.current;
		client.dispose();
		client.dispose();
		await expect(one).resolves.toEqual({ status: 'cancelled', revision: 1 });
		await expect(two).resolves.toEqual({ status: 'cancelled', revision: 2 });
		await expect(docs).rejects.toBeInstanceOf(EngineRequestError);
		await expect(client.ready()).rejects.toBeInstanceOf(EngineRequestError);
		await expect(client.schedule(req(3))).resolves.toEqual({ status: 'cancelled', revision: 3 });
		expect(worker.terminated).toBe(true);
		worker.answerNext();
		expect(states).toEqual(['idle', 'busy']);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('rejects pending ready() calls on dispose', async () => {
		const versions = client.ready();
		client.dispose();
		await expect(versions).rejects.toBeInstanceOf(EngineRequestError);
	});
});
