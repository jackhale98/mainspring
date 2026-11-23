// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	GOLDEN_RECORDING,
	NATIVE_TJ,
	check,
	extractRunSteps,
	findForbidden,
	npmScriptsInvoked,
} from '../../scripts/ci/no-ruby.mjs';

describe('no-ruby matcher', () => {
	it.each(['ruby', 'tj3', 'bundle', 'gem'])('flags %s as a whole word', (word) => {
		expect(findForbidden(`${word} --version`)).toBe(word);
		expect(findForbidden(`sudo ${word} install x`)).toBe(word);
		expect(findForbidden(`cd x && ${word}`)).toBe(word);
	});

	it('does not flag substrings', () => {
		expect(findForbidden('npm run bundler-report')).toBeNull();
		expect(findForbidden('echo rubyist gemini tj30 bundled')).toBeNull();
		expect(findForbidden('node scripts/ci/no-ruby.mjs')).toBeNull();
		expect(findForbidden('fetch("/engine/ruby.wasm")')).toBeNull();
		expect(findForbidden('/usr/bin/ruby -v')).toBe('ruby');
	});

	it('ignores comments', () => {
		expect(findForbidden('# ruby is not used here')).toBeNull();
		expect(findForbidden('npm test # no gem needed')).toBeNull();
		expect(findForbidden('// tj3 is native only')).toBeNull();
		expect(findForbidden('fetch("https://example.test/x")')).toBeNull();
	});

	it('extracts inline and block run steps only', () => {
		const yaml = [
			'jobs:',
			'  a:',
			'    steps:',
			'      - name: ruby setup',
			'        uses: example/setup-ruby@v1',
			'      - run: npm ci',
			'      - run: |',
			'          npm run build',
			'          bundle exec rake',
			'      - name: next',
			'        run: echo hi',
		].join('\n');
		const steps: string[] = extractRunSteps(yaml);
		expect(steps).toHaveLength(3);
		expect(steps[0]).toBe('npm ci');
		expect(findForbidden(steps[1])).toBe('bundle');
		expect(findForbidden(steps[2])).toBeNull();
	});

	it('finds npm scripts a step invokes', () => {
		const names: string[] = npmScriptsInvoked(
			'npm test\nnpm run build:engine -- --check\nnpm run test:e2e # x\nnpm ci',
		);
		expect(names.sort()).toEqual(['build:engine', 'test', 'test:e2e']);
	});
});

describe('names that only look like Ruby tooling', () => {
	it.each([
		'node engine/ruby-wasm/check-binary.mjs out/ruby.debug+stdlib.wasm out/ruby+stdlib.wasm',
		'node x.mjs --compare node_modules/@ruby/3.4-wasm-wasi/dist/ruby.debug+stdlib.wasm',
		'ls node_modules/@ruby/wasm-wasi node_modules/@ruby/3.4-wasm-wasi/dist/ruby.debug.wasm',
		'MAINSPRING_RUBY_WASM=engine/ruby-wasm/out/ruby+stdlib.wasm npm run test:golden',
	])('passes %s', (line) => {
		expect(findForbidden(line)).toBeNull();
	});

	it.each([
		['ruby out/ruby+stdlib.wasm', 'ruby'],
		['gem install @ruby/3.4-wasm-wasi', 'gem'],
		['bundle exec x node_modules/@ruby/wasm-wasi', 'bundle'],
		['cp ruby+stdlib x', 'ruby'],
		['npm i @ruby/evil', 'ruby'],
		['@ruby/3.4-wasm-wasi-extra', 'ruby'],
		['tj3 out/ruby.debug+stdlib.wasm', 'tj3'],
	])('still flags %s', (line, word) => {
		expect(findForbidden(line)).toBe(word);
	});
});

describe('native TaskJuggler and golden recording', () => {
	it.each([
		['tj3 plan.tjp', 'tj3'],
		['tj3man', 'tj3man'],
		['gem install taskjuggler', 'taskjuggler'],
		['npm run golden:record', 'golden:record'],
		['node engine/golden/record-native.mjs --verify', 'record-native'],
		['cd engine/tj && rake', 'engine/tj'],
		['x -I./engine/tj/lib', 'engine/tj'],
		['# a comment naming tj3', 'tj3'],
	])('NATIVE_TJ, comments included, flags %s', (line, word) => {
		expect(findForbidden(line, NATIVE_TJ, true)).toBe(word);
	});

	it.each([
		'node engine/build-bundle.mjs',
		'engine/ruby-wasm/build.sh --toolchain wasi-sdk',
		'npm run test:golden',
		'# Builds the TaskJuggler bundle in Node',
		'tj30 engine/tjx golden:recorded',
	])('NATIVE_TJ passes %s', (line) => {
		expect(findForbidden(line, NATIVE_TJ, true)).toBeNull();
	});

	it('GOLDEN_RECORDING flags only golden recording', () => {
		expect(findForbidden('npm run golden:record', GOLDEN_RECORDING)).toBe('golden:record');
		expect(findForbidden('npm run golden:wasm', GOLDEN_RECORDING)).toBeNull();
	});
});

