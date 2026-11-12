// SPDX-License-Identifier: GPL-2.0-or-later
// Fails if a site built under a base path (MAINSPRING_BASE, ADR-0006) still names one of its own
// files by a root-absolute URL that misses the base: "/engine/…", "/_astro/…" or "/app" in a
// script, href="/…" or src="/…" in a page, url(/…) in a style sheet. On GitHub Pages such a URL
// leaves /mainspring/ and fails. Run by scripts/test-base-path.mjs and the Pages workflow:
//
//   node scripts/ci/base-path-scan.mjs <dist dir> <base>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Text files a browser reads URLs from. The engine's .gz assets and the notices are not. */
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg']);

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Root-absolute references in `text` that do not start with `base`. `entries` are the names at
 * the top of the built site ("_astro", "app", "engine", "index.html"…): in any file, a quoted or
 * url() reference to one of them is checked. In HTML, every attribute value that starts with a
 * single "/" is checked (outside inline script and style bodies), and in HTML and CSS every
 * url(/…).
 * @param {string} text
 * @param {string} base normalised, e.g. "/mainspring/"
 * @param {readonly string[]} entries
 * @param {{ html?: boolean, css?: boolean }} [kind]
 * @returns {string[]}
 */
export function rootAbsoluteRefs(text, base, entries, kind = {}) {
	/** @type {string[]} */
	const refs = [];
	const add = (/** @type {string} */ ref) => {
		if (!ref.startsWith(base) && !refs.includes(ref)) refs.push(ref);
	};
	if (entries.length > 0) {
		const names = entries.map(escapeRegExp).join('|');
		const site = new RegExp(
			`[\`"'(=]\\s*(/(?:${names})(?:[/?#][^\`"'()\\s]*)?)(?=[\`"')\\s>]|$)`,
			'g',
		);
		for (const m of text.matchAll(site)) add(m[1] ?? '');
	}
	if (kind.html) {
		// Attributes only: inline script and style bodies are code, covered by the other rules.
		const markup = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '<$1>');
		const attr = /\s[\w:-]+\s*=\s*(["']?)(\/(?!\/)[^"'\s>]*)\1/g;
		for (const m of markup.matchAll(attr)) add(m[2] ?? '');
	}
	if (kind.css || kind.html) {
		const url = /url\(\s*(["']?)(\/(?!\/)[^"')\s]*)\1\s*\)/g;
		for (const m of text.matchAll(url)) add(m[2] ?? '');
	}
	return refs;
}

/** @param {string} dir @param {string[]} [out] @returns {string[]} */
function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else out.push(path);
	}
	return out;
}

/**
 * Every root-absolute reference outside `base` in the built site at `dir`, as "file: ref".
 * @param {string} dir
 * @param {string} base normalised, e.g. "/mainspring/"
 * @returns {string[]}
 */
export function scanBuild(dir, base) {
	if (base === '/') return [];
	const entries = readdirSync(dir);
	/** @type {string[]} */
	const problems = [];
	for (const file of walk(dir)) {
		const ext = extname(file);
		if (!TEXT_EXT.has(ext)) continue;
		const refs = rootAbsoluteRefs(readFileSync(file, 'utf8'), base, entries, {
			html: ext === '.html',
			css: ext === '.css',
		});
		const rel = relative(dir, file).split('\\').join('/');
		for (const ref of refs) problems.push(`${rel}: ${ref}`);
	}
	return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [dir, base] = process.argv.slice(2);
	if (!dir || !base || !base.startsWith('/') || !base.endsWith('/')) {
		console.error('usage: node scripts/ci/base-path-scan.mjs <dist dir> </base/>');
		process.exit(2);
	}
	if (base === '/') {
		console.log('base-path-scan: base is "/", nothing to check');
		process.exit(0);
	}
	const problems = scanBuild(dir, base);
	if (problems.length > 0) {
		console.error(
			`base-path-scan: root-absolute URLs outside ${base}:\n` +
				problems.map((p) => '  ' + p).join('\n'),
		);
		process.exit(1);
	}
	console.log(`base-path-scan: ok, every site URL in ${dir} is under ${base}`);
}
