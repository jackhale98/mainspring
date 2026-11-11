// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { extractRunSteps, findForbidden, npmScriptsInvoked } from '../../scripts/ci/no-ruby.mjs';

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
