// SPDX-License-Identifier: GPL-2.0-or-later
// A ratchet on fixed waits in the e2e tests (`page.waitForTimeout(ms)` and a bare `setTimeout(`). A fixed wait passes on a
// fast machine and fails on a slower one (CI's WebKit runs a median 3 times the Pixel 7's time),
// and most of the red CI runs of 2026-11-18 were one (user, 2026-11-18: fix the tests, not the
// symptoms). A test waits for a state instead: `expect(...).toHave...`, `expect.poll`, or a frame
// count from the page. tests/e2e/fixed-waits.json holds the count per file as it was; the check
// fails if a file has more than its count (a new file: more than 0), and asks to lower the count
// when a file has fewer, so the numbers only go down.
//
//   node scripts/ci/fixed-waits.mjs          check (also tests/ci/fixed-waits.test.ts)
//   node scripts/ci/fixed-waits.mjs --write  rewrite the baseline (only to lower it)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const BASELINE = join(ROOT, 'tests/e2e/fixed-waits.json');

/** The number of fixed waits in one file's source. */
export function countWaits(src) {
	return (src.match(/(?:\bwaitForTimeout|(?<![\w.])setTimeout)\s*\(/g) ?? []).length;
}

/** Every .ts file under tests/e2e with its count of fixed waits (files with none left out). */
export function scan(root = ROOT) {
	const out = {};
	const walk = (dir) => {
		for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
			const p = `${dir}/${e.name}`;
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith('.ts')) {
				const n = countWaits(readFileSync(join(root, p), 'utf8'));
				if (n > 0) out[p] = n;
			}
		}
	};
	walk('tests/e2e');
	return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** `over`: files above their baseline (errors); `under`: files below it (lower the baseline). */
export function compare(now, baseline) {
	const over = [];
	const under = [];
	for (const [f, n] of Object.entries(now)) {
		const was = baseline[f] ?? 0;
		if (n > was) over.push(`${f}: ${n} fixed waits, at most ${was}`);
	}
	for (const [f, was] of Object.entries(baseline)) {
		const n = now[f] ?? 0;
		if (n < was) under.push(`${f}: ${n}, baseline ${was}`);
	}
	return { over, under };
}

export function loadBaseline() {
	return JSON.parse(readFileSync(BASELINE, 'utf8')).files;
}

function main(argv) {
	const now = scan();
	if (argv.includes('--write')) {
		const { over } = compare(now, loadBaseline());
		if (over.length > 0) {
			console.error(`not lowering: over the baseline\n${over.join('\n')}`);
			process.exit(1);
		}
		const note =
			'Fixed waits (page.waitForTimeout, setTimeout) per e2e file; scripts/ci/fixed-waits.mjs. The numbers only go down.';
		writeFileSync(BASELINE, `${JSON.stringify({ note, files: now }, null, '\t')}\n`);
		return;
	}
	const { over, under } = compare(now, loadBaseline());
	const total = Object.values(now).reduce((a, b) => a + b, 0);
	console.log(`fixed waits: ${total} in ${Object.keys(now).length} files`);
	if (under.length > 0) console.log(`lower the baseline (--write):\n${under.join('\n')}`);
	if (over.length > 0) {
		console.error(`wait for a state instead of a time:\n${over.join('\n')}`);
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