describe('check(): the Ruby build workflow allowlist', () => {
	let root = '';
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	function repo(workflows: Record<string, string>, scripts: Record<string, string> = {}): string {
		root = mkdtempSync(join(tmpdir(), 'no-ruby-'));
		mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
		writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts }));
		for (const [name, text] of Object.entries(workflows)) {
			writeFileSync(join(root, '.github', 'workflows', name), text);
		}
		return root;
	}
	const workflow = (...run: string[]) =>
		[
			'name: x',
			'jobs:',
			'  a:',
			'    steps:',
			'      - uses: ruby/setup-ruby@v1',
			...run.map((r) => `      - run: ${r}`),
		].join('\n');
	const rubyStep = 'bundle exec ruby build.rb && gem list';

	it('allows the Ruby words in ruby-wasm.yml only', () => {
		expect(check(repo({ 'ruby-wasm.yml': workflow(rubyStep) }))).toEqual([]);
		rmSync(root, { recursive: true, force: true });
		expect(check(repo({ 'other.yml': workflow(rubyStep) }))).toEqual([
			'.github/workflows/other.yml: run step invokes "bundle"',
		]);
		rmSync(root, { recursive: true, force: true });
		expect(check(repo({ 'ruby-wasm.yaml': workflow(rubyStep) }))).toEqual([
			'.github/workflows/ruby-wasm.yaml: run step invokes "bundle"',
		]);
	});

	it.each([
		['tj3 plan.tjp', 'tj3'],
		['npm run golden:record', 'golden:record'],
		['node engine/golden/record-native.mjs', 'record-native'],
		['ruby -Iengine/tj/lib x.rb', 'engine/tj'],
		['gem install taskjuggler', 'taskjuggler'],
	])('still bans %s in ruby-wasm.yml', (step, word) => {
		expect(check(repo({ 'ruby-wasm.yml': workflow(rubyStep, step) }))).toContain(
			`.github/workflows/ruby-wasm.yml: names "${word}" (no native TaskJuggler here)`,
		);
	});

	it('bans them outside run steps and in comments of ruby-wasm.yml too', () => {
		const env = `${workflow('npm ci')}\n        env:\n          X: engine/tj/lib`;
		expect(check(repo({ 'ruby-wasm.yml': env }))).toEqual([
			'.github/workflows/ruby-wasm.yml: names "engine/tj" (no native TaskJuggler here)',
		]);
		rmSync(root, { recursive: true, force: true });
		const comment = `${workflow('npm ci')}\n# then tj3`;
		expect(check(repo({ 'ruby-wasm.yml': comment }))).toEqual([
			'.github/workflows/ruby-wasm.yml: names "tj3" (no native TaskJuggler here)',
		]);
	});

	it('checks the npm scripts ruby-wasm.yml invokes, for Ruby words and native TaskJuggler', () => {
		const scripts = {
			'test:golden': 'node scripts/test-golden.mjs',
			verify: 'node engine/golden/record-native.mjs --verify',
			setup: 'bundle install',
		};
		const run = (step: string) => {
			if (root) rmSync(root, { recursive: true, force: true });
			return check(repo({ 'ruby-wasm.yml': workflow(step) }, scripts));
		};
		expect(run('npm run test:golden')).toEqual([]);
		expect(run('npm run verify')).toEqual([
			'package.json: npm script "verify" invokes "record-native"',
			'package.json: npm script "verify" (run by ruby-wasm.yml) names "record-native"',
		]);
		expect(run('npm run setup')).toEqual(['package.json: npm script "setup" invokes "bundle"']);
	});

	it('bans golden recording from every workflow', () => {
		expect(check(repo({ 'ci.yml': workflow('npm run golden:record') }))).toEqual([
			'.github/workflows/ci.yml: run step invokes "golden:record"',
		]);
		rmSync(root, { recursive: true, force: true });
		expect(
			check(repo({ 'ci.yml': workflow('npm run rec') }, { rec: 'node x/record-native.mjs' })),
		).toEqual(['package.json: npm script "rec" invokes "record-native"']);
	});
});
