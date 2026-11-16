// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import { message, result } from '../workspace/testing/fake-engine-client';
import { emptiesPlan, isEmptyPlan, isEmptyResult } from './empty-plan';

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
	latest: { result: EMPTY, workspaceVersion: 3 },
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

	it('is not empty by a result of older text: it says nothing about the text as it is', () => {
		expect(isEmptyPlan(view({ version: 4 }))).toBe(false);
		expect(isEmptyPlan(view({ version: 4, indexVersion: 4 }))).toBe(false);
	});

	it('does not consult an index of other text', () => {
		expect(isEmptyPlan(view({ index: { tasks: some }, indexVersion: 2 }))).toBe(true);
	});

	it('is not empty when another error is shown, such as a syntax error', () => {
		const syntax = diag({ source: 'syntax', messageId: 'syntax:unexpected', precision: 'token' });
		expect(isEmptyPlan(view({ diagnostics: [diag({}), syntax] }))).toBe(false);
	});

	it('is not empty without a result, or for an ok result', () => {
		expect(isEmptyPlan(view({ latest: null }))).toBe(false);
		expect(isEmptyPlan(view({ latest: { result: result(1), workspaceVersion: 3 } }))).toBe(false);
	});
});

describe('emptiesPlan', () => {
	const tasks = (...ids: string[]) => ({ tasks: new Map(ids.map((i) => [i, {}])) }) as never;

	it('is a delete of the only task, or of the one task with all its subtasks', () => {
		expect(emptiesPlan(tasks('a'), { type: 'deleteTask', task: 'a' })).toBe(true);
		expect(emptiesPlan(tasks('a', 'a.b', 'a.c'), { type: 'deleteTask', task: 'a' })).toBe(true);
	});

	it('is not a delete that leaves a task, or an edit that deletes nothing', () => {
		expect(emptiesPlan(tasks('a', 'b'), { type: 'deleteTask', task: 'a' })).toBe(false);
		expect(emptiesPlan(tasks('a', 'ab'), { type: 'deleteTask', task: 'a' })).toBe(false);
		expect(emptiesPlan(tasks('a'), { type: 'renameTask', task: 'a' })).toBe(false);
		expect(emptiesPlan(tasks('a'), { type: 'deleteTask', task: 'gone' })).toBe(false);
		expect(emptiesPlan(tasks(), { type: 'setProjectAttr' })).toBe(false);
	});
});
