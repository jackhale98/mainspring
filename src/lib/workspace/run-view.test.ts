// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { engineDiagnostics, type TjpDiagnostic } from '../tjp/diagnostics';
import { buildIndex, NO_HINTS } from '../tjp/index';
import {
	changesFrom,
	countDiagnostics,
	engineDiagnosticsNow,
	hintsNow,
	indexNow,
	isHintSource,
	sentHints,
	viewNow,
	type HintBase,
} from './run-view';
import { message, result, task } from './testing/fake-engine-client';
import { createWorkspace, type Workspace } from './workspace';

const PLAN = 'macro tid [t1]\nproject p "P" 2026-01-05 +1m\ntask ${tid} "T" {\n  effort 1d\n}\n';
const R = result(1, { tasks: [task('t1', 3, 600)], messages: [message('warning', 4)] });

function setup(logLimit?: number): { ws: Workspace; base: HintBase } {
	const ws = createWorkspace(
		{ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } },
		logLimit === undefined ? {} : { logLimit },
	);
	const snapshot = ws.snapshot();
	return { ws, base: { snapshot, result: R, hints: sentHints(R, snapshot) } };
}

function type(ws: Workspace, insert: string): void {
	const state = ws.state('plan.tjp');
	ws.commit('plan.tjp', state.update({ changes: { from: 0, insert } }), 'typing');
}

describe('isHintSource', () => {
	it('is false only for a result that stopped while parsing', () => {
		expect(isHintSource(result(1))).toBe(true);
		expect(isHintSource(result(1, { ok: false }))).toBe(false);
		expect(isHintSource(result(1, { ok: false, tasks: [task('a', 1, 0)] }))).toBe(true);
	});
});

describe('hints and engine diagnostics now', () => {
	it('fingerprints the sent hints and maps them through later edits', () => {
		const { ws, base } = setup();
		expect(base.hints.tasks).toEqual([
			{ id: 't1', parent: null, file: 'plan.tjp', line: 3, text: 'task ${tid} "T" {' },
		]);
		expect(hintsNow(ws, ws.snapshot(), null)).toBe(NO_HINTS);
		expect(hintsNow(ws, ws.snapshot(), base)).toBe(base.hints);
		type(ws, '# a\n');
		expect(hintsNow(ws, ws.snapshot(), base).tasks.map((h) => h.line)).toEqual([4]);
		expect(indexNow(ws, ws.snapshot(), base).index.tasks.get('t1')?.decl.header.from).toBe(
			PLAN.indexOf('task') + 4,
		);
	});

	it('maps engine diagnostics as stale, and drops what the workspace no longer keeps', () => {
		const { ws, base } = setup(4);
		const sent = base.snapshot;
		const diagnostics = engineDiagnostics(R, sent, buildIndex(sent, base.hints));
		const dBase = { snapshot: sent, diagnostics };
		expect(engineDiagnosticsNow(ws, sent, dBase)).toBe(diagnostics);
		expect(engineDiagnosticsNow(ws, sent, null)).toEqual([]);
		type(ws, '# a\n');
		expect(engineDiagnosticsNow(ws, ws.snapshot(), dBase).map((d) => [d.line, d.stale])).toEqual([
			[5, true],
		]);
		for (let i = 0; i < 6; i++) type(ws, '#\n');
		const now = ws.snapshot();
		expect(changesFrom(ws, now, sent.version)).toBeNull();
		expect(changesFrom(ws, now, now.version)?.size).toBe(0);
		expect(engineDiagnosticsNow(ws, now, dBase)).toEqual([]);
		expect(hintsNow(ws, now, base)).toBe(NO_HINTS);
	});
});

describe('viewNow', () => {
	it('merges mapped engine and local diagnostics and counts them', () => {
		const { ws, base } = setup();
		const sent = base.snapshot;
		const diagnostics = engineDiagnostics(R, sent, buildIndex(sent, base.hints));
		type(ws, 'task broken "B" {\n');
		const view = viewNow(ws, ws.snapshot(), base, { snapshot: sent, diagnostics });
		expect(view.version).toBe(1);
		expect(view.diagnostics.map((d) => d.source).sort()).toEqual(['engine', 'syntax']);
		expect(view.counts).toEqual({ errors: 1, warnings: 1, infos: 0 });
		expect(view.index.tasks.get('t1')?.idSource).toBe('engine');
	});

	it('reuses a prepared index of the same version only', () => {
		const { ws, base } = setup();
		const prepared = indexNow(ws, ws.snapshot(), base);
		expect(viewNow(ws, ws.snapshot(), base, null, prepared).index).toBe(prepared.index);
		type(ws, '# a\n');
		expect(viewNow(ws, ws.snapshot(), base, null, prepared).index).not.toBe(prepared.index);
	});
});

describe('countDiagnostics', () => {
	it('counts by severity', () => {
		const d = (severity: TjpDiagnostic['severity']) => ({ severity }) as TjpDiagnostic;
		expect(countDiagnostics([d('error'), d('info'), d('warning'), d('error')])).toEqual({
			errors: 2,
			warnings: 1,
			infos: 1,
		});
	});
});
