// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import {
	WINDOW_THRESHOLD,
	buildOutline,
	errorCounts,
	visibleRows,
	windowRows,
	type OutlineNode,
} from './outline';

const PLAN = `project p "P" 2026-01-05 +30d
resource dev "Developer"
resource team "Team" {
  resource a "Anna"
  resource b "Ben"
}
task app "App" {
  task ui "UI" { effort 2d }
  task api "API" { effort 3d }
}
task docs "Docs"
`;

function outlineOf(files: Record<string, string>, entry = 'plan.tjp') {
	const ws = inline(files, entry);
	const snap = ws.snapshot();
	const index = buildIndex(snap);
	const textOf = (r: { file: string; from: number; to: number }) =>
		snap.files.get(r.file)?.text.sliceString(r.from, r.to) ?? null;
	return { ws, snap, outline: buildOutline(index, textOf) };
}

const label = (n: OutlineNode) => `${' '.repeat(n.level - 1)}${n.localId}`;

describe('buildOutline', () => {
	it('lists tasks and resources as trees in declaration order', () => {
		const { outline } = outlineOf({ 'plan.tjp': PLAN });
		expect(outline.tasks.map(label)).toEqual(['app', ' ui', ' api', 'docs']);
		expect(outline.resources.map(label)).toEqual(['dev', 'team', ' a', ' b']);
		const app = outline.tasks[0];
		expect(app).toMatchObject({ id: 'app', name: 'App', level: 1, posinset: 1, setsize: 2 });
		expect(app?.children).toEqual(['task:app.ui', 'task:app.api']);
		expect(outline.tasks[2]).toMatchObject({ id: 'app.api', posinset: 2, setsize: 2, level: 2 });
		expect(outline.byKey.get('resource:a')?.parent).toBe('resource:team');
	});

	it('points at the declared id', () => {
		const { outline, snap } = outlineOf({ 'plan.tjp': PLAN });
		const ui = outline.byKey.get('task:app.ui');
		const text = snap.files.get('plan.tjp')?.text.sliceString(ui?.at.from ?? 0, ui?.at.to ?? 0);
		expect(text).toBe('ui');
	});

	it('marks macro ids as unresolved text, showing the id as written, in file order', () => {
		const { outline } = outlineOf({
			'plan.tjp': `project p "P" 2026-01-05 +30d
macro n [x]
task top "Top" {
  task one "One"
  task \${n} "Macro id"
  task two "Two"
}
`,
		});
		expect(outline.tasks.map((n) => [n.localId, n.textOnly])).toEqual([
			['top', null],
			['one', null],
			['${n}', 'unresolved'],
			['two', null],
		]);
		const macro = outline.tasks[2];
		expect(macro).toMatchObject({ id: null, name: 'Macro id', level: 2, parent: 'task:top' });
		expect(macro?.key).toMatch(/^task:unresolved:/);
	});
});

describe('visibleRows', () => {
	const { outline } = outlineOf({ 'plan.tjp': PLAN });

	it('shows everything when nothing is collapsed', () => {
		const rows = visibleRows(outline.tasks, new Set());
		expect(rows.map((r) => r.node.localId)).toEqual(['app', 'ui', 'api', 'docs']);
		expect(rows.map((r) => [r.expandable, r.expanded])).toEqual([
			[true, true],
			[false, false],
			[false, false],
			[false, false],
		]);
	});

	it('hides the descendants of a collapsed node and keeps its siblings', () => {
		const rows = visibleRows(outline.tasks, new Set(['task:app']));
		expect(rows.map((r) => r.node.localId)).toEqual(['app', 'docs']);
		expect(rows[0]).toMatchObject({ expandable: true, expanded: false });
	});

	it('hides nested levels below a collapsed node only', () => {
		const rows = visibleRows(outline.resources, new Set(['resource:team']));
		expect(rows.map((r) => r.node.localId)).toEqual(['dev', 'team']);
	});
});

describe('errorCounts', () => {
	const { outline } = outlineOf({ 'plan.tjp': PLAN });
	const ui = outline.byKey.get('task:app.ui');
	const diag = (from: number, over: Partial<TjpDiagnostic> = {}): TjpDiagnostic => ({
		file: 'plan.tjp',
		from,
		to: from + 1,
		severity: 'error',
		source: 'engine',
		messageId: 'm',
		message: 'm',
		hint: null,
		scenario: null,
		precision: 'token',
		line: 1,
		column: 1,
		revision: 1,
		stale: false,
		...over,
	});

	it('counts errors in every node that contains them', () => {
		const at = (ui?.block.from ?? 0) + 2;
		const counts = errorCounts(outline.tasks, [diag(at), diag(at + 1)]);
		expect(counts.get('task:app.ui')).toBe(2);
		expect(counts.get('task:app')).toBe(2);
		expect(counts.get('task:docs')).toBeUndefined();
	});

	it('ignores warnings, other files and messages without a place', () => {
		const at = ui?.block.from ?? 0;
		const counts = errorCounts(outline.tasks, [
			diag(at, { severity: 'warning' }),
			diag(at, { file: 'other.tji' }),
			diag(at, { precision: 'none' }),
			diag(at, { file: null }),
		]);
		expect(counts.size).toBe(0);
	});
});

describe('windowRows', () => {
	it('renders everything of a short list', () => {
		expect(windowRows(WINDOW_THRESHOLD, 500, 300, 36)).toEqual({
			start: 0,
			end: WINDOW_THRESHOLD,
			before: 0,
			after: 0,
		});
	});

	it('renders the rows in view plus an overscan, with spacers for the rest', () => {
		const w = windowRows(1000, 3600, 360, 36, 5);
		expect(w.start).toBe(95);
		expect(w.end).toBe(115);
		expect(w.before).toBe(95 * 36);
		expect(w.after).toBe(885 * 36);
	});

	it('clamps at both ends', () => {
		const top = windowRows(1000, 0, 360, 36, 5);
		expect(top.start).toBe(0);
		const bottom = windowRows(1000, 1_000_000, 360, 36, 5);
		expect(bottom.end).toBe(1000);
		expect(bottom.after).toBe(0);
		expect(bottom.start).toBeLessThanOrEqual(bottom.end);
	});
});
