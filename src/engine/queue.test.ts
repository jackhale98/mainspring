// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { EngineError } from './protocol';
import { DISPOSED_ERROR, ScheduleQueue, type QueueEffect } from './queue';
import { SYNTAX, makeRequest as req, makeResult as res } from './testing/fake-worker';

const CRASH: EngineError = { kind: 'crash', message: 'wasm trap' };
const BRIDGE: EngineError = { kind: 'internal', message: 'bridge exception' };

function readyQueue(): ScheduleQueue {
	const queue = new ScheduleQueue();
	queue.ready();
	return queue;
}

const post = (revision: number): QueueEffect => ({
	type: 'post',
	message: { type: 'schedule', request: req(revision) },
});
const postSyntax = (id: number): QueueEffect => ({ type: 'post', message: { type: 'syntax', id } });
const done = (revision: number, latest: boolean): QueueEffect => ({
	type: 'settle',
	revision,
	outcome: { status: 'done', result: res(revision), latest },
});
const superseded = (revision: number, by: number): QueueEffect => ({
	type: 'settle',
	revision,
	outcome: { status: 'superseded', revision, by },
});
const cancelled = (revision: number): QueueEffect => ({
	type: 'settle',
	revision,
	outcome: { status: 'cancelled', revision },
});
const failed = (revision: number, error: EngineError): QueueEffect => ({
	type: 'settle',
	revision,
	outcome: { status: 'failed', revision, error },
});
const syntaxFailed = (id: number, error: EngineError): QueueEffect => ({
	type: 'syntax-settle',
	id,
	outcome: { ok: false, error },
});

