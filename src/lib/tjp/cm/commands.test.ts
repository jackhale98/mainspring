// SPDX-License-Identifier: GPL-2.0-or-later
import { history, undo } from '@codemirror/commands';
import { getIndentUnit } from '@codemirror/language';
import {
	EditorSelection,
	EditorState,
	type Transaction,
	type TransactionSpec,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { createHistory } from '../../workspace/history';
import {
	createWorkspace,
	tjpEditId,
	type ChangeOrigin,
	type Workspace,
} from '../../workspace/workspace';
import {
	formatCommand,
	formatTransaction,
	originOf,
	tjpKeymap,
	tjpOrigin,
	workspaceDispatch,
} from './commands';
import { formatFile as editFormatFile } from '../edit/apply';
import type { FormatOutcome } from './env';
import { workspaceExtensions } from './index';
import { TABLE_ONLY, tjpState } from './testing';

/** Enough of an EditorView for commands: a state, dispatch and update. */
class FakeView {
	constructor(
		public state: EditorState,
		private readonly hook?: (trs: readonly Transaction[], view: EditorView) => void,
	) {}

	/** An arrow, because state commands such as `undo` call it unbound. */
	readonly dispatch = (spec: TransactionSpec | Transaction): void => {
		const tr = 'startState' in spec ? spec : this.state.update(spec);
		if (this.hook) this.hook([tr], this.asView());
		else this.update([tr]);
	};

	update(trs: readonly Transaction[]): void {
		const last = trs[trs.length - 1];
		if (last) this.state = last.state;
	}

	setState(state: EditorState): void {
		this.state = state;
	}

	asView(): EditorView {
		return this as unknown as EditorView;
	}
}

const MESSY = 'task a "A" {\neffort 5d\n      task b "B" {\n  depends !!a   \n}\n}\n';
const TIDY = 'task a "A" {\n  effort 5d\n  task b "B" {\n    depends !!a\n  }\n}\n';

describe('formatTransaction', () => {
	it('formats the whole file as one format transaction', () => {
		const state = tjpState(MESSY);
		const { spec, outcome } = formatTransaction(state);
		expect(outcome).toMatchObject({ status: 'formatted', unit: '  ' });
		if (!spec) throw new Error('expected changes');
		const tr = state.update(spec);
		expect(tr.state.doc.toString()).toBe(TIDY);
		expect(tr.annotation(tjpOrigin)).toBe('format');
		expect(tr.isUserEvent('input.tjp.format')).toBe(true);
	});

	it('formats only the selected lines', () => {
		const at = MESSY.indexOf('effort');
		const state = tjpState(MESSY).update({ selection: EditorSelection.range(at, at + 3) }).state;
		const { spec } = formatTransaction(state);
		if (!spec) throw new Error('expected changes');
		expect(state.update(spec).state.doc.toString()).toBe(MESSY.replace('\neffort', '\n  effort'));
	});

	it('refuses a file with syntax errors and reports a formatted file as unchanged', () => {
		const bad = formatTransaction(tjpState('task a "A" {\n effrot 5d\n}\n'));
		expect(bad.spec).toBeNull();
		expect(bad.outcome).toMatchObject({ status: 'refused', reason: 'syntax-error' });
		expect(formatTransaction(tjpState(TIDY))).toEqual({
			spec: null,
			outcome: { status: 'unchanged' },
		});
	});

	it('keeps CR characters and sets the indent unit it formatted with', () => {
		const crlf = 'task a "A" {\r\n\teffort 5d\r\n\t\ttask b "B" {\r\n\t}\r\n}\r\n';
		const state = tjpState(crlf);
		const { spec } = formatTransaction(state);
		if (!spec) throw new Error('expected changes');
		const after = state.update(spec).state;
		expect(after.doc.toString()).toBe(
			'task a "A" {\r\n\teffort 5d\r\n\ttask b "B" {\r\n\t}\r\n}\r\n',
		);
		expect(getIndentUnit(after)).toBe(after.tabSize);
	});
});

describe('formatCommand', () => {
	it('dispatches the format and reports the outcome', () => {
		const outcomes: FormatOutcome[] = [];
		const view = new FakeView(tjpState(MESSY, { onFormat: (o) => outcomes.push(o) }));
		expect(formatCommand(view.asView())).toBe(true);
		expect(view.state.doc.toString()).toBe(TIDY);
		expect(formatCommand(view.asView())).toBe(true);
		expect(outcomes.map((o) => o.status)).toEqual(['formatted', 'unchanged']);
	});

	it('is bound to Shift-Alt-f, and on macOS to a key that types no text', () => {
		const fmt = tjpKeymap.find((k) => k.run === formatCommand);
		expect(fmt).toMatchObject({ key: 'Shift-Alt-f', mac: 'Mod-Alt-Shift-f' });
		expect(tjpKeymap.map((k) => k.key)).toEqual(['Shift-Alt-f', 'Mod-k Mod-i', 'Escape', 'Enter']);
	});

	it('does nothing in a read-only editor', () => {
		const outcomes: FormatOutcome[] = [];
		const state = tjpState(MESSY, {
			onFormat: (o) => outcomes.push(o),
			extra: EditorState.readOnly.of(true),
		});
		const view = new FakeView(state);
		expect(formatCommand(view.asView())).toBe(false);
		expect(view.state.doc.toString()).toBe(MESSY);
		expect(outcomes).toEqual([]);
	});

	it('is its own undo step: typing right after it is not joined to it', () => {
		const view = new FakeView(tjpState(MESSY, { extra: history() }));
		formatCommand(view.asView());
		view.dispatch({
			changes: { from: 'task a "A" {\n  '.length, insert: 'x' },
			userEvent: 'input.type',
		});
		undo(view);
		expect(view.state.doc.toString()).toBe(TIDY);
		undo(view);
		expect(view.state.doc.toString()).toBe(MESSY);
	});
});

describe('through the workspace', () => {
	let lastTr: Transaction | null = null;
	function setup(): { ws: Workspace; view: FakeView; origins: ChangeOrigin[] } {
		let ws: Workspace | null = null;
		ws = createWorkspace(
			{ entry: 'plan.tjp', files: { 'plan.tjp': MESSY } },
			{
				extensions: workspaceExtensions({
					docs: () => TABLE_ONLY,
					theme: false,
					workspace: () => ws,
				}),
			},
		);
		const workspace = ws;
		const origins: ChangeOrigin[] = [];
		workspace.subscribe((_s, origin, info) => {
			origins.push(origin);
			lastTr = info.transactions[info.transactions.length - 1] ?? null;
		});
		const view = new FakeView(
			workspace.state('plan.tjp'),
			workspaceDispatch(workspace, () => 'plan.tjp'),
		);
		return { ws: workspace, view, origins };
	}

	it('commits the format with origin format, as one undo step of the workspace history', () => {
		const { ws, view, origins } = setup();
		const history = createHistory(ws);
		formatCommand(view.asView());
		expect(origins).toEqual(['format']);
		expect(ws.texts()['plan.tjp']).toBe(TIDY);
		expect(lastTr?.annotation(tjpEditId)).toMatch(/./);
		expect(lastTr?.isUserEvent('input.tjp.format')).toBe(true);
		expect(view.state).toBe(ws.state('plan.tjp'));
		expect(history.top()).toMatchObject({ kind: 'format', id: lastTr?.annotation(tjpEditId) });
		expect(history.undo()).toMatchObject({ status: 'done', direction: 'undo' });
		expect(ws.texts()['plan.tjp']).toBe(MESSY);
		expect(origins).toEqual(['format', 'history']);
	});

	it('refuses through the edit API on syntax errors, and formats the selection only', () => {
		const { ws, view } = setup();
		const at = MESSY.indexOf('effort');
		view.dispatch({ selection: EditorSelection.range(at, at + 2) });
		formatCommand(view.asView());
		expect(ws.texts()['plan.tjp']).toBe(MESSY.replace('\neffort', '\n  effort'));
		view.dispatch({ changes: { from: 0, insert: '}' } });
		expect(formatTransaction(view.state).outcome).toMatchObject({
			status: 'refused',
			reason: 'syntax-error',
		});
	});

	it('refuses as stale when the view does not hold the workspace state', () => {
		const { ws } = setup();
		const copy = ws.state('plan.tjp').update({ selection: { anchor: 0 } }).state;
		expect(formatTransaction(copy).outcome).toMatchObject({ status: 'refused', reason: 'stale' });
	});

	it('keeps Workspace.apply edits apart from later typing in the history', () => {
		const { ws } = setup();
		const history = createHistory(ws);
		const r = editFormatFile(ws.snapshot(), 'plan.tjp');
		if (r.status !== 'edit') throw new Error('expected an edit');
		expect(ws.apply(r.edit)).toBe('applied');
		const s = ws.state('plan.tjp');
		// Right after the indentation the format inserted, so the history could join the two.
		const at = 'task a "A" {\n  '.length;
		const typed = s.update({ changes: { from: at, insert: 'x' }, userEvent: 'input.type' });
		ws.commit('plan.tjp', typed, 'typing');
		history.undo();
		expect(ws.texts()['plan.tjp']).toBe(TIDY);
		history.undo();
		expect(ws.texts()['plan.tjp']).toBe(MESSY);
	});

	it('takes the workspace state when the workspace replaced it', () => {
		// A workspace that reconfigures the file on commit (as on a parse-context change).
		let held = tjpState(MESSY);
		const replaced = tjpState(TIDY);
		const stub = {
			commit: (_p: string, trs: readonly Transaction[]) => {
				held = trs[trs.length - 1]?.state ?? held;
				if (held.doc.toString().startsWith('#')) held = replaced;
			},
			state: () => held,
		} as unknown as Workspace;
		const view = new FakeView(
			held,
			workspaceDispatch(stub, () => 'plan.tjp'),
		);
		view.dispatch({ changes: { from: 0, insert: ' ' } });
		expect(view.state.doc.toString()).toBe(` ${MESSY}`);
		view.dispatch({ changes: { from: 0, insert: '#' } });
		expect(view.state).toBe(replaced);
	});

	it('commits typing as typing', () => {
		const { ws, view, origins } = setup();
		view.dispatch({ changes: { from: 0, insert: '# x\n' } });
		expect(origins).toEqual(['typing']);
		expect(ws.texts()['plan.tjp']).toBe(`# x\n${MESSY}`);
	});
});

describe('originOf', () => {
	it('prefers format, then intent, else typing', () => {
		const s = tjpState('x');
		const typing = s.update({ changes: { from: 0, insert: 'a' } });
		const fmt = s.update({ annotations: tjpOrigin.of('format') });
		const intent = s.update({ annotations: tjpEditId.of('e1') });
		expect(originOf([typing])).toBe('typing');
		expect(originOf([typing, intent])).toBe('intent');
		expect(originOf([intent, fmt])).toBe('format');
	});
});
