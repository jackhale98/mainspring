// SPDX-License-Identifier: GPL-2.0-or-later
// engine/build-bundle.mjs labels a custom interpreter only together with --ruby-wasm, and only with
// a "+<build>" suffix, so the manifest of a test engine is always recognisable (phase-4 T13; pages.yml
// refuses one). Both checks run before anything is read or written.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function run(args: string[], env: Record<string, string> = {}) {
	const clean = { ...process.env };
	delete clean['MAINSPRING_RUBY_WASM'];
	delete clean['MAINSPRING_RUBY_WASM_VERSION'];
	return spawnSync(
		process.execPath,
		['engine/build-bundle.mjs', '--out', 'test-results/never-written', ...args],
		{
			encoding: 'utf8',
			env: { ...clean, ...env },
		},
	);
}

describe('build-bundle.mjs: the custom interpreter label', () => {
	it('refuses --ruby-wasm-version without --ruby-wasm', () => {
		const r = run(['--ruby-wasm-version', '2.10.1+no-openssl']);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('--ruby-wasm-version 2.10.1+no-openssl without --ruby-wasm');
	});

	it('refuses MAINSPRING_RUBY_WASM_VERSION without a custom binary', () => {
		const r = run([], { MAINSPRING_RUBY_WASM_VERSION: '2.10.1+no-openssl' });
		expect(r.status).toBe(1);
		expect(r.stderr).toContain(
			'MAINSPRING_RUBY_WASM_VERSION 2.10.1+no-openssl without --ruby-wasm',
		);
	});

	it.each(['2.10.1', '2.10.1+', 'custom build'])(
		'refuses the label %j without a +<build> suffix',
		(label) => {
			const r = run(['--ruby-wasm', 'missing.wasm', '--ruby-wasm-version', label]);
			expect(r.status).toBe(1);
			expect(r.stderr).toContain('needs a "+<build>" suffix');
		},
	);
});
