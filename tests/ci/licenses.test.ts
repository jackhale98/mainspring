// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	BUILD_ONLY,
	checkLock,
	classifyLicense,
	parseSpdx,
	resolveDep,
} from '../../scripts/ci/licenses.mjs';

describe('classifyLicense', () => {
	it.each([
		'MIT',
		'ISC',
		'BSD-2-Clause',
		'BSD-3-Clause',
		'0BSD',
		'Zlib',
		'Unlicense',
		'CC0-1.0',
		'BlueOak-1.0.0',
		'Python-2.0',
		'GPL-2.0-only',
		'GPL-2.0-or-later',
		'GPL-2.0+',
		'LGPL-2.1-or-later',
	])('accepts %s', (id) => {
		expect(classifyLicense(id).ok).toBe(true);
	});

	it.each([
		'Apache-2.0',
		'GPL-3.0-only',
		'GPL-3.0-or-later',
		'AGPL-3.0-only',
		'LGPL-3.0-only',
		'LGPL-3.0-or-later',
		'MPL-2.0',
		'CC-BY-4.0',
		'BSD-4-Clause',
	])('rejects %s', (id) => {
		expect(classifyLicense(id)).toMatchObject({ ok: false, reason: 'not GPL-2.0 compatible' });
	});

	it('accepts a dual license when one option is compatible', () => {
		expect(classifyLicense('MIT OR Apache-2.0').ok).toBe(true);
		expect(classifyLicense('(Apache-2.0 OR MIT)').ok).toBe(true);
		expect(classifyLicense('LGPL-3.0-only OR GPL-2.0-or-later').ok).toBe(true);
		expect(classifyLicense('Apache-2.0 OR GPL-3.0-only').ok).toBe(false);
	});

	it('requires every part of a conjunction to be compatible', () => {
		expect(classifyLicense('MIT AND ISC').ok).toBe(true);
		expect(classifyLicense('MIT AND Apache-2.0').ok).toBe(false);
		expect(classifyLicense('Apache-2.0 AND LGPL-3.0-or-later AND MIT').ok).toBe(false);
	});

	it('binds AND tighter than OR', () => {
		expect(parseSpdx('MIT OR Apache-2.0 AND GPL-3.0-only')).toEqual({
			op: 'or',
			args: [
				{ id: 'MIT' },
				{
					op: 'and',
					args: [{ id: 'Apache-2.0' }, { id: 'GPL-3.0-only' }],
				},
			],
		});
		expect(classifyLicense('MIT OR Apache-2.0 AND GPL-3.0-only').ok).toBe(true);
		expect(classifyLicense('(MIT OR Apache-2.0) AND GPL-3.0-only').ok).toBe(false);
	});

	it('handles WITH exceptions', () => {
		expect(classifyLicense('Apache-2.0 WITH LLVM-exception').ok).toBe(true);
		expect(classifyLicense('GPL-2.0-only WITH Classpath-exception-2.0').ok).toBe(true);
		expect(classifyLicense('GPL-3.0-only WITH GCC-exception-3.1').ok).toBe(false);
		expect(classifyLicense('Apache-2.0 WITH Some-other-exception').ok).toBe(false);
	});

	it('reads legacy license objects and arrays', () => {
		expect(classifyLicense({ type: 'MIT' }).ok).toBe(true);
		expect(classifyLicense([{ type: 'MIT' }, { type: 'Apache-2.0' }]).ok).toBe(true);
		expect(classifyLicense([{ type: 'Apache-2.0' }]).ok).toBe(false);
	});

	it('fails missing, proprietary and malformed licenses', () => {
		expect(classifyLicense(undefined)).toMatchObject({ ok: false, reason: 'no license declared' });
		expect(classifyLicense('')).toMatchObject({ ok: false, reason: 'no license declared' });
		expect(classifyLicense('UNLICENSED').ok).toBe(false);
		expect(classifyLicense('SEE LICENSE IN LICENSE.md').ok).toBe(false);
		expect(classifyLicense('(MIT').reason).toMatch(/not a valid SPDX expression/);
		expect(classifyLicense('MIT OR').reason).toMatch(/not a valid SPDX expression/);
		expect(classifyLicense('MIT Apache-2.0').reason).toMatch(/not a valid SPDX expression/);
	});
});

