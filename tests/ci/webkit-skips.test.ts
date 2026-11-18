// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSpecs, findWebKitSkips, PENDING_BATCHES } from '../../scripts/ci/webkit-skips.mjs';
import {
	findAllowEntry,
	MAX_WEBKIT_ALLOWLIST,
	WEBKIT_ALLOWLIST,
	type WebKitAllowEntry,
} from '../e2e/lib/webkit-allowlist';
import { existsSync, readFileSync } from 'node:fs';

describe('findWebKitSkips', () => {
	it('flags a skip that names the iPhone project or WebKit', () => {
		const src = [
			'test.beforeEach(({}, info) => {',
			"\ttest.skip(info.project.name === 'iphone-14', 'desktop and Pixel 7');",
			'});',
			"test('a', ({ browserName }) => { test.skip(browserName === 'webkit', 'timing'); });",
			"test('b', (_, info) => { info.skip(isIphone(info)); });",
			"test.fixme(info.project.name === 'iphone-14');",
			"test.describe.skip(isIphone, 'later');",
		].join('\n');
		expect(findWebKitSkips(src).map((s) => s.line)).toEqual([2, 4, 5, 6, 7]);
	});

	it('follows a call over several lines and nested parentheses', () => {
		const src = [
			'test.skip(',
			"\tinfo.project.name === 'iphone-14' && !/^R[12359] /.test(info.title),",
			"\t'the drag rows (T21)',",
			');',
		].join('\n');
		const hits = findWebKitSkips(src);
		expect(hits).toHaveLength(1);
		expect(hits[0]?.line).toBe(1);
	});

	it('leaves other skips, comments and the allowlist helper alone', () => {
		const src = [
			"test.skip(isTouch(info), 'keys');",
			"test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1');",
			"test.skip(info.project.name !== 'desktop', 'a mouse');",
			'skipOnWebKitIfAllowlisted(info);',
			"// test.skip(info.project.name === 'iphone-14')",
			' * test.skip(isIphone)',
		].join('\n');
		expect(findWebKitSkips(src)).toEqual([]);
	});
});

describe('checkSpecs', () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	function specs(files: Record<string, string>): string {
		const dir = mkdtempSync(join(tmpdir(), 'webkit-skips-'));
		dirs.push(dir);
		for (const [name, src] of Object.entries(files)) {
			mkdirSync(join(dir, name, '..'), { recursive: true });
			writeFileSync(join(dir, name), src);
		}
		return dir;
	}

	const bad = "test.skip(info.project.name === 'iphone-14', 'x');\n";
	const dir = () => specs({ 'done.spec.ts': bad, 'later.spec.ts': bad, 'sub/clean.spec.ts': '' });
	const pending = { B2: ['later.spec.ts'] };

	it('reports a pending file and fails on one outside the pending list', () => {
		const r = checkSpecs(dir(), { pending });
		expect(r.pending.map((p) => [p.file, p.batch])).toEqual([['later.spec.ts', 'B2']]);
		expect(r.failures.map((f) => f.file)).toEqual(['done.spec.ts']);
	});

	it('strict mode fails on the pending files too, as the empty list will', () => {
		const r = checkSpecs(dir(), { pending, strict: true });
		expect(r.pending).toEqual([]);
		expect(r.failures.map((f) => f.file).sort()).toEqual(['done.spec.ts', 'later.spec.ts']);
	});

	it('passes when no spec has a WebKit skip, and scans sub-folders', () => {
		expect(checkSpecs(specs({ 'a.spec.ts': '', 'p/b.spec.ts': '' }), { pending })).toEqual({
			failures: [],
			pending: [],
		});
		const r = checkSpecs(specs({ 'p/b.spec.ts': bad }), { pending: {} });
		expect(r.failures.map((f) => f.file)).toEqual([join('p', 'b.spec.ts')]);
	});
});

describe('the repository', () => {
	const e2e = join(import.meta.dirname, '..', 'e2e');

	it('has no WebKit skip outside the allowlist in a finished batch', () => {
		expect(checkSpecs(e2e).failures).toEqual([]);
	});

	it('lists pending files that exist, each in one batch only', () => {
		const all = Object.values(PENDING_BATCHES).flat();
		expect(new Set(all).size).toBe(all.length);
		for (const f of all) expect(existsSync(join(e2e, f)), f).toBe(true);
	});
});

describe('the allowlist', () => {
	const e2e = join(import.meta.dirname, '..', 'e2e');

	it('is short, with an allowed reason and a detail on every entry', () => {
		expect(WEBKIT_ALLOWLIST.length).toBeLessThanOrEqual(MAX_WEBKIT_ALLOWLIST);
		const reasons = ['cdp-touch', 'chromium-performance-api', 'android-editcontext'];
		for (const e of WEBKIT_ALLOWLIST) {
			expect(reasons).toContain(e.reason);
			expect(e.detail.length).toBeGreaterThan(10);
		}
	});

	it('names a test that exists in a spec that calls the helper', () => {
		for (const e of WEBKIT_ALLOWLIST) {
			const file = join(e2e, e.file);
			expect(existsSync(file), e.file).toBe(true);
			const src = readFileSync(file, 'utf8');
			expect(src, e.file).toContain('skipOnWebKitIfAllowlisted');
			expect(src, `${e.file}: ${e.title}`).toContain(e.title);
		}
	});

	it('finds an entry by file and title', () => {
		const list: WebKitAllowEntry[] = [
			{ file: 'a.spec.ts', title: 'drag', reason: 'cdp-touch', detail: 'Input.dispatchTouchEvent' },
		];
		expect(findAllowEntry('a.spec.ts', 'drag', list)?.reason).toBe('cdp-touch');
		expect(findAllowEntry('a.spec.ts', 'other', list)).toBeUndefined();
		expect(findAllowEntry('b.spec.ts', 'drag', list)).toBeUndefined();
	});
});
