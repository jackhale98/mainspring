// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { startDispatcher, checkScheduleRequest, handleMessage, type EngineLike } from './dispatch';
import { EngineFailure } from './failure';
import type { FromWorker, ScheduleRequest, ScheduleResult, SyntaxDocs } from './protocol';

const versions = { tj: '3.8.4', tjCommit: 'c'.repeat(40), rubyWasm: '2.10.1', bundleHash: 'b'.repeat(64) } as const;
const docs: SyntaxDocs = { tjVersion: '3.8.4', keywords: [] };

function resultFor(request: ScheduleRequest): ScheduleResult {
	return {
		revision: request.revision,
		ok: true,
		project: null,
		tasks: [],
		resources: [],
		bookings: [],
		messages: [],
		timings: { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 },
	};
}

function fakeEngine(overrides: Partial<EngineLike> = {}): EngineLike & { seen: number[] } {
	const seen: number[] = [];
	return {
		versions,
		bootMs: 1234,
		seen,
		schedule(request) {
			seen.push(request.revision);
			return resultFor(request);
		},
		syntax: () => docs,
		...overrides,
	};
}

const request = (revision: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
	files: { 'plan.tjp': 'project p "P" 2026-01-05 +1m {}' },
	entry: 'plan.tjp',
	revision,
	...extra,
});

