// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	checkSpecs,
	EXEMPT_FILES,
	findWebKitSkips,
	PENDING_BATCHES,
} from '../../scripts/ci/webkit-skips.mjs';
import {
	findAllowEntry,
	MAX_WEBKIT_ALLOWLIST,
	TITLE_SEPARATOR,
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

describe('findWebKitSkips: the forms that keep the iPhone out without naming it', () => {
	it('flags a skip for another phone only, and a Chromium-only skip', () => {
		const src = [
			"test.skip(info.project.name !== 'pixel-7');",
			"test.skip(!isTouch(info) || info.project.name !== 'pixel-7', 'coarse');",
			"test.skip(browserName !== 'chromium', 'forced colours');",
			"test.skip(info.project.name !== 'pixel-7' || browserName !== 'chromium');",
		].join('\n');
		const hits = findWebKitSkips(src);
		expect(hits.map((h) => h.line)).toEqual([1, 2, 3, 4]);
		expect(new Set(hits.map((h) => h.kind))).toEqual(new Set(['other-project']));
	});

	it('marks a skip that names the iPhone as webkit, whatever else it says', () => {
		const [hit] = findWebKitSkips("test.skip(info.project.name !== 'pixel-7' || isIphone(info));");
		expect(hit?.kind).toBe('webkit');
	});

	it('leaves desktop-only skips, the full-speed copies and SCREENSHOTS-gated files alone', () => {
		const src = [
			"test.skip(info.project.name !== 'desktop', 'a mouse');",
			"test.skip(info.project.name === 'desktop', 'a phone');",
			"test.skip(full && browserName !== 'chromium', 'the full-speed copy');",
			"test.skip(isTouch(info), 'keys');",
		].join('\n');
		expect(findWebKitSkips(src)).toEqual([]);
		const gated = [
			"test.skip(!process.env['SCREENSHOTS'], 'set SCREENSHOTS=1');",
			"test.skip(info.project.name !== 'pixel-7');",
		].join('\n');
		expect(findWebKitSkips(gated)).toEqual([]);
		// ...but a skip before the gate is still counted, and a webkit one is never exempt.
		const before = "test.skip(info.project.name !== 'pixel-7');\n" + gated;
		expect(findWebKitSkips(before).map((h) => h.line)).toEqual([1]);
		expect(findWebKitSkips(gated + "\ntest.skip(info.project.name === 'iphone-14');")).toHaveLength(
			1,
		);
	});

	it('does not count the other-project forms in a file outside the three projects', () => {
		expect(findWebKitSkips("test.skip(browserName !== 'chromium');", { exempt: true })).toEqual([]);
		expect(EXEMPT_FILES).toContain('engine-responsiveness.spec.ts');
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

	it('matches a pending file in a sub-folder by its path under tests/e2e', () => {
		const sub = specs({ 'p/b.spec.ts': "test.skip(browserName !== 'chromium');\n" });
		expect(checkSpecs(sub, { pending: { B5: ['p/b.spec.ts'] } }).pending).toHaveLength(1);
		expect(checkSpecs(sub, { pending: { B5: ['b.spec.ts'] } }).failures).toHaveLength(1);
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

	it('has no pending batch left: every spec is held to the allowlist', () => {
		expect(PENDING_BATCHES).toEqual({});
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
			for (const part of e.title.split(TITLE_SEPARATOR))
				expect(titleInSource(src, part), `${e.file}: ${part}`).toBe(true);
		}
	});

	it('finds an entry by file and the full title path', () => {
		const list: WebKitAllowEntry[] = [
			{
				file: 'a.spec.ts',
				title: `the drag${TITLE_SEPARATOR}moves a bar`,
				reason: 'cdp-touch',
				detail: 'Input.dispatchTouchEvent',
			},
		];
		expect(findAllowEntry('a.spec.ts', ['the drag', 'moves a bar'], list)?.reason).toBe(
			'cdp-touch',
		);
		// A test with the same title under another describe is another test.
		expect(findAllowEntry('a.spec.ts', ['the pan', 'moves a bar'], list)).toBeUndefined();
		expect(findAllowEntry('a.spec.ts', ['moves a bar'], list)).toBeUndefined();
		expect(findAllowEntry('b.spec.ts', ['the drag', 'moves a bar'], list)).toBeUndefined();
	});

	it('finds a title in a spec, also one built from a template literal', () => {
		const src = [
			"test.describe('the drag', () => {",
			'	for (const scheme of schemes) {',
			'		test(`inspector, project sheet and source sheet, ${scheme}`, async () => {});',
			'	}',
			'});',
		].join('\n');
		expect(titleInSource(src, 'the drag')).toBe(true);
		expect(titleInSource(src, 'inspector, project sheet and source sheet, light')).toBe(true);
		expect(titleInSource(src, 'inspector, project sheet')).toBe(false);
		expect(titleInSource(src, 'no such test')).toBe(false);
	});
});

/** Whether a title (a describe or a test) is written in `src`; a `${...}` in a template matches any text. */
function titleInSource(src: string, title: string): boolean {
	for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
		const text = m[2] ?? '';
		if (text === title) return true;
		if (m[1] === '`' && text.includes('${')) {
			const pattern = text
				.split(/\$\{[^}]*\}/)
				.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
				.join('.+');
			if (new RegExp(`^${pattern}$`).test(title)) return true;
		}
	}
	return false;
}
