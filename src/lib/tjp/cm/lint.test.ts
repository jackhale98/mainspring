// SPDX-License-Identifier: GPL-2.0-or-later
import { forEachDiagnostic, type Diagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { diagnosticStrings as D, editorStrings as S } from '../../strings';
import type { TjpDiagnostic } from '../diagnostics-types';
import { syntaxDiagnostics } from '../diagnostics';
import { createFile } from '../document';
import {
	drawnDiagnostics,
	redrawDiagnostics,
	setTjpDiagnostics,
	STALE_CLASS,
	tjpDiagnosticsField,
	toLintDiagnostic,
} from './lint';
import { tjpState } from './testing';

const DOC = 'task a "A" {\n  effort 5d\n  depends zz\n}\n';

function diag(over: Partial<TjpDiagnostic>): TjpDiagnostic {
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

/** What @codemirror/lint holds (its own state, as the gutter and marks draw it). */
function lintState(state: EditorState): Array<Diagnostic & { from: number; to: number }> {
	const out: Array<Diagnostic & { from: number; to: number }> = [];
	forEachDiagnostic(state, (d, from, to) => out.push({ ...d, from, to }));
	return out;
}

const base = (): EditorState => tjpState(DOC, { path: 'plan.tjp' });

describe('setTjpDiagnostics', () => {
	it('draws this file’s diagnostics with severity, source label and hint', () => {
		const list = [
			diag({}),
			diag({
				source: 'attribute',
				severity: 'warning',
				from: 15,
				to: 21,
				message: 'Effort is not a custom attribute.',
				hint: D.didYouMean('effort'),
			}),
			diag({ file: 'other.tji' }),
		];
		const s = base().update(setTjpDiagnostics(base(), list)).state;
		const drawn = lintState(s);
		expect(drawn).toHaveLength(2);
		expect(drawn[0]).toMatchObject({
			from: 15,
			to: 21,
			severity: 'warning',
			source: S.lint.source.attribute,
		});
		expect(drawn[0]?.message).toBe(
			S.lint.message('Effort is not a custom attribute.', D.didYouMean('effort')),
		);
		expect(drawn[1]).toMatchObject({
			severity: 'error',
			source: S.lint.source.engine,
			message: "Task 'zz' is unknown.",
		});
	});

	it('never draws precision none', () => {
		const s = base().update(
			setTjpDiagnostics(base(), [
				diag({ precision: 'none', from: 0, to: 0, line: null, column: null }),
			]),
		).state;
		expect(lintState(s)).toEqual([]);
		expect(drawnDiagnostics(s)).toEqual([]);
	});

	it('keeps the engine and local channels apart', () => {
		const file = createFile('plan.tjp', 'task a "A" {\n  effrot 5d\n}\n');
		const local = syntaxDiagnostics(file);
		expect(local.length).toBeGreaterThan(0);
		let s = tjpState(file.text.toString(), { path: 'plan.tjp' });
		s = s.update(setTjpDiagnostics(s, local, 'local')).state;
		s = s.update(setTjpDiagnostics(s, [diag({ from: 2, to: 4 })], 'engine')).state;
		expect(
			lintState(s)
				.map((d) => d.source)
				.sort(),
		).toEqual([S.lint.source.engine, S.lint.source.syntax].sort());
		s = s.update(setTjpDiagnostics(s, [], 'engine')).state;
		expect(lintState(s).map((d) => d.source)).toEqual([S.lint.source.syntax]);
	});

	it('clamps ranges to the document', () => {
		const s = base().update(
			setTjpDiagnostics(base(), [diag({ from: DOC.length - 1, to: DOC.length + 50 })]),
		).state;
		expect(drawnDiagnostics(s)[0]).toMatchObject({ from: DOC.length - 1, to: DOC.length });
		expect(lintState(s)).toHaveLength(1);
	});

	it('works without the lint extension configured', () => {
		const s0 = tjpState(DOC, { path: 'plan.tjp', gutter: false });
		const s = s0.update(setTjpDiagnostics(s0, [diag({})])).state;
		expect(s.field(tjpDiagnosticsField).engine).toHaveLength(1);
	});
});

describe('stale engine diagnostics', () => {
	it('are mapped through edits, marked stale, and dimmed on redraw', () => {
		let s = base();
		s = s.update(setTjpDiagnostics(s, [diag({})])).state;
		s = s.update({ changes: { from: 0, insert: '# new\n' } }).state;
		const field = s.field(tjpDiagnosticsField);
		expect(field.dirty).toBe(true);
		expect(field.engine[0]).toMatchObject({
			stale: true,
			from: DOC.indexOf('zz') + 6,
			to: DOC.indexOf('zz') + 8,
		});
		// @codemirror/lint mapped its own marks the same way.
		expect(lintState(s)[0]).toMatchObject({
			from: DOC.indexOf('zz') + 6,
			to: DOC.indexOf('zz') + 8,
		});
		s = s.update(redrawDiagnostics(s)).state;
		expect(s.field(tjpDiagnosticsField).dirty).toBe(false);
		const drawn = lintState(s)[0];
		expect(drawn?.markClass).toBe(STALE_CLASS);
		expect(drawn?.message).toBe(S.lint.staleMessage("Task 'zz' is unknown."));
	});

	it('are replaced, not stale, by the next result', () => {
		let s = base();
		s = s.update(setTjpDiagnostics(s, [diag({})])).state;
		s = s.update({ changes: { from: 0, insert: ' ' } }).state;
		s = s.update(setTjpDiagnostics(s, [diag({ from: 1, to: 5, revision: 2 })])).state;
		expect(s.field(tjpDiagnosticsField)).toMatchObject({
			dirty: false,
			engine: [{ stale: false, from: 1 }],
		});
	});

	it('local diagnostics move with the text but do not turn stale', () => {
		let s = base();
		s = s.update(setTjpDiagnostics(s, [diag({ source: 'syntax', revision: null })], 'local')).state;
		s = s.update({ changes: { from: 0, insert: '  ' } }).state;
		const f = s.field(tjpDiagnosticsField);
		expect(f.dirty).toBe(false);
		expect(f.local[0]).toMatchObject({ stale: false, from: DOC.indexOf('zz') + 2 });
	});

	it('a deleted range collapses to a point', () => {
		let s = base();
		s = s.update(setTjpDiagnostics(s, [diag({})])).state;
		const at = DOC.indexOf('zz');
		s = s.update({ changes: { from: at - 1, to: at + 2 } }).state;
		expect(s.field(tjpDiagnosticsField).engine[0]).toMatchObject({ from: at - 1, to: at - 1 });
	});
});

describe('toLintDiagnostic', () => {
	it('maps info severity and the value source', () => {
		expect(toLintDiagnostic(diag({ severity: 'info', source: 'value' }))).toMatchObject({
			severity: 'info',
			source: S.lint.source.value,
		});
		expect(toLintDiagnostic(diag({})).markClass).toBeUndefined();
	});
});

describe('tjpLint', () => {
	it('binds the lint keys (F8 next problem, Mod-Shift-m the list)', () => {
		const keys = tjpState('x')
			.facet(keymap)
			.flat()
			.map((b) => b.key);
		expect(keys).toEqual(expect.arrayContaining(['F8', 'Mod-Shift-m']));
	});
});
