// SPDX-License-Identifier: GPL-2.0-or-later
// When and how one runner state settles an applied edit (phase-2.md 6.8 step 5, 11.2; the rule in
// workspace/run-types.ts).
import { describe, expect, it } from 'vitest';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import { engineFailureStrings, toastStrings } from '../strings';
import { message, result } from '../workspace/testing/fake-engine-client';
import type { RunnerFailure, RunRecord } from '../workspace/run-types';
import { errorIdsOf, settleOf, type RunnerView } from './edits-settle';

const run = (revision: number, workspaceVersion: number, over = {}): RunRecord =>
	({ revision, workspaceVersion, result: result(revision, over) }) as unknown as RunRecord;
const failure = (revision: number, workspaceVersion: number): RunnerFailure => ({
	revision,
	workspaceVersion,
	error: { kind: 'internal', message: 'x' },
	roundTripMs: 1,
});
const diag = (over: Partial<TjpDiagnostic>): TjpDiagnostic => ({
	file: 'plan.tjp',
	from: 10,
	to: 20,
	severity: 'error',
	source: 'engine',
	messageId: 'test_msg',
	message: 'm',
	hint: null,
	scenario: null,
	precision: 'line',
	line: 2,
	column: 1,
	revision: 3,
	stale: false,
	...over,
});
const state = (over: Partial<RunnerView>): RunnerView => ({
	engine: 'idle',
	latest: null,
	failure: null,
	diagnostics: [],
	version: 9,
	lastGood: null,
	...over,
});
const NONE = new Set<string>();

describe('settleOf', () => {
	it('waits until a result or failure includes the version', () => {
		expect(settleOf(state({ latest: run(1, 4) }), 5, NONE)).toBeNull();
		expect(settleOf(state({ failure: failure(1, 4) }), 5, NONE)).toBeNull();
		expect(settleOf(state({}), 5, NONE)).toBeNull();
	});

	it('is scheduled on an ok result of that version or a newer one', () => {
		expect(settleOf(state({ latest: run(2, 5) }), 5, NONE)).toEqual({ status: 'scheduled' });
		expect(settleOf(state({ latest: run(3, 8) }), 5, NONE)).toEqual({ status: 'scheduled' });
	});

	it('does not schedule on a result that is not ok, with the first error and its place', () => {
		const st = settleOf(
			state({
				latest: run(3, 5, {
					ok: false,
					messages: [message('warning', 1, 'w'), message('error', 2, 'Boom')],
				}),
				diagnostics: [diag({ source: 'syntax', from: 0 }), diag({ from: 10, to: 20 })],
			}),
			5,
			NONE,
		);
		expect(st).toEqual({
			status: 'not-scheduled',
			message: toastStrings.noLongerSchedules('Boom'),
			at: { file: 'plan.tjp', from: 10, to: 20, version: 9 },
		});
	});

	it('says "new error" for an ok result with an error the good run before did not have', () => {
		const s = state({
			latest: run(3, 5, { messages: [message('error', 2, 'New')] }),
			diagnostics: [diag({ from: 10, to: 20 })],
		});
		expect(settleOf(s, 5, NONE)).toEqual({
			status: 'new-error',
			message: toastStrings.newError('New'),
			at: { file: 'plan.tjp', from: 10, to: 20, version: 9 },
		});
		expect(settleOf(s, 5, new Set(['test_msg']))).toEqual({ status: 'scheduled' });
	});

	it('says so when a result has no message or no place', () => {
		expect(settleOf(state({ latest: run(3, 5, { ok: false }) }), 5, NONE)).toEqual({
			status: 'not-scheduled',
			message: toastStrings.noLongerSchedules(toastStrings.noMessage),
			at: null,
		});
	});

	it('fails when the run that included it failed, the newer revision winning', () => {
		const failed = {
			status: 'failed',
			message: toastStrings.failed(engineFailureStrings.internal),
		};
		expect(settleOf(state({ failure: failure(3, 5) }), 5, NONE)).toEqual(failed);
		expect(settleOf(state({ latest: run(2, 5), failure: failure(3, 6) }), 5, NONE)).toEqual(failed);
		expect(settleOf(state({ latest: run(4, 6), failure: failure(3, 5) }), 5, NONE)).toEqual({
			status: 'scheduled',
		});
	});

	it('fails every pending edit when the engine gave up', () => {
		expect(settleOf(state({ engine: 'failed' }), 5, NONE)).toEqual({
			status: 'failed',
			message: toastStrings.failed(engineFailureStrings.crash),
		});
	});
});

describe('errorIdsOf', () => {
	it('lists the ids of errors and fatal messages only', () => {
		const r = result(1, {
			messages: [
				{ ...message('error', 1), id: 'a' },
				{ ...message('fatal', 1), id: 'b' },
				{ ...message('warning', 1), id: 'c' },
			],
		});
		expect([...errorIdsOf(r)].sort()).toEqual(['a', 'b']);
		expect(errorIdsOf(null).size).toBe(0);
	});
});
