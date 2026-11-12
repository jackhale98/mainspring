// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../index';
import { removeStatement } from './layout';
import { mapHints } from './task-hints';
import { snapshotAfter } from './task-verify';
import { setup, stmt } from './testing';

const PLAN =
	'project p "P" 2026-01-05 +2m\nmacro id [ m ]\ntask x "X"\ntask ${id} "M" {\n  task c "C"\n}\n';

describe('mapHints', () => {
	const s = setup(PLAN);
	const hints = {
		tasks: [
			{ id: 'x', parent: null, file: 'plan.tjp', line: 3, text: 'task x "X"' },
			{ id: 'm', parent: null, file: 'plan.tjp', line: 4, text: 'task ${id} "M" {' },
			{ id: 'm.c', parent: 'm', file: 'plan.tjp', line: 5, text: '  task c "C"' },
		],
		resources: [],
	};
	const index = buildIndex(s.snap, hints);
	const ctx = { ...s.ctx, index };

	it('carries the hints of untouched header lines to their new lines', () => {
		const f = s.file();
		const next = snapshotAfter(s.snap, [removeStatement(f, stmt(f, 'task x'))]);
		const m = mapHints(index, s.snap, next.snap, next.changes, (id) => id);
		expect(m.used).toBe(true);
		expect(m.hints.tasks.find((h) => h.id === 'm')?.line).toBe(3);
		expect(m.kept.has('x')).toBe(false);
		expect(m.kept.has('m.c')).toBe(true);
		expect(buildIndex(next.snap, m.hints).tasks.get('m.c')?.parent).toBe('m');
		expect(ctx.index.tasks.get('m')?.idSource).toBe('engine');
	});

	it('maps ids through the intent and drops deleted ones', () => {
		const next = snapshotAfter(s.snap, []);
		const m = mapHints(index, s.snap, next.snap, next.changes, (id) => (id === 'm.c' ? null : id));
		expect(m.hints.tasks.map((h) => h.id).sort()).toEqual(['m', 'x']);
	});

	it('does nothing for an index built without hints', () => {
		const bare = buildIndex(setup('project p "P" 2026-01-05 +2m\ntask a "A"\n').snap);
		const m = mapHints(bare, s.snap, s.snap, new Map(), (id) => id);
		expect(m.used).toBe(false);
		expect(m.hints.tasks).toEqual([]);
	});
});
