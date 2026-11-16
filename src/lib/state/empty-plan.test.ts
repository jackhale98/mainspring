// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import { message, result } from '../workspace/testing/fake-engine-client';
import { isEmptyPlan, isEmptyResult } from './empty-plan';

const noTasks = { ...message('error', null, 'No tasks'), id: 'no_tasks' };
const EMPTY = result(1, { ok: false, messages: [noTasks] });
const diag = (over: Partial<TjpDiagnostic>): TjpDiagnostic => ({
	file: 'plan.tjp',
	from: 0,
	to: 5,
	severity: 'error',
	source: 'engine',
	messageId: 'no_tasks',
	message: 'No tasks',
	hint: null,
	scenario: null,
	precision: 'none',
	line: null,
	column: null,
	revision: 1,
	stale: false,
	...over,
});
const none = new Map<string, never>();
const some = new Map([['a', {}]]) as unknown as Map<string, never>;
const view = (over = {}) => ({
	latest: { result: EMPTY },
	diagnostics: [diag({})],
	index: { tasks: none },
	indexVersion: 3,
	version: 3,
	...over,
});

describe('isEmptyResult', () => {
	it('is a result that stopped for no_tasks and nothing else', () => {
		expect(isEmptyResult(EMPTY)).toBe(true);
		expect(isEmptyResult(result(1))).toBe(false);
		expect(isEmptyResult(result(1, { ok: false, messages: [] }))).toBe(false);
		expect(
			isEmptyResult(result(1, { ok: false, messages: [noTasks, message('error', 2, 'Other')] })),
		).toBe(false);
		// A warning beside it does not make it a failure.
		expect(
			isEmptyResult(result(1, { ok: false, messages: [noTasks, message('warning', 2)] })),
		).toBe(true);
	});
});

describe('isEmptyPlan', () => {
	it('is empty when the result and the text both say there is no task', () => {
		expect(isEmptyPlan(view())).toBe(true);
	});

	it('stays an error when the text declares tasks but the engine still says no_tasks', () => {
		expect(isEmptyPlan(view({ index: { tasks: some } }))).toBe(false);
	});

	it('does not trust an index that is older than the text', () => {
		expect(isEmptyPlan(view({ index: { tasks: some }, indexVersion: 2 }))).toBe(true);
	});

	it('is not empty when another error is shown, such as a syntax error', () => {
		const syntax = diag({ source: 'syntax', messageId: 'syntax:unexpected', precision: 'token' });
		expect(isEmptyPlan(view({ diagnostics: [diag({}), syntax] }))).toBe(false);
	});

	it('is not empty without a result, or for an ok result', () => {
		expect(isEmptyPlan(view({ latest: null }))).toBe(false);
		expect(isEmptyPlan(view({ latest: { result: result(1) } }))).toBe(false);
	});
});
