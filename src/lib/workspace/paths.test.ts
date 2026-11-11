// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	assertWorkspacePath,
	basename,
	dirname,
	hasIncludeSuffix,
	isProjectFile,
	isWorkspacePath,
	pathLookup,
	resolveIncludePath,
} from './paths';

describe('workspace paths', () => {
	it('accepts relative POSIX paths only', () => {
		for (const p of ['plan.tjp', 'lib/a.tji', 'a/b/c.tji', 'é/ü.tji'])
			expect(isWorkspacePath(p)).toBe(true);
		for (const p of [
			'',
			'/plan.tjp',
			'a//b.tji',
			'./a.tji',
			'a/../b.tji',
			'a\\b.tji',
			'a/',
			'..',
		]) {
			expect(isWorkspacePath(p)).toBe(false);
		}
		expect(() => assertWorkspacePath('../x.tji')).toThrow(/invalid workspace path/);
	});

	it('splits directory and name', () => {
		expect(dirname('plan.tjp')).toBe('');
		expect(dirname('a/b/c.tji')).toBe('a/b');
		expect(basename('a/b/c.tji')).toBe('c.tji');
		expect(hasIncludeSuffix('x.tji')).toBe(true);
		expect(hasIncludeSuffix('x.TJI')).toBe(false);
		expect(isProjectFile('x.tjp')).toBe(true);
	});
});

describe('resolveIncludePath (Scanner#include)', () => {
	const lookup = pathLookup([
		'plan.tjp',
		'parts/tasks.tji',
		'parts/shared.tji',
		'parts/deep/more.tji',
		'top.tji',
	]);

	it('resolves relative to the including file', () => {
		expect(resolveIncludePath('plan.tjp', 'parts/tasks.tji', lookup)).toEqual({
			ok: true,
			path: 'parts/tasks.tji',
		});
		expect(resolveIncludePath('parts/tasks.tji', 'deep/more.tji', lookup)).toEqual({
			ok: true,
			path: 'parts/deep/more.tji',
		});
		expect(resolveIncludePath('parts/deep/more.tji', '../shared.tji', lookup)).toEqual({
			ok: true,
			path: 'parts/shared.tji',
		});
		expect(resolveIncludePath('parts/deep/more.tji', '../../top.tji', lookup)).toEqual({
			ok: true,
			path: 'top.tji',
		});
		expect(resolveIncludePath('plan.tjp', './parts//tasks.tji', lookup)).toEqual({
			ok: true,
			path: 'parts/tasks.tji',
		});
	});

	it('requires the .tji suffix before anything else', () => {
		expect(resolveIncludePath('plan.tjp', '/abs/x.tjp', lookup)).toEqual({
			ok: false,
			problem: 'bad-suffix',
		});
		expect(resolveIncludePath('plan.tjp', 'parts/tasks.TJI', lookup)).toEqual({
			ok: false,
			problem: 'bad-suffix',
		});
	});

	it('does not resolve absolute paths or paths above the root', () => {
		expect(resolveIncludePath('plan.tjp', '/parts/tasks.tji', lookup)).toEqual({
			ok: false,
			problem: 'outside-workspace',
		});
		expect(resolveIncludePath('plan.tjp', '../plan.tji', lookup)).toEqual({
			ok: false,
			problem: 'outside-workspace',
		});
		expect(resolveIncludePath('parts/tasks.tji', '../../x.tji', lookup)).toEqual({
			ok: false,
			problem: 'outside-workspace',
		});
	});

	it('reports missing files, and ".." after a missing directory, as not found', () => {
		expect(resolveIncludePath('plan.tjp', 'nope.tji', lookup)).toEqual({
			ok: false,
			problem: 'not-found',
		});
		expect(resolveIncludePath('plan.tjp', 'nodir/../top.tji', lookup)).toEqual({
			ok: false,
			problem: 'not-found',
		});
		expect(resolveIncludePath('plan.tjp', 'parts/../top.tji', lookup)).toEqual({
			ok: true,
			path: 'top.tji',
		});
		expect(resolveIncludePath('plan.tjp', 'parts', lookup)).toEqual({
			ok: false,
			problem: 'bad-suffix',
		});
		expect(resolveIncludePath('plan.tjp', 'a\\b.tji', lookup)).toEqual({
			ok: false,
			problem: 'not-found',
		});
	});
});
