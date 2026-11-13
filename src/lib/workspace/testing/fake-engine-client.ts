// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test-only EngineClient with fully controlled outcomes, for the schedule runner's unit tests.
 * Nothing settles until the test calls `done`, `fail`, `supersede` or `cancel`. Revisions must
 * increase, as with the real client. Not imported by application code.
 */
import type { EngineClient, EngineState, ScheduleOutcome } from '../../../engine/client';
import type {
	EngineError,
	EngineMessage,
	EngineVersions,
	Revision,
	ScheduleRequest,
	ScheduleResult,
	SyntaxDocs,
	TaskResult,
} from '../../../engine/protocol';

const VERSIONS: EngineVersions = {
	tj: '3.8.4',
	tjCommit: '3b36c799605621103d7d065c69e3f958a3dd6698',
	rubyWasm: '0.0.0-test',
	bundleHash: 'test',
};

export const TIMINGS = { writeFsMs: 1, parseMs: 2, scheduleMs: 3, serializeMs: 1, totalMs: 7 };

/** A task result for the 'plan' scenario. */
export function task(
	id: string,
	line: number | null,
	end: number | null,
	opts: { parent?: string | null; file?: string; scheduled?: boolean } = {},
): TaskResult {
	return {
		id,
		name: id,
		parent: opts.parent ?? null,
		source: line === null ? null : { file: opts.file ?? 'plan.tjp', line, column: null },
		milestone: false,
		scenarios: {
			plan: {
				scheduled: opts.scheduled ?? true,
				start: 0,
				end,
				allocated: [],
				criticalness: 0,
				pathCriticalness: 0,
				direction: 'asap',
				complete: null,
				depends: [],
				precedes: [],
			},
		},
	};
}

export function message(
	level: EngineMessage['level'],
	line: number | null,
	text = 'msg',
): EngineMessage {
	return { level, id: 'test_msg', text, file: 'plan.tjp', line, column: null, scenario: null };
}

/** A result for `revision`: ok, project starting 2026-01-05 in UTC, no tasks unless given. */
export function result(revision: Revision, over: Partial<ScheduleResult> = {}): ScheduleResult {
	return {
		revision,
		ok: true,
		project: {
			id: 'p',
			name: 'P',
			version: null,
			start: '2026-01-05T00:00:00Z',
			end: '2026-02-05T00:00:00Z',
			now: '2026-01-05T00:00:00Z',
			timezone: null,
			timingResolutionMin: 60,
			scenarios: [{ id: 'plan', name: 'Plan', parent: null, active: true }],
			dailyWorkingHours: 8,
			weeklyWorkingDays: 5,
			monthlyWorkingDays: 260.714 / 12,
			yearlyWorkingDays: 260.714,
			workingTime: [],
		},
		tasks: [],
		resources: [],
		bookings: [],
		messages: [],
		timings: TIMINGS,
		...over,
	};
}

export class FakeEngineClient implements EngineClient {
	state: EngineState = 'idle';
	readonly requests: ScheduleRequest[] = [];
	readonly cancelled: Revision[] = [];
	readonly #open = new Map<Revision, (o: ScheduleOutcome) => void>();
	readonly #listeners = new Set<(s: EngineState) => void>();
	#last: Revision | null = null;

	ready(): Promise<EngineVersions> {
		return Promise.resolve(VERSIONS);
	}

	syntax(): Promise<SyntaxDocs> {
		return Promise.resolve({ tjVersion: '3.8.4', keywords: [] });
	}

	schedule(request: ScheduleRequest): Promise<ScheduleOutcome> {
		if (this.#last !== null && request.revision <= this.#last) {
			return Promise.reject(new RangeError(`revision ${request.revision} is not increasing`));
		}
		this.#last = request.revision;
		this.requests.push(request);
		return new Promise((resolve) => this.#open.set(request.revision, resolve));
	}

	cancel(revision: Revision): void {
		this.cancelled.push(revision);
		this.settle(revision, { status: 'cancelled', revision });
	}

	onState(listener: (s: EngineState) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
		for (const r of [...this.#open.keys()]) this.settle(r, { status: 'cancelled', revision: r });
		this.setState('failed');
	}

	/** Revisions sent and not yet settled. */
	get open(): Revision[] {
		return [...this.#open.keys()];
	}

	/** The newest request; throws when there is none. */
	get lastRequest(): ScheduleRequest {
		const r = this.requests.at(-1);
		if (!r) throw new Error('FakeEngineClient: no request');
		return r;
	}

	get listenerCount(): number {
		return this.#listeners.size;
	}

	setState(s: EngineState): void {
		this.state = s;
		for (const l of [...this.#listeners]) l(s);
	}

	settle(revision: Revision, outcome: ScheduleOutcome): void {
		const resolve = this.#open.get(revision);
		this.#open.delete(revision);
		resolve?.(outcome);
	}

	/** Delivers a result; `latest` defaults to whether no newer request is open. */
	done(revision: Revision, over: Partial<ScheduleResult> = {}, latest?: boolean): void {
		const newer = [...this.#open.keys()].some((r) => r > revision);
		this.settle(revision, {
			status: 'done',
			result: result(revision, over),
			latest: latest ?? !newer,
		});
	}

	fail(revision: Revision, error: EngineError = { kind: 'crash', message: 'trap' }): void {
		this.settle(revision, { status: 'failed', revision, error });
	}

	supersede(revision: Revision, by: Revision): void {
		this.settle(revision, { status: 'superseded', revision, by });
	}
}

/** Lets pending promise callbacks run (needs the real setImmediate). */
export function flush(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
