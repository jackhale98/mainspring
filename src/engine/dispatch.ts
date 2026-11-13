// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The worker's message handling (phase-0 spec 3.2), without the Worker global and without Ruby,
 * so Node unit tests can drive it with a fake engine. worker.ts wires it to `self`.
 *
 * - Boot starts at once. Success posts `ready`; failure posts `failed` with kind `boot` and no
 *   `revision` or `id` (the client then gives up for good).
 * - Messages are handled one at a time, in arrival order; messages that arrive while booting wait.
 *   Ruby runs synchronously, so a schedule in progress cannot be interrupted.
 * - `schedule` replies `scheduled`, or `failed` with the request's revision. `syntax` replies
 *   `syntax`, or `failed` with its id. Error kinds follow failure.ts.
 * - `cancel` is a no-op (ADR-0002, decision 6): the client never has more than one request here.
 * - A message that is not a well-formed ToWorker is dropped when it is not an object or its type
 *   is unknown. A `schedule` whose request has no valid numeric revision gets `failed` with kind
 *   `invalid-request` and no revision (the client never sends this); one with a revision but a
 *   malformed body gets `failed` with that revision. A `syntax` without a numeric id is dropped.
 */
import { EngineFailure, toEngineError } from './failure.ts';
import type {
	EngineError,
	EngineVersions,
	FromWorker,
	ScheduleRequest,
	ScheduleResult,
	SyntaxDocs,
} from './protocol';

/** The part of runtime.ts `Engine` the dispatcher uses. */
export interface EngineLike {
	readonly versions: EngineVersions;
	readonly bootMs: number;
	schedule(request: ScheduleRequest): ScheduleResult;
	syntax(): SyntaxDocs;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function invalid(message: string): EngineFailure {
	return new EngineFailure('invalid-request', message);
}

/**
 * Checks the JS types of a schedule request. Paths, `entry` membership and the `now` format are
 * checked by the bridge (engine/bridge/request.rb), the same code the native recorder runs.
 */
export function checkScheduleRequest(request: unknown): ScheduleRequest {
	if (!isRecord(request)) throw invalid('The schedule request is not an object.');
	if (!isNumber(request['revision'])) throw invalid('The request revision is not a number.');
	const files = request['files'];
	if (!isRecord(files)) throw invalid('The request files are not an object.');
	for (const [path, text] of Object.entries(files)) {
		if (typeof text !== 'string') throw invalid(`The request file ${path} is not text.`);
	}
	if (typeof request['entry'] !== 'string') throw invalid('The request entry is not a string.');
	const options = request['options'];
	if (options !== undefined) {
		if (!isRecord(options)) throw invalid('The request options are not an object.');
		if (options['now'] !== undefined && typeof options['now'] !== 'string') {
			throw invalid('The request options.now is not a string.');
		}
	}
	if (request['retain'] !== undefined && typeof request['retain'] !== 'boolean') {
		throw invalid('The request retain is not a boolean.');
	}
	// The bridge checks the patch itself and runs in full when it cannot vouch for it.
	if (request['fast'] !== undefined && !isRecord(request['fast'])) {
		throw invalid('The request fast patch is not an object.');
	}
	return request as unknown as ScheduleRequest;
}

/** The single reply to one incoming message, or null when there is nothing to answer. */
export function handleMessage(engine: EngineLike, message: unknown): FromWorker | null {
	if (!isRecord(message)) return null;
	switch (message['type']) {
		case 'schedule': {
			const request = message['request'];
			const revision = isRecord(request) && isNumber(request['revision']) ? request['revision'] : undefined;
			try {
				return { type: 'scheduled', result: engine.schedule(checkScheduleRequest(request)) };
			} catch (error) {
				return failed(toEngineError(error), revision === undefined ? {} : { revision });
			}
		}
		case 'syntax': {
			const id = message['id'];
			if (!isNumber(id)) return null;
			try {
				return { type: 'syntax', id, result: engine.syntax() };
			} catch (error) {
				return failed(toEngineError(error), { id });
			}
		}
		default:
			// 'cancel' and unknown types: nothing to do and nothing to answer.
			return null;
	}
}

function failed(error: EngineError, target: { revision?: number; id?: number }): FromWorker {
	return { type: 'failed', ...target, error };
}

/**
 * Boots the engine and returns the handler for incoming messages. `post` sends a reply.
 */
export function startDispatcher(
	boot: () => Promise<EngineLike>,
	post: (message: FromWorker) => void,
): (message: unknown) => void {
	let engine: EngineLike | null = null;
	let bootError: EngineError | null = null;
	let chain: Promise<void> = boot().then(
		(e) => {
			engine = e;
			post({ type: 'ready', versions: e.versions, bootMs: e.bootMs });
		},
		(error: unknown) => {
			bootError = toEngineError(error, 'boot');
			post({ type: 'failed', error: bootError });
		},
	);
	return (message) => {
		const step = (): void => {
			const reply = engine
				? handleMessage(engine, message)
				: bootError && bootFailureReply(message, bootError);
			if (reply) deliver(reply, post);
		};
		// If a step throws, the queue must not stall: later messages still run.
		chain = chain.then(step, step).catch(() => {});
	};
}

/**
 * Posts `reply`. If it cannot be posted (e.g. DataCloneError), the request it answers fails with
 * kind `internal` instead, so the client is never left waiting.
 */
function deliver(reply: FromWorker, post: (message: FromWorker) => void): void {
	try {
		post(reply);
	} catch (error) {
		const target =
			reply.type === 'scheduled'
				? { revision: reply.result.revision }
				: reply.type === 'syntax'
					? { id: reply.id }
					: null;
		if (target === null) return;
		try {
			post(failed(toEngineError(error), target));
		} catch {
			// Nothing more can be sent; the client's reply timeout takes over.
		}
	}
}

/** After a failed boot: answer requests that name a revision or id with the boot error. */
function bootFailureReply(message: unknown, error: EngineError): FromWorker | null {
	if (!isRecord(message)) return null;
	const request = message['request'];
	if (message['type'] === 'schedule' && isRecord(request) && isNumber(request['revision'])) {
		return failed(error, { revision: request['revision'] });
	}
	if (message['type'] === 'syntax' && isNumber(message['id'])) return failed(error, { id: message['id'] });
	return null;
}
