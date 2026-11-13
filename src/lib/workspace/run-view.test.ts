// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { engineDiagnostics, localDiagnostics, type TjpDiagnostic } from '../tjp/diagnostics';
import { buildIndex, NO_HINTS } from '../tjp/index';
import { fixture } from '../tjp/index/testing';
import {
	changesFrom,
	checksOf,
	checksOfView,
	composeView,
	countDiagnostics,
	engineDiagnosticsNow,
	fullView,
	hintsNow,
	isHintSource,
	prepareIndex,
	quickView,
	runnerStatus,
	sameHints,
	sentHints,
	type HintBase,
} from './run-view';
import { message, result, task } from './testing/fake-engine-client';
import { createWorkspace, type Workspace } from './workspace';

const PLAN =
	'macro tid [t1]\nproject p "P" 2026-01-05 +1m\ntask ${tid} "T" {\n  effort 1d\n}\ntask b "B" {\n  effort 0d\n}\n';
const R = result(1, { tasks: [task('t1', 3, 600)], messages: [message('warning', 4)] });

function setup(logLimit?: number): { ws: Workspace; base: HintBase } {
	const ws = createWorkspace(
		{ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } },
		logLimit === undefined ? {} : { logLimit },
	);
	const snapshot = ws.snapshot();
	return { ws, base: { snapshot, result: R, hints: sentHints(R, snapshot) } };
}