/** Lets the dispatcher's promise chain run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('checkScheduleRequest', () => {
	it('accepts a well-typed request, with or without options', () => {
		expect(checkScheduleRequest(request(1)).revision).toBe(1);
		expect(checkScheduleRequest(request(2, { options: { now: '2026-01-05T09:00:00Z' } })).revision).toBe(2);
	});

	it.each([
		['a non-object', 'x'],
		['a missing revision', { ...request(1), revision: undefined }],
		['a NaN revision', { ...request(1), revision: Number.NaN }],
		['files that are not an object', { ...request(1), files: [] }],
		['a file that is not text', { ...request(1), files: { 'a.tjp': 1 } }],
		['a missing entry', { ...request(1), entry: null }],
		['options that are not an object', request(1, { options: 'now' })],
		['a now that is not a string', request(1, { options: { now: 5 } })],
	])('rejects %s as invalid-request', (_, value) => {
		try {
			checkScheduleRequest(value);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(EngineFailure);
			expect((error as EngineFailure).kind).toBe('invalid-request');
		}
	});
});

describe('handleMessage', () => {
	it('answers schedule with scheduled', () => {
		const reply = handleMessage(fakeEngine(), { type: 'schedule', request: request(7) });
		expect(reply).toMatchObject({ type: 'scheduled', result: { revision: 7, ok: true } });
	});

	it('answers a malformed schedule with invalid-request for its revision', () => {
		const engine = fakeEngine();
		const reply = handleMessage(engine, { type: 'schedule', request: { revision: 3, files: 'x' } });
		expect(reply).toMatchObject({ type: 'failed', revision: 3, error: { kind: 'invalid-request' } });
		expect(engine.seen).toEqual([]);
	});

	it('omits the revision when the request has none', () => {
		const reply = handleMessage(fakeEngine(), { type: 'schedule', request: {} });
		expect(reply).toEqual({ type: 'failed', error: expect.objectContaining({ kind: 'invalid-request' }) });
	});

	it.each([
		['the bridge kind', new EngineFailure('internal', 'bridge'), 'internal'],
		['crash for a wasm trap', new WebAssembly.RuntimeError('unreachable'), 'crash'],
		['crash for out of memory', new RangeError('WebAssembly.Memory.grow(): Out of memory'), 'crash'],
		['internal for anything else', new TypeError('x'), 'internal'],
	])('maps engine errors to %s', (_, thrown, kind) => {
		const engine = fakeEngine({
			schedule: () => {
				throw thrown;
			},
		});
		const reply = handleMessage(engine, { type: 'schedule', request: request(4) });
		expect(reply).toMatchObject({ type: 'failed', revision: 4, error: { kind } });
	});

	it('answers syntax with its id, also on failure', () => {
		expect(handleMessage(fakeEngine(), { type: 'syntax', id: 2 })).toEqual({
			type: 'syntax',
			id: 2,
			result: docs,
		});
		const failing = fakeEngine({
			syntax: () => {
				throw new EngineFailure('crash', 'gone');
			},
		});
		expect(handleMessage(failing, { type: 'syntax', id: 3 })).toMatchObject({
			type: 'failed',
			id: 3,
			error: { kind: 'crash', message: 'gone' },
		});
	});

	it('ignores cancel, unknown types and non-objects', () => {
		const engine = fakeEngine();
		expect(handleMessage(engine, { type: 'cancel', revision: 1 })).toBeNull();
		expect(handleMessage(engine, { type: 'future' })).toBeNull();
		expect(handleMessage(engine, null)).toBeNull();
		expect(handleMessage(engine, { type: 'syntax', id: 'x' })).toBeNull();
	});
});

describe('startDispatcher', () => {
	it('posts ready, then answers queued messages in order', async () => {
		const posted: FromWorker[] = [];
		let finishBoot: (engine: EngineLike) => void = () => {};
		const engine = fakeEngine();
		const handle = startDispatcher(
			() => new Promise<EngineLike>((resolve) => (finishBoot = resolve)),
			(m) => posted.push(m),
		);
		handle({ type: 'schedule', request: request(1) });
		handle({ type: 'syntax', id: 1 });
		handle({ type: 'schedule', request: request(2) });
		await settle();
		expect(posted).toEqual([]);
		finishBoot(engine);
		await settle();
		expect(posted.map((m) => m.type)).toEqual(['ready', 'scheduled', 'syntax', 'scheduled']);
		expect(posted[0]).toEqual({ type: 'ready', versions, bootMs: 1234 });
		expect(engine.seen).toEqual([1, 2]);
	});

	it('reports a failed boot once, without revision or id, then fails requests with it', async () => {
		const posted: FromWorker[] = [];
		const handle = startDispatcher(
			() => Promise.reject(new EngineFailure('boot', 'no manifest', 'HTTP 404')),
			(m) => posted.push(m),
		);
		handle({ type: 'schedule', request: request(5) });
		handle({ type: 'syntax', id: 9 });
		handle({ type: 'cancel', revision: 5 });
		await settle();
		const error = { kind: 'boot', message: 'no manifest', detail: 'HTTP 404' };
		expect(posted).toEqual([
			{ type: 'failed', error },
			{ type: 'failed', revision: 5, error },
			{ type: 'failed', id: 9, error },
		]);
	});

	it('turns a boot error that is not an EngineFailure into kind boot', async () => {
		const posted: FromWorker[] = [];
		startDispatcher(
			() => Promise.reject(new Error('compile failed')),
			(m) => posted.push(m),
		);
		await settle();
		expect(posted).toEqual([
			{ type: 'failed', error: expect.objectContaining({ kind: 'boot', detail: 'Error: compile failed' }) },
		]);
	});

	it('fails a request whose reply cannot be posted, and keeps going', async () => {
		const posted: FromWorker[] = [];
		const handle = startDispatcher(
			() => Promise.resolve(fakeEngine()),
			(m) => {
				if (m.type === 'scheduled' && m.result.revision === 1) {
					throw new DOMException('could not be cloned', 'DataCloneError');
				}
				posted.push(m);
			},
		);
		handle({ type: 'schedule', request: request(1) });
		handle({ type: 'schedule', request: request(2) });
		await settle();
		expect(posted.map((m) => [m.type, m.type === 'failed' ? m.error.kind : null])).toEqual([
			['ready', null],
			['failed', 'internal'],
			['scheduled', null],
		]);
		expect(posted[1]).toMatchObject({ revision: 1 });
	});
});