type Entry = {
	version?: string;
	license?: string;
	dev?: boolean;
	optional?: boolean;
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

function lock(rootDeps: string[], packages: Record<string, Entry>) {
	return {
		lockfileVersion: 3,
		packages: {
			'': { dependencies: Object.fromEntries(rootDeps.map((d) => [d, '*'])) },
			...packages,
		},
	};
}

const none = { buildOnly: new Map<string, string>(), embedded: [] };

describe('resolveDep', () => {
	const packages = {
		'': {},
		'node_modules/a': {},
		'node_modules/b': {},
		'node_modules/a/node_modules/b': {},
		'node_modules/@s/c': {},
	};
	it('finds the nearest node_modules copy, as Node does', () => {
		expect(resolveDep(packages, 'node_modules/a', 'b')).toBe('node_modules/a/node_modules/b');
		expect(resolveDep(packages, 'node_modules/a/node_modules/b', 'a')).toBe('node_modules/a');
		expect(resolveDep(packages, '', 'b')).toBe('node_modules/b');
		expect(resolveDep(packages, 'node_modules/a', '@s/c')).toBe('node_modules/@s/c');
		expect(resolveDep(packages, '', 'missing')).toBeNull();
	});
});

describe('checkLock', () => {
	it('passes a compatible production tree', () => {
		const report = checkLock(
			lock(['app'], {
				'node_modules/app': { license: 'MIT', dependencies: { util: '*' } },
				'node_modules/util': { license: 'ISC' },
			}),
			none,
		);
		expect(report.failures).toEqual([]);
		expect(report.checked.map((c: { name: string }) => c.name).sort()).toEqual(['app', 'util']);
	});

	it('fails a transitive Apache-2.0-only runtime dependency', () => {
		const report = checkLock(
			lock(['app'], {
				'node_modules/app': { license: 'MIT', dependencies: { dexie: '*' } },
				'node_modules/dexie': { version: '4.0.0', license: 'Apache-2.0' },
			}),
			none,
		);
		expect(report.failures).toEqual([
			expect.objectContaining({ path: 'node_modules/dexie', license: 'Apache-2.0' }),
		]);
	});

	it('checks the nested copy that a package actually resolves', () => {
		const report = checkLock(
			lock(['app'], {
				'node_modules/app': { license: 'MIT', dependencies: { x: '*' } },
				'node_modules/app/node_modules/x': { license: 'GPL-3.0-only' },
				'node_modules/x': { license: 'MIT' },
			}),
			none,
		);
		expect(report.failures.map((f: { path: string }) => f.path)).toEqual([
			'node_modules/app/node_modules/x',
		]);
	});

	it('ignores dev dependencies that no production package reaches', () => {
		const report = checkLock(
			lock(['app'], {
				'node_modules/app': { license: 'MIT' },
				'node_modules/typescript': { license: 'Apache-2.0', dev: true },
			}),
			none,
		);
		expect(report.failures).toEqual([]);
	});

	it('follows optional and peer dependencies, and skips ones that are not installed', () => {
		const report = checkLock(
			lock(['app'], {
				'node_modules/app': {
					license: 'MIT',
					optionalDependencies: { native: '*', absent: '*' },
					peerDependencies: { peer: '*' },
				},
				'node_modules/native': { license: 'LGPL-3.0-or-later', optional: true },
				'node_modules/peer': { license: 'AGPL-3.0-only' },
			}),
			none,
		);
		expect(report.failures.map((f: { path: string }) => f.path).sort()).toEqual([
			'node_modules/native',
			'node_modules/peer',
		]);
	});

	it('does not enter build-only packages, but still checks what shipped code reaches', () => {
		const report = checkLock(
			lock(['astro', 'svelte'], {
				'node_modules/astro': { license: 'MIT', dependencies: { sharp: '*' } },
				'node_modules/sharp': { license: 'Apache-2.0', dependencies: { 'detect-libc': '*' } },
				'node_modules/detect-libc': { license: 'Apache-2.0' },
				'node_modules/svelte': { license: 'MIT', dependencies: { 'aria-query': '*' } },
				'node_modules/aria-query': { license: 'Apache-2.0' },
				'node_modules/other': { license: 'MIT', dependencies: { 'detect-libc': '*' } },
			}),
			{ buildOnly: new Map([['sharp', 'build-time image service']]), embedded: [] },
		);
		expect(report.buildOnlyRoots).toEqual(['sharp']);
		expect(report.buildOnlyPackages.sort()).toEqual([
			'node_modules/detect-libc',
			'node_modules/other',
			'node_modules/sharp',
		]);
		// aria-query is not listed, so the shipped svelte package still makes it fail.
		expect(report.failures.map((f: { path: string }) => f.path)).toEqual([
			'node_modules/aria-query',
		]);
	});

	it('fails a build-only package that is declared as a direct dependency', () => {
		const report = checkLock(
			lock(['typescript'], { 'node_modules/typescript': { license: 'Apache-2.0' } }),
			{ buildOnly: new Map([['typescript', 'compiler']]), embedded: [] },
		);
		expect(report.failures).toEqual([
			expect.objectContaining({ path: 'node_modules/typescript', reason: expect.any(String) }),
		]);
	});

	it('warns about stale build-only entries', () => {
		const report = checkLock(lock([], {}), {
			buildOnly: new Map([['gone', 'no longer used']]),
			embedded: [],
		});
		expect(report.failures).toEqual([]);
		expect(report.warnings).toEqual([expect.stringContaining('"gone"')]);
	});

	it('falls back to the installed package.json for a lock entry without a license', () => {
		const tree = lock(['a'], { 'node_modules/a': {} });
		expect(checkLock(tree, { ...none, readLicense: () => 'MIT' }).failures).toEqual([]);
		expect(checkLock(tree, none).failures).toEqual([
			expect.objectContaining({ path: 'node_modules/a', reason: 'no license declared' }),
		]);
	});

	it('reports embedded exceptions without failing, and warns when the version moves', () => {
		const embedded = [
			{
				package: '@example/engine-wasm',
				version: '2.10.1',
				component: 'OpenSSL',
				license: 'Apache-2.0',
				reason: 'ADR-0001 open issue',
			},
		];
		const at = (version: string) =>
			checkLock(
				lock(['@example/engine-wasm'], {
					'node_modules/@example/engine-wasm': { version, license: 'MIT' },
				}),
				{ buildOnly: new Map(), embedded },
			);
		const same = at('2.10.1');
		expect(same.failures).toEqual([]);
		expect(same.warnings).toEqual([]);
		expect(same.exceptions).toEqual([expect.objectContaining({ installed: '2.10.1' })]);
		expect(at('2.11.0').warnings).toEqual([expect.stringContaining('recheck')]);
	});
});

describe('BUILD_ONLY', () => {
	it('gives a reason for every entry', () => {
		for (const [name, reason] of BUILD_ONLY) {
			expect(reason.length, name).toBeGreaterThan(40);
		}
	});
});