function type(ws: Workspace, insert: string, at = 0, to = at): void {
	const state = ws.state('plan.tjp');
	ws.commit('plan.tjp', state.update({ changes: { from: at, to, insert } }), 'typing');
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
		const p = prepareIndex(ws, ws.snapshot(), base);
		expect(p.index.tasks.get('t1')?.decl.header.from).toBe(PLAN.indexOf('task') + 4);
	});

	it('drops every hint once a macro definition changed', () => {
		const { ws, base } = setup();
		const at = PLAN.indexOf('t1]');
		type(ws, 'zz', at, at + 2);
		expect(hintsNow(ws, ws.snapshot(), base)).toBe(NO_HINTS);
		expect(prepareIndex(ws, ws.snapshot(), base).index.tasks.has('t1')).toBe(false);
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

describe('fullView and quickView', () => {
	it('merges mapped engine and local diagnostics and counts them', () => {
		const { ws, base } = setup();
		const sent = base.snapshot;
		const diagnostics = engineDiagnostics(R, sent, buildIndex(sent, base.hints));
		type(ws, 'task broken "B" {\n', PLAN.length);
		const view = fullView(ws, ws.snapshot(), base, { snapshot: sent, diagnostics });
		expect(view).toMatchObject({ version: 1, indexVersion: 1 });
		expect(view.diagnostics.map((d) => d.source).sort()).toEqual(['engine', 'syntax', 'value']);
		expect(view.counts).toEqual({ errors: 2, warnings: 1, infos: 0 });
		expect(view.index.tasks.get('t1')?.idSource).toBe('engine');
	});

	it('gives the local diagnostics localDiagnostics gives', () => {
		for (const name of ['neg-unterminated-string', 'neg-junk-after-cut']) {
			const ws = fixture(name);
			const now = ws.snapshot();
			const view = fullView(ws, now, null, null);
			expect(view.diagnostics).toEqual(localDiagnostics(now, view.index));
		}
		const { ws } = setup();
		const view = fullView(ws, ws.snapshot(), null, null);
		expect(view.diagnostics).toEqual(localDiagnostics(ws.snapshot(), view.index));
		expect(view.checks.map((d) => d.source)).toEqual(['value']);
	});

	it('keeps the index part on a keystroke and brings diagnostics to the text', () => {
		const { ws, base } = setup();
		const prev = fullView(ws, ws.snapshot(), base, null);
		type(ws, '# a\n');
		type(ws, 'task broken "B" {\n', PLAN.length + 4);
		const quick = quickView(ws, ws.snapshot(), prev, null);
		expect(quick).toMatchObject({ version: 2, indexVersion: 0 });
		expect(quick.index).toBe(prev.index);
		expect(quick.hints).toBe(prev.hints);
		expect(quick.checks).toBe(prev.checks);
		const value = quick.diagnostics.find((d) => d.source === 'value');
		expect(value).toMatchObject({ line: 8, stale: true });
		expect(quick.diagnostics.some((d) => d.source === 'syntax')).toBe(true);
		const full = fullView(ws, ws.snapshot(), base, null);
		expect(full.diagnostics.find((d) => d.source === 'value')).toMatchObject({
			line: 8,
			stale: false,
		});
	});

	it('reuses an index of the same version with equal hints', () => {
		const { ws, base } = setup();
		const prepared = prepareIndex(ws, ws.snapshot(), base);
		expect(prepareIndex(ws, ws.snapshot(), base, prepared)).toBe(prepared);
		const other = { ...base, hints: NO_HINTS };
		expect(prepareIndex(ws, ws.snapshot(), other, prepared)).not.toBe(prepared);
		expect(fullView(ws, ws.snapshot(), base, null, prepared).index).toBe(prepared.index);
		type(ws, '# a\n');
		expect(prepareIndex(ws, ws.snapshot(), base, prepared)).not.toBe(prepared);
		expect(fullView(ws, ws.snapshot(), base, null, prepared).index).not.toBe(prepared.index);
	});
});

describe('composeView and checksOf (parts of their own versions)', () => {
	it('maps checks of an older version to a newer index part, then replaces them', () => {
		const { ws, base } = setup();
		const prev = fullView(ws, ws.snapshot(), base, null);
		const line = (v: { diagnostics: readonly TjpDiagnostic[] }) =>
			v.diagnostics.find((d) => d.source === 'value');
		expect(line(prev)).toMatchObject({ line: 7, stale: false });
		type(ws, '# a\n');
		const now = ws.snapshot();
		const part = prepareIndex(ws, now, base);
		const linked = composeView(ws, now, part, checksOfView(prev), null);
		expect(linked).toMatchObject({ version: 1, indexVersion: 1, checksVersion: 0 });
		expect(linked.index).toBe(part.index);
		expect(linked.checks).toBe(prev.checks);
		expect(line(linked)).toMatchObject({ line: 8, stale: true });
		const checks = checksOf(linked);
		expect(checks.version).toBe(1);
		const checked = composeView(ws, now, linked, checks, null);
		expect(checked).toMatchObject({ version: 1, indexVersion: 1, checksVersion: 1 });
		expect(line(checked)).toMatchObject({ line: 8, stale: false });
		expect(checked.diagnostics).toEqual(fullView(ws, now, base, null).diagnostics);
	});

	it('drops checks whose changes the workspace no longer keeps', () => {
		const { ws, base } = setup(4);
		const prev = fullView(ws, ws.snapshot(), base, null);
		for (let i = 0; i < 6; i++) type(ws, '#\n');
		const now = ws.snapshot();
		const view = composeView(ws, now, prev, checksOfView(prev), null);
		expect(view.diagnostics.filter((d) => d.source === 'value')).toEqual([]);
	});
});

describe('sameHints, countDiagnostics and runnerStatus', () => {
	it('compares hints entry by entry', () => {
		const { base } = setup();
		const copy = { tasks: base.hints.tasks.map((e) => ({ ...e })), resources: [] };
		expect(sameHints(base.hints, copy)).toBe(true);
		const moved = { tasks: base.hints.tasks.map((e) => ({ ...e, line: 9 })), resources: [] };
		expect(sameHints(base.hints, moved)).toBe(false);
		expect(sameHints(base.hints, NO_HINTS)).toBe(false);
	});

	it('counts by severity', () => {
		const d = (severity: TjpDiagnostic['severity']) => ({ severity }) as TjpDiagnostic;
		expect(countDiagnostics([d('error'), d('info'), d('warning'), d('error')])).toEqual({
			errors: 2,
			warnings: 1,
			infos: 1,
		});
	});

	it('orders the status rules', () => {
		const s = { engine: 'idle' as const, pending: false, failed: false, latestOk: true, errors: 0 };
		expect(runnerStatus(s)).toBe('ok');
		expect(runnerStatus({ ...s, errors: 1 })).toBe('errors');
		expect(runnerStatus({ ...s, latestOk: false })).toBe('errors');
		expect(runnerStatus({ ...s, latestOk: null })).toBe('idle');
		expect(runnerStatus({ ...s, failed: true })).toBe('failed');
		expect(runnerStatus({ ...s, failed: true, pending: true })).toBe('scheduling');
		expect(runnerStatus({ ...s, pending: true, engine: 'failed' })).toBe('failed');
	});
});
