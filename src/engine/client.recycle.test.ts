// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Replacing a worker whose memory passed `recycleBytes` (client.ts, queue.ts `resultThenReboot`):
 * between runs only, the result that reported it delivered as usual, the next request run on the
 * new worker, nothing failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RECYCLE_BYTES, createEngineClient, type EngineClient, type EngineState } from './client';
import { ScheduleQueue } from './queue';
import {
	FakeWorkerFactory,
	SYNTAX,
	flush,
	observe,
	makeRequest as req,
	makeResult as res,
} from './testing/fake-worker';

const LIMIT = 1_000;
const BIG = { memoryBytes: LIMIT };
const SMALL = { memoryBytes: LIMIT - 1 };

let factory: FakeWorkerFactory;
let client: EngineClient;
let states: EngineState[];

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	factory = new FakeWorkerFactory();
	client = createEngineClient({ transport: factory.create, recycleBytes: LIMIT });
	states = [];
	client.onState((s) => states.push(s));
	factory.current.boot();
});

afterEach(() => {
	client.dispose();
	vi.useRealTimers();
});

describe('worker recycling by memory', () => {
	it('defaults to 1.2 GiB, well under 2 GiB', () => {
		expect(DEFAULT_RECYCLE_BYTES).toBe(1288490189);
		expect(() => createEngineClient({ transport: factory.create, recycleBytes: 0 })).toThrow(RangeError);
	});

	it('keeps the worker below the threshold', async () => {
		const one = client.schedule(req(1));
		factory.current.answerNext(SMALL);
		await expect(one).resolves.toMatchObject({ status: 'done', result: { revision: 1 } });
		expect(factory.workers).toHaveLength(1);
		expect(client.state).toBe('idle');
	});

	it('delivers the result, then replaces the idle worker', async () => {
		const first = factory.current;
		const one = client.schedule(req(1));
		first.answerNext(BIG);
		await expect(one).resolves.toMatchObject({ status: 'done', result: { revision: 1 }, latest: true });
		expect(first.terminated).toBe(true);
		expect(factory.workers).toHaveLength(2);
		expect(client.state).toBe('booting');
		const two = client.schedule(req(2));
		expect(factory.current.posted).toEqual([]);
		factory.current.boot();
		expect(factory.current.postedRevisions()).toEqual([2]);
		factory.current.answerNext(SMALL);
		await expect(two).resolves.toMatchObject({ status: 'done', result: { revision: 2 } });
		expect(states).toEqual(['idle', 'busy', 'booting', 'busy', 'idle']);
	});

	it('runs the pending request on the new worker, never on the old one', async () => {
		const first = factory.current;
		const one = client.schedule(req(1));
		const two = client.schedule(req(2));
		first.answerNext(BIG);
		await expect(one).resolves.toMatchObject({ status: 'done', result: { revision: 1 }, latest: false });
		expect(first.postedRevisions()).toEqual([1]);
		const pending = observe(two);
		await flush();
		expect(pending.value).toBeUndefined();
		factory.current.boot();
		expect(factory.current.postedRevisions()).toEqual([2]);
		factory.current.answerNext();
		await expect(two).resolves.toMatchObject({ status: 'done', result: { revision: 2 }, latest: true });
	});

	it('waits while the worker still owes a syntax reply, and recycles on a later result', async () => {
		const first = factory.current;
		const one = client.schedule(req(1));
		const docs = client.syntax();
		first.answerNext(BIG);
		await expect(one).resolves.toMatchObject({ status: 'done' });
		expect(first.terminated).toBe(false);
		first.answerNext();
		await expect(docs).resolves.toEqual(SYNTAX);
		const two = client.schedule(req(2));
		first.answerNext(BIG);
		await expect(two).resolves.toMatchObject({ status: 'done', result: { revision: 2 } });
		expect(first.terminated).toBe(true);
		expect(factory.workers).toHaveLength(2);
	});

	it('settles a cancelled run as cancelled and still recycles', async () => {
		const one = client.schedule(req(1));
		client.cancel(1);
		factory.current.answerNext(BIG);
		await expect(one).resolves.toEqual({ status: 'cancelled', revision: 1 });
		expect(factory.workers).toHaveLength(2);
	});

	it('cannot recycle a single worker instance, so it keeps it', async () => {
		client.dispose();
		factory = new FakeWorkerFactory();
		const only = factory.create();
		client = createEngineClient({ transport: only, recycleBytes: LIMIT });
		only.boot();
		const one = client.schedule(req(1));
		only.answerNext(BIG);
		await expect(one).resolves.toMatchObject({ status: 'done' });
		expect(only.terminated).toBe(false);
		expect(client.state).toBe('idle');
	});
});

describe('ScheduleQueue.resultThenReboot', () => {
	it('settles like result() and waits for ready instead of posting the pending request', () => {
		const queue = new ScheduleQueue();
		queue.ready();
		queue.request(req(1));
		queue.request(req(2));
		const effects = queue.resultThenReboot(res(1));
		expect(effects).toEqual([
			{ type: 'settle', revision: 1, outcome: { status: 'done', result: res(1), latest: false } },
		]);
		expect(queue.phase).toBe('booting');
		expect(queue.ready()).toEqual([{ type: 'post', message: { type: 'schedule', request: req(2) } }]);
	});

	it('ignores a stale result and stays ready', () => {
		const queue = new ScheduleQueue();
		queue.ready();
		queue.request(req(3));
		expect(queue.resultThenReboot(res(2))).toEqual([]);
		expect(queue.phase).toBe('ready');
	});
});