describe('ScheduleQueue', () => {
	describe('rule 1: at most one in flight and one pending', () => {
		it('keeps one in flight and only the newest pending', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			queue.request(req(3));
			expect(queue.snapshot()).toMatchObject({
				inFlight: { revision: 1, cancelled: false },
				pending: 3,
			});
		});
	});

	describe('rule 2: revisions must increase', () => {
		it.each([[1], [0], [-5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
			'throws RangeError for %s after revision 1, changing nothing',
			(revision) => {
				const queue = readyQueue();
				queue.request(req(1));
				const before = queue.snapshot();
				expect(() => queue.request(req(revision))).toThrow(RangeError);
				expect(queue.snapshot()).toEqual(before);
			},
		);

		it('counts superseded and cancelled revisions as requested', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(5));
			queue.cancel(5);
			expect(() => queue.request(req(5))).toThrow(RangeError);
			expect(() => queue.request(req(4))).toThrow(RangeError);
			expect(queue.request(req(6))).toEqual([]);
		});

		it('rejects a non-finite first revision but accepts any finite one', () => {
			expect(() => readyQueue().request(req(Number.NaN))).toThrow(RangeError);
			expect(readyQueue().request(req(-3))).toEqual([post(-3)]);
		});

		it('still applies after halt and dispose', () => {
			const halted = readyQueue();
			halted.request(req(2));
			halted.halt(CRASH);
			expect(() => halted.request(req(2))).toThrow(RangeError);
			const disposed = readyQueue();
			disposed.request(req(2));
			disposed.dispose();
			expect(() => disposed.request(req(1))).toThrow(RangeError);
		});
	});

	describe('rule 3: post at once, or supersede the pending request', () => {
		it('posts at once when nothing is in flight', () => {
			expect(readyQueue().request(req(1))).toEqual([post(1)]);
		});

		it('queues behind the in-flight request without posting', () => {
			const queue = readyQueue();
			queue.request(req(1));
			expect(queue.request(req(2))).toEqual([]);
		});

		it('supersedes the pending request', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			expect(queue.request(req(3))).toEqual([superseded(2, 3)]);
		});

		it('holds requests while booting and posts only the newest on ready', () => {
			const queue = new ScheduleQueue();
			expect(queue.request(req(1))).toEqual([]);
			expect(queue.request(req(2))).toEqual([superseded(1, 2)]);
			expect(queue.ready()).toEqual([post(2)]);
		});
	});

	describe('rule 4: results', () => {
		it('delivers done with latest=true when nothing is pending', () => {
			const queue = readyQueue();
			queue.request(req(1));
			expect(queue.result(res(1))).toEqual([done(1, true)]);
			expect(queue.snapshot()).toMatchObject({ inFlight: null, lastDelivered: 1 });
		});

		it('delivers done with latest=false, then posts the pending request', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			expect(queue.result(res(1))).toEqual([done(1, false), post(2)]);
		});

		it('resolves a cancelled in-flight request as cancelled and posts the pending one', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.cancel(1);
			queue.request(req(2));
			expect(queue.result(res(1))).toEqual([cancelled(1), post(2)]);
			expect(queue.snapshot().lastDelivered).toBeNull();
		});

		it('drops results that are stale or not for the in-flight revision', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.result(res(1));
			queue.request(req(2));
			expect(queue.result(res(1))).toEqual([]);
			expect(queue.result(res(3))).toEqual([]);
			expect(queue.snapshot().inFlight).toEqual({ revision: 2, cancelled: false });
			expect(queue.result(res(2))).toEqual([done(2, true)]);
			expect(queue.result(res(2))).toEqual([]);
		});

		it('settles a reported bridge failure without a restart and moves on', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			expect(queue.failed(1, BRIDGE)).toEqual([failed(1, BRIDGE), post(2)]);
			expect(queue.failed(1, BRIDGE)).toEqual([]);
			expect(queue.phase).toBe('ready');
		});
	});

	describe('rule 5: cancel', () => {
		it('cancels a pending request at once', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			expect(queue.cancel(2)).toEqual([cancelled(2)]);
			expect(queue.result(res(1))).toEqual([done(1, true)]);
		});

		it('marks an in-flight request and settles it when its result arrives', () => {
			const queue = readyQueue();
			queue.request(req(1));
			expect(queue.cancel(1)).toEqual([]);
			expect(queue.snapshot().inFlight).toEqual({ revision: 1, cancelled: true });
			expect(queue.result(res(1))).toEqual([cancelled(1)]);
		});

		it('keeps a cancelled request cancelled when its run fails', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.cancel(1);
			expect(queue.failed(1, BRIDGE)).toEqual([cancelled(1)]);
		});

		it('ignores unknown and already settled revisions', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			queue.request(req(3));
			const before = queue.snapshot();
			expect(queue.cancel(2)).toEqual([]);
			expect(queue.cancel(99)).toEqual([]);
			expect(queue.snapshot()).toEqual(before);
			queue.cancel(3);
			expect(queue.cancel(3)).toEqual([]);
		});
	});

	describe('rule 6: crash and timeout', () => {
		it('fails the in-flight request and waits for ready before posting the pending one', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			expect(queue.crashed(CRASH)).toEqual([failed(1, CRASH)]);
			expect(queue.state).toBe('booting');
			expect(queue.request(req(3))).toEqual([superseded(2, 3)]);
			expect(queue.ready()).toEqual([post(3)]);
		});

		it('settles a cancelled in-flight request as cancelled', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.cancel(1);
			expect(queue.crashed(CRASH)).toEqual([cancelled(1)]);
		});

		it('fails posted syntax requests but keeps waiting ones', () => {
			const queue = readyQueue();
			queue.syntax(1);
			expect(queue.crashed(CRASH)).toEqual([syntaxFailed(1, CRASH)]);
			queue.syntax(2);
			expect(queue.ready()).toEqual([postSyntax(2)]);
		});
	});

	describe('rule 7: syntax', () => {
		it('posts syntax at once even while a schedule is in flight', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			expect(queue.syntax(7)).toEqual([postSyntax(7)]);
			expect(queue.snapshot()).toMatchObject({ inFlight: { revision: 1 }, pending: 2 });
		});

		it('queues syntax while booting and posts it FIFO before the pending schedule', () => {
			const queue = new ScheduleQueue();
			queue.syntax(1);
			queue.request(req(1));
			queue.syntax(2);
			expect(queue.ready()).toEqual([postSyntax(1), postSyntax(2), post(1)]);
		});

		it('matches replies by id and ignores unknown ids', () => {
			const queue = readyQueue();
			queue.syntax(1);
			queue.syntax(2);
			expect(queue.syntaxResult(2, SYNTAX)).toEqual([
				{ type: 'syntax-settle', id: 2, outcome: { ok: true, result: SYNTAX } },
			]);
			expect(queue.syntaxResult(2, SYNTAX)).toEqual([]);
			expect(queue.syntaxFailed(1, BRIDGE)).toEqual([syntaxFailed(1, BRIDGE)]);
			expect(queue.syntaxFailed(1, BRIDGE)).toEqual([]);
		});
	});

	describe('state', () => {
		it('follows booting, idle, busy and failed', () => {
			const queue = new ScheduleQueue();
			expect(queue.state).toBe('booting');
			queue.ready();
			expect(queue.state).toBe('idle');
			queue.syntax(1);
			expect(queue.state).toBe('busy');
			queue.syntaxResult(1, SYNTAX);
			queue.request(req(1));
			expect([queue.state, queue.hasOutstandingWork]).toEqual(['busy', true]);
			queue.result(res(1));
			expect([queue.state, queue.hasOutstandingWork]).toEqual(['idle', false]);
			queue.halt(CRASH);
			expect(queue.state).toBe('failed');
		});

		it('ignores ready unless booting', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			expect(queue.ready()).toEqual([]);
			queue.halt(CRASH);
			expect(queue.ready()).toEqual([]);
			expect(queue.crashed(CRASH)).toEqual([]);
		});
	});

	describe('halt', () => {
		it('fails everything now and every later request at once', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			queue.syntax(1);
			expect(queue.halt(CRASH)).toEqual([failed(1, CRASH), syntaxFailed(1, CRASH), failed(2, CRASH)]);
			expect(queue.request(req(3))).toEqual([failed(3, CRASH)]);
			expect(queue.syntax(2)).toEqual([syntaxFailed(2, CRASH)]);
			expect(queue.halt(BRIDGE)).toEqual([]);
		});

		it('fails syntax requests that were waiting for boot', () => {
			const boot: EngineError = { kind: 'boot', message: 'manifest missing' };
			const queue = new ScheduleQueue();
			queue.syntax(1);
			queue.request(req(1));
			expect(queue.halt(boot)).toEqual([failed(1, boot), syntaxFailed(1, boot)]);
		});
	});

	describe('dispose', () => {
		it('cancels schedules, fails syntax, and cancels later requests', () => {
			const queue = readyQueue();
			queue.request(req(1));
			queue.request(req(2));
			queue.syntax(1);
			expect(queue.dispose()).toEqual([
				cancelled(1),
				cancelled(2),
				syntaxFailed(1, DISPOSED_ERROR),
			]);
			expect(queue.dispose()).toEqual([]);
			expect(queue.request(req(3))).toEqual([cancelled(3)]);
			expect(queue.syntax(2)).toEqual([syntaxFailed(2, DISPOSED_ERROR)]);
			expect(queue.result(res(1))).toEqual([]);
			expect(queue.state).toBe('failed');
		});
	});
});
