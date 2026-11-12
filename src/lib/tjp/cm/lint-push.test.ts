// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// How diagnostics are pushed into a view (T21): a push that changes nothing dispatches nothing, and
// no push is dispatched while CodeMirror holds back an Android Enter, because any transaction in
// that frame drops the key (@codemirror/view `delayAndroidKey`).
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TjpDiagnostic } from '../diagnostics-types';
import { androidKeyPending, setEngineDiagnostics, setLocalDiagnostics } from './lint';
import { tjpState } from './testing';

const DOC = 'task a "A" {\n  effort 5d\n  depends zz\n}\n';

function diag(over: Partial<TjpDiagnostic> = {}): TjpDiagnostic {
	return {
		file: 'plan.tjp',
		from: DOC.indexOf('zz'),
		to: DOC.indexOf('zz') + 2,
		severity: 'error',
		source: 'engine',
		messageId: 'unknown_task',
		message: "Task 'zz' is unknown.",
		hint: null,
		scenario: null,
		precision: 'token',
		line: 3,
		column: 11,
		revision: 1,
		stale: false,
		...over,
	};
}

let view: EditorView;
let dispatched: number;

beforeEach(() => {
	vi.useFakeTimers();
	const parent = document.createElement('div');
	document.body.appendChild(parent);
	view = new EditorView({ parent, state: tjpState(DOC, { path: 'plan.tjp' }) });
	dispatched = 0;
	const real = view.dispatch.bind(view);
	vi.spyOn(view, 'dispatch').mockImplementation(((...a: Parameters<typeof real>) => {
		dispatched++;
		return real(...a);
	}) as typeof view.dispatch);
});

afterEach(() => {
	view.destroy();
	vi.useRealTimers();
});

/** Makes CodeMirror's observer report a held-back key, as after an Android Enter. */
function holdKey(on: boolean): void {
	(view as unknown as { observer: { delayedAndroidKey: unknown } }).observer.delayedAndroidKey = on
		? { key: 'Enter', keyCode: 13, force: true }
		: null;
}

describe('pushing diagnostics', () => {
	it('dispatches nothing when the list draws what is drawn already', () => {
		setEngineDiagnostics(view, [diag()]);
		expect(dispatched).toBe(1);
		// The next result: same message, new revision.
		setEngineDiagnostics(view, [diag({ revision: 2 })]);
		setLocalDiagnostics(view, []);
		setLocalDiagnostics(view, []);
		expect(dispatched).toBe(1);
		setEngineDiagnostics(view, [diag({ message: 'changed' })]);
		expect(dispatched).toBe(2);
	});

	it('waits while an Android key is pending, then pushes the newest list once', () => {
		holdKey(true);
		expect(androidKeyPending(view)).toBe(true);
		setEngineDiagnostics(view, [diag()]);
		setEngineDiagnostics(view, [diag({ message: 'newer' })]);
		vi.advanceTimersByTime(100);
		expect(dispatched).toBe(0);
		holdKey(false);
		vi.advanceTimersByTime(20);
		expect(dispatched).toBe(1);
	});

	it('gives up quietly when the view is gone', () => {
		holdKey(true);
		setEngineDiagnostics(view, [diag()]);
		view.dom.remove();
		vi.advanceTimersByTime(100);
		expect(dispatched).toBe(0);
	});

	it('pushes anyway when a key stays pending for about 500 ms', () => {
		holdKey(true);
		setEngineDiagnostics(view, [diag()]);
		vi.advanceTimersByTime(300);
		expect(dispatched).toBe(0);
		vi.advanceTimersByTime(400);
		expect(dispatched).toBe(1);
	});

	it('runs the caller’s sync before a waiting push', () => {
		holdKey(true);
		const order: string[] = [];
		setEngineDiagnostics(view, [diag()], () => order.push('sync'));
		holdKey(false);
		vi.advanceTimersByTime(20);
		expect(order).toEqual(['sync']);
		expect(dispatched).toBe(1);
	});

	it('compares ranges as mapped through edits: a deleted marked text is a point', () => {
		setEngineDiagnostics(view, [diag()]);
		const from = DOC.indexOf('zz');
		view.dispatch({ changes: { from, to: from + 2 } });
		const n = dispatched;
		// Stale (the text changed): a fresh result is pushed even if it places the problem at the point.
		setEngineDiagnostics(view, [diag({ from, to: from, revision: 2 })]);
		expect(dispatched).toBe(n + 1);
		// The same list again draws the same thing.
		setEngineDiagnostics(view, [diag({ from, to: from, revision: 3 })]);
		expect(dispatched).toBe(n + 1);
	});

	it('says the problems under the cursor once, and clears when the cursor leaves', () => {
		setEngineDiagnostics(view, [diag()]);
		const region = () => view.dom.querySelector('.cm-tjp-announce')?.textContent;
		expect(region()).toBe('');
		const at = DOC.indexOf('zz');
		view.dispatch({ selection: { anchor: at + 1 } });
		vi.advanceTimersByTime(50);
		expect(region()).toBe("Error: Task 'zz' is unknown.");
		view.dispatch({ selection: { anchor: at } });
		vi.advanceTimersByTime(50);
		expect(region()).toBe("Error: Task 'zz' is unknown.");
		view.dispatch({ selection: { anchor: 0 } });
		expect(region()).toBe('');
	});

	it('speaks again for another problem with the same words, and joins problems at the cursor', () => {
		const at = DOC.indexOf('zz');
		const other = DOC.indexOf('effort');
		const same = { message: 'Same.' };
		setEngineDiagnostics(view, [
			diag({ ...same }),
			diag({ ...same, from: other, to: other + 6 }),
			diag({ message: 'Second.', severity: 'warning', from: other, to: other + 3 }),
		]);
		const region = () => view.dom.querySelector('.cm-tjp-announce')?.textContent;
		view.dispatch({ selection: { anchor: at } });
		vi.advanceTimersByTime(50);
		expect(region()).toBe('Error: Same.');
		view.dispatch({ selection: { anchor: other + 1 } });
		// Cleared at once, set a moment later.
		expect(region()).toBe('');
		vi.advanceTimersByTime(50);
		expect(region()).toBe('Warning: Second. Error: Same.');
	});
});
