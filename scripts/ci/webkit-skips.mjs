// SPDX-License-Identifier: GPL-2.0-or-later
// Fails the `check` job when an end-to-end spec skips the iPhone 14 project (WebKit) on its own
// (ADR-0016 section 2). The one way to skip on WebKit is `skipOnWebKitIfAllowlisted(info)` with an
// entry in tests/e2e/lib/webkit-allowlist.ts, so any other `skip` or `fixme` call that names
// `iphone`, `isIphone` or `webkit` is a failure. Two other forms keep the iPhone out without naming
// it and are failures too: a skip that tests the project against another phone
// (`project.name !== 'pixel-7'`: the iPhone is a phone as well, use `isTouch`) and a Chromium-only
// skip (`browserName !== 'chromium'`). Not counted: the `full &&` copies of the sheet shape tests
// (timing tier, Chromium by design), skips after a SCREENSHOTS gate in the same file (pictures, not
// behaviour), and the files in EXEMPT_FILES (outside the three projects).
//
// The skips come off in batches. A spec file of a batch that is not done yet is listed in
// PENDING_BATCHES: its skips are reported, not failed. Each batch removes its files from the list
// when it lifts their skips; the list is empty when the pass is done. `--strict` fails on pending
// files too (what the list becoming empty will mean).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Spec file names (paths under tests/e2e) whose WebKit skips a later batch removes. Empty: B1 to B5
 * are done (B4, the Health specs, once the windowed Health list held still on WebKit; B5's Android
 * EditContext tests run on both phones with an iOS counterpart, so nothing of it is allowlisted). A
 * skip of the iPhone outside the allowlist fails the `check` job in every spec, with no exception.
 * @type {Record<string, string[]>}
 */
export const PENDING_BATCHES = {};

/**
 * Spec files that run outside the three projects (their own config), so a Chromium-only skip there
 * is not a hole. `engine-responsiveness.spec.ts` is `testIgnore`d by playwright.config.ts and run by
 * `npm run test:responsiveness` on Chromium.
 */
export const EXEMPT_FILES = ['engine-responsiveness.spec.ts'];

/** A skip or fixme call. */
const SKIP_START = /\b(?:test|info|testInfo)(?:\.describe)?\.(?:skip|fixme)\s*\(/g;
/** Names the iPhone project or WebKit. */
const NAMES_WEBKIT = /iphone|webkit/i;
/** Keeps the iPhone out without naming it: another phone only, or Chromium only. */
const KEEPS_IPHONE_OUT = /!==\s*['"]pixel-7['"]|browserName\s*!==\s*['"]chromium['"]/;
/** The sheet shape tests' full-speed copies. */
const FULL_SPEED = /\bfull\s*&&/;
/** A skip that gates a file on SCREENSHOTS=1. */
const SCREENSHOT_GATE = /SCREENSHOTS/;

/** Text of the balanced `( ... )` that opens at `open`, skipping strings and comments. */
function balanced(src, open) {
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		const c = src[i];
		if (c === '/' && src[i + 1] === '/') {
			while (i < src.length && src[i] !== '\n') i++;
		} else if (c === '/' && src[i + 1] === '*') {
			i = src.indexOf('*/', i + 2);
			if (i < 0) break;
			i++;
		} else if (c === "'" || c === '"' || c === '`') {
			for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
		} else if (c === '(') depth++;
		else if (c === ')' && --depth === 0) return src.slice(open, i + 1);
	}
	return src.slice(open);
}

/**
 * The skip calls in `src` that hide the iPhone: `{ line, text, kind }` each, `kind` being `webkit`
 * (names the iPhone or WebKit) or `other-project` (keeps it out without naming it). `exempt` turns
 * the second kind off, for a file outside the three projects.
 */
export function findWebKitSkips(src, { exempt = false } = {}) {
	const found = [];
	let gated = false;
	for (const m of src.matchAll(SKIP_START)) {
		// A call inside a comment is not a skip.
		const prefix = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index);
		if (/\/\/|\/\*|^\s*\*/.test(prefix)) continue;
		const open = m.index + m[0].length - 1;
		const args = balanced(src, open);
		// A SCREENSHOTS gate (`test.skip(!process.env['SCREENSHOTS'], ...)`) makes what follows pictures.
		if (SCREENSHOT_GATE.test(args)) gated = true;
		let kind = null;
		if (NAMES_WEBKIT.test(args)) kind = 'webkit';
		else if (!exempt && !gated && !FULL_SPEED.test(args) && KEEPS_IPHONE_OUT.test(args))
			kind = 'other-project';
		if (!kind) continue;
		found.push({
			line: src.slice(0, m.index).split('\n').length,
			kind,
			text: (m[0] + args.slice(1)).replace(/\s+/g, ' ').slice(0, 140),
		});
	}
	return found;
}

function specFiles(dir) {
	const out = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...specFiles(p));
		else if (e.name.endsWith('.spec.ts')) out.push(p);
	}
	return out.sort();
}

/**
 * Scans every spec under `dir`. `failures` are skips in files that must be clean; `pending` are the
 * skips of files still listed in `pending` (batch -> file names), reported only. With `strict` the
 * pending ones fail too.
 * @param {string} dir
 * @param {{ pending?: Record<string, string[]>, strict?: boolean }} [options]
 */
export function checkSpecs(dir, { pending = PENDING_BATCHES, strict = false } = {}) {
	const batchOf = new Map();
	for (const [batch, files] of Object.entries(pending))
		for (const f of files) batchOf.set(f, batch);
	const failures = [];
	const reported = [];
	for (const file of specFiles(dir)) {
		const rel = relative(dir, file).split(sep).join('/');
		const name = rel.split('/').pop();
		const hits = findWebKitSkips(readFileSync(file, 'utf8'), {
			exempt: EXEMPT_FILES.includes(name),
		});
		const batch = batchOf.get(rel);
		for (const h of hits) {
			const row = { file: rel, batch, ...h };
			if (batch && !strict) reported.push(row);
			else failures.push(row);
		}
	}
	return { failures, pending: reported };
}

function main() {
	const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
	const strict = process.argv.includes('--strict');
	const { failures, pending } = checkSpecs(join(root, 'tests', 'e2e'), { strict });
	for (const p of pending)
		console.log(`pending ${p.batch}: ${p.file}:${p.line} [${p.kind}]  ${p.text}`);
	for (const f of failures) console.error(`error: ${f.file}:${f.line} [${f.kind}]  ${f.text}`);
	if (failures.length > 0) {
		console.error(
			`\n${failures.length} WebKit skip(s) outside the allowlist. A skip hides an iPhone bug: fix the app or the test, ` +
				'or (only for touch through CDP, Chromium-only performance APIs, Android EditContext) add an entry in ' +
				'tests/e2e/lib/webkit-allowlist.ts and call skipOnWebKitIfAllowlisted(info).',
		);
		process.exit(1);
	}
	console.log(
		`WebKit skips: none outside the allowlist; ${pending.length} pending in later batches.`,
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
