// SPDX-License-Identifier: GPL-2.0-or-later
// The scan for root-absolute URLs in a site built under a base path (ADR-0006).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rootAbsoluteRefs, scanBuild } from '../../scripts/ci/base-path-scan.mjs';

const BASE = '/mainspring/';
const ENTRIES = ['_astro', 'app', 'engine', 'fonts', 'index.html'];

describe('rootAbsoluteRefs', () => {
	it('finds quoted references to the site’s own paths in scripts', () => {
		const js = 'new URL(`/engine/`,e);fetch("/app");x=\'/fonts/NOTICES.txt\';y="/_astro/a.js"';
		expect(rootAbsoluteRefs(js, BASE, ENTRIES)).toEqual([
			'/engine/',
			'/app',
			'/fonts/NOTICES.txt',
			'/_astro/a.js',
		]);
	});

	it('accepts references under the base', () => {
		const js = 'new URL(`/mainspring/engine/`,e);fetch("/mainspring/app?sample=x")';
		expect(rootAbsoluteRefs(js, BASE, ENTRIES)).toEqual([]);
	});

	it('ignores other paths, longer names and protocol-relative URLs', () => {
		const js = 'a="/";b="/application";c="//cdn.test/app";d="/*";e=x/app';
		expect(rootAbsoluteRefs(js, BASE, ENTRIES)).toEqual([]);
	});

	it('finds root-absolute attributes in pages, but not in inline script bodies', () => {
		const html =
			'<a href="/app">x</a><img src=/logo.png><link href="/mainspring/_astro/a.css">' +
			'<script>let i=/* @__PURE__ */ new Set()</script><a href="#main"></a><a href="data:,">';
		expect(rootAbsoluteRefs(html, BASE, ENTRIES, { html: true })).toEqual(['/app', '/logo.png']);
	});

	it('finds url(/…) in style sheets and inline styles', () => {
		const css = '@font-face{src:url(/_astro/inter.woff2)}a{background:url("/bg.png")}';
		expect(rootAbsoluteRefs(css, BASE, ENTRIES, { css: true })).toEqual([
			'/_astro/inter.woff2',
			'/bg.png',
		]);
		expect(rootAbsoluteRefs('<style>a{b:url(/x.png)}</style>', BASE, [], { html: true })).toEqual([
			'/x.png',
		]);
		expect(rootAbsoluteRefs('a{b:url(/mainspring/x.png)}', BASE, [], { css: true })).toEqual([]);
	});
});

describe('scanBuild', () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	function site(files: Record<string, string>): string {
		const dir = mkdtempSync(join(tmpdir(), 'base-path-scan-'));
		dirs.push(dir);
		for (const [name, text] of Object.entries(files)) {
			mkdirSync(join(dir, name, '..'), { recursive: true });
			writeFileSync(join(dir, name), text);
		}
		return dir;
	}

	it('lists each file and reference outside the base', () => {
		const root = site({
			'index.html': '<a href="/app">Open</a>',
			'app/index.html': '<script src="/mainspring/_astro/a.js"></script>',
			'_astro/w.js': 'new URL("/engine/",self.location.href)',
			'engine/NOTICES.txt': 'see /engine/ and /app',
		});
		expect(scanBuild(root, BASE)).toEqual(['_astro/w.js: /engine/', 'index.html: /app']);
	});

	it('passes a build whose URLs are all under the base, and skips the root base', () => {
		const root = site({ 'index.html': '<a href="/mainspring/app">Open</a>' });
		expect(scanBuild(root, BASE)).toEqual([]);
		expect(scanBuild(site({ 'index.html': '<a href="/app">x</a>' }), '/')).toEqual([]);
	});
});
