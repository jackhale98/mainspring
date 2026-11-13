// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { DependencyResult, TaskResult } from '../../engine/protocol';
import { result, task } from '../workspace/testing/fake-engine-client';
import { mergeEngineLinks } from './links';
import type { RawLink } from './model';

const dep = (id: string): DependencyResult => ({
	task: id,
	onEnd: true,
	gapDurationMin: 0,
	gapLengthMin: 0,
});

function withDeps(id: string, depends: string[], precedes: string[] = []): TaskResult {
	const t = task(id, 1, 100);
	const s = t.scenarios['plan'];
	if (s) {
		s.depends = depends.map(dep);
		s.precedes = precedes.map(dep);
	}
	return t;
}

const declared: RawLink = { pred: 'a', succ: 'b', site: {} as never };

describe('mergeEngineLinks', () => {
	it('adds links only the engine knows, without a site', () => {
		const r = result(1, { tasks: [withDeps('a', []), withDeps('b', ['a']), withDeps('c', ['b'])] });
		const merged = mergeEngineLinks([declared], r, 'plan');
		expect(merged.map((l) => [l.pred, l.succ, l.site === null])).toEqual([
			['a', 'b', false],
			['b', 'c', true],
		]);
	});

	it('reads precedes as a link from the task to the other', () => {
		const r = result(1, { tasks: [withDeps('x', [], ['y'])] });
		expect(mergeEngineLinks([], r, 'plan').map((l) => [l.pred, l.succ])).toEqual([['x', 'y']]);
	});

	it('skips a link the text declares, and one repeated by both ends', () => {
		const r = result(1, { tasks: [withDeps('a', [], ['b']), withDeps('b', ['a'])] });
		expect(mergeEngineLinks([declared], r, 'plan')).toHaveLength(1);
		const both = result(1, { tasks: [withDeps('p', [], ['q']), withDeps('q', ['p'])] });
		expect(mergeEngineLinks([], both, 'plan')).toHaveLength(1);
	});

	it('skips what a child only inherits from its parent', () => {
		const r = result(1, {
			tasks: [withDeps('app', ['lib']), withDeps('app.ui', ['lib']), withDeps('app.ui.x', ['lib'])],
		});
		const parent: RawLink = { pred: 'lib', succ: 'app', site: {} as never };
		expect(mergeEngineLinks([parent], r, 'plan')).toEqual([parent]);
		// Without it in the text, the engine's link to the parent stands for the children too.
		expect(mergeEngineLinks([], r, 'plan').map((l) => l.succ)).toEqual(['app']);
	});

	it('adds nothing for an engine that does not emit the fields, or without a result', () => {
		const old = result(1, { tasks: [task('a', 1, 10)] });
		const s = old.tasks[0]?.scenarios['plan'] as Record<string, unknown> | undefined;
		if (s) {
			delete s['depends'];
			delete s['precedes'];
		}
		expect(mergeEngineLinks([declared], old, 'plan')).toEqual([declared]);
		expect(mergeEngineLinks([declared], null, 'plan')).toEqual([declared]);
		expect(mergeEngineLinks([declared], old, null)).toEqual([declared]);
	});
});
