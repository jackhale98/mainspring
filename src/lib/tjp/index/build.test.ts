// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildIndex, createFactsCache } from './index';
import { factsOf } from './build';
import { golden } from './testing';

describe('buildIndex', () => {
	it('rescans only the files a change touched', () => {
		const ws = golden('syn-18-structure-include-macro');
		const cache = createFactsCache();
		const before = ws.snapshot();
		buildIndex(before, undefined, { cache });
		const state = ws.state('lib/tasks.tji');
		ws.commit('lib/tasks.tji', state.update({ changes: { from: 0, insert: '# x\n' } }), 'typing');
		const after = ws.snapshot();
		const idx = buildIndex(after, undefined, { cache });
		const plan = (s: typeof before) => s.files.get('plan.tjp');
		const tasks = (s: typeof before) => s.files.get('lib/tasks.tji');
		const p0 = plan(before);
		const p1 = plan(after);
		const t0 = tasks(before);
		const t1 = tasks(after);
		if (!p0 || !p1 || !t0 || !t1) throw new Error('files');
		expect(p1).toBe(p0);
		expect(factsOf(p1, cache)).toBe(factsOf(p0, cache));
		expect(factsOf(t1, cache)).not.toBe(factsOf(t0, cache));
		expect(idx.version).toBe(after.version);
		expect(idx.tasks.get('prep')?.decl.header.from).toBe(
			(buildIndex(before, undefined, { cache }).tasks.get('prep')?.decl.header.from ?? 0) + 4,
		);
	});

	it('indexes a header-only plan as a project with no properties', () => {
		const ws = golden('bridge-header-only');
		const idx = buildIndex(ws.snapshot(), undefined, { cache: null });
		expect(idx.tasks.size).toBe(0);
		expect(idx.project?.id).not.toBeUndefined();
	});
});
