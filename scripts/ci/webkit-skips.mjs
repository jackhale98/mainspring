// SPDX-License-Identifier: GPL-2.0-or-later
// Fails the `check` job when an end-to-end spec skips the iPhone 14 project (WebKit) on its own
// (ADR-0016 section 2). The one way to skip on WebKit is `skipOnWebKitIfAllowlisted(info)` with an
// entry in tests/e2e/lib/webkit-allowlist.ts, so any other `skip` or `fixme` call that names
// `iphone`, `isIphone` or `webkit` is a failure.
//
// The skips come off in four batches. A spec file of a batch that is not done yet is listed in
// PENDING_BATCHES: its skips are reported, not failed. Each batch removes its files from the list
// when it lifts their skips; the list is empty when the pass is done. `--strict` fails on pending
// files too (what the list becoming empty will mean).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Spec file names (paths under tests/e2e) whose WebKit skips a later batch removes. B1 is done.
 * @type {Record<string, string[]>}
 */
export const PENDING_BATCHES = {
	// B2: new plan, the Gantt filter, the edge cases of gestures, gantt-a11y, and the two timing specs.
	B2: [
		'new-plan.spec.ts',
		'new-plan-screenshots.spec.ts',
		'gantt-filter.spec.ts',
		'gantt-gestures-edge.spec.ts',
		'gantt-a11y.spec.ts',
		'gantt-gesture-frames.spec.ts',
		'gantt-perf.spec.ts',
	],
	// B3: People (shell, workload, lanes, calendar, resources, workload-gate).
	B3: [
		'people-shell.spec.ts',
		'people-shell-screenshots.spec.ts',
		'workload.spec.ts',
		'workload-gate.spec.ts',
		'workload-perf.spec.ts',
		'workload-screenshots.spec.ts',
		'lanes.spec.ts',
		'lanes-screenshots.spec.ts',
		'calendar.spec.ts',
		'calendar-sheet.spec.ts',
		'calendar-screenshots.spec.ts',
		'resources.spec.ts',
		'resources-screenshots.spec.ts',
	],
	// B4: health, health fixes, why-here and the screenshot specs.
	B4: ['health.spec.ts', 'health-fixes.spec.ts', 'health-screenshots.spec.ts', 'why-here.spec.ts'],
};

/** A skip or fixme call. It counts when its arguments name the iPhone project or WebKit. */
const SKIP_START = /\b(?:test|info|testInfo)(?:\.describe)?\.(?:skip|fixme)\s*\(/g;
const NAMES_WEBKIT = /iphone|webkit/i;

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

/** The skip calls in `src` that name WebKit or the iPhone: `{ line, text }` each. */
export function findWebKitSkips(src) {
	const found = [];
	for (const m of src.matchAll(SKIP_START)) {
		// A call inside a comment is not a skip.
		const prefix = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index);
		if (/\/\/|\/\*|^\s*\*/.test(prefix)) continue;
		const open = m.index + m[0].length - 1;
		const args = balanced(src, open);
		if (!NAMES_WEBKIT.test(args)) continue;
		found.push({
			line: src.slice(0, m.index).split('\n').length,
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
		const name = file.split(/[\\/]/).pop();
		const hits = findWebKitSkips(readFileSync(file, 'utf8'));
		const batch = batchOf.get(name);
		for (const h of hits) {
			const row = { file: relative(dir, file), batch, ...h };
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
	for (const p of pending) console.log(`pending ${p.batch}: ${p.file}:${p.line}  ${p.text}`);
	for (const f of failures) console.error(`error: ${f.file}:${f.line}  ${f.text}`);
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
