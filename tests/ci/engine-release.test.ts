// SPDX-License-Identifier: GPL-2.0-or-later
// pages.yml refuses to deploy an engine built on a test interpreter (phase-4 T13).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { engineReleaseProblems } from '../../scripts/ci/engine-release.mjs';

const NOTICES = 'Mainspring engine: licenses and notices\n';
const manifest = (version: unknown) => ({ rubyWasm: { package: '@ruby/3.4-wasm-wasi', version } });

describe('engineReleaseProblems', () => {
	it('accepts the package interpreter', () => {
		expect(engineReleaseProblems(manifest('2.10.1'), NOTICES)).toEqual([]);
	});

	it('refuses a custom interpreter by its version suffix or its notices', () => {
		expect(engineReleaseProblems(manifest('2.10.1+no-openssl'), NOTICES)).toEqual([
			'rubyWasm.version is 2.10.1+no-openssl: an engine built on a test interpreter (build-bundle.mjs --ruby-wasm) is not for release',
		]);
		const custom = `NOTE: the interpreter in this build is not the package's binary. Not for release.\n\n${NOTICES}`;
		expect(engineReleaseProblems(manifest('2.10.1'), custom)).toEqual([
			'NOTICES.txt says the interpreter is not for release',
		]);
	});

	it('refuses a manifest without a version, or an engine without its notices', () => {
		expect(engineReleaseProblems({}, NOTICES)).toEqual(['manifest.json has no rubyWasm.version']);
		expect(engineReleaseProblems(manifest(''), NOTICES)).toEqual([
			'manifest.json has no rubyWasm.version',
		]);
		expect(engineReleaseProblems(manifest('2.10.1'), null)).toEqual([
			'NOTICES.txt is missing next to manifest.json',
		]);
	});
});

describe('the command', () => {
	const dir = mkdtempSync(join(tmpdir(), 'engine-release-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));
	const site = (name: string, version: string) => {
		const engine = join(dir, name, 'engine');
		mkdirSync(engine, { recursive: true });
		writeFileSync(join(engine, 'manifest.json'), JSON.stringify(manifest(version)));
		writeFileSync(join(engine, 'NOTICES.txt'), NOTICES);
		return join(engine, 'manifest.json');
	};
	const run = (file: string) =>
		spawnSync(process.execPath, ['scripts/ci/engine-release.mjs', file], { encoding: 'utf8' });

	it('exits 0 for a release engine and 1 for a test one', () => {
		expect(run(site('release', '2.10.1')).status).toBe(0);
		const r = run(site('test', '2.10.1+no-openssl'));
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('must not be deployed');
	});
});
