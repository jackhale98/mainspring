// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What every recorded measurement says about where it came from (T22, phase-3-perf-a11y.md): the
 * device the project emulates, the browser, the build, the host and the load average at the start
 * (a shared machine's other work shows up as dropped frames), and the CPU throttle. Written next to
 * the numbers in test-results/*.json, so a number is never read without its conditions.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { REPO } from '../../golden/corpus';

export const loadavg = (): number[] => os.loadavg().map((v) => Math.round(v * 100) / 100);

function build(): string {
	try {
		return execSync('git describe --always --dirty', { cwd: REPO }).toString().trim();
	} catch {
		return 'unknown';
	}
}

const DEVICES: Record<string, string> = {
	desktop: 'Desktop Chrome (1280x720, no throttle)',
	'pixel-7': 'Pixel 7 emulation (412x915, dpr 2.625, touch)',
	'iphone-14': 'iPhone 14 emulation (WebKit)',
};

export async function perfEnvironment(page: Page, info: TestInfo, cpuThrottle = 1) {
	const browser = page.context().browser();
	return {
		when: new Date().toISOString(),
		project: info.project.name,
		device: DEVICES[info.project.name] ?? info.project.name,
		cpuThrottle,
		browser: `${browser?.browserType().name()} ${browser?.version()}`,
		userAgent: await page.evaluate(() => navigator.userAgent),
		build: build(),
		host: `${os.cpus()[0]?.model} x${os.cpus().length}`,
		loadAverageAtStart: loadavg(),
	};
}

/** Writes a file whole: to a temporary name in the same folder, then renamed over it. */
function writeAtomic(out: string, text: string): void {
	fs.mkdirSync(path.dirname(out), { recursive: true });
	const tmp = `${out}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	fs.writeFileSync(tmp, text);
	fs.renameSync(tmp, out);
}

/**
 * One result in a file of its own, `test-results/<name>.json` (a test per file: tests that run in
 * parallel in the merge tier never share one). Name it `<spec>-<test>-<project>`.
 */
export function recordFile(name: string, value: unknown): void {
	writeAtomic(path.join(REPO, 'test-results', `${name}.json`), JSON.stringify(value, null, 2));
}

/**
 * Merges one key into a shared JSON file under test-results, for the serial timing tier only
 * (scripts/ci/timing-check.mjs reads `workload-perf.json`). The write is atomic and a file that
 * does not parse is started afresh, but two writers at once would still lose one key: use
 * `recordFile` for anything that can run in parallel.
 */
export function recordInto(file: string, key: string, value: unknown): void {
	const out = path.join(REPO, 'test-results', file);
	let old: object = {};
	try {
		old = JSON.parse(fs.readFileSync(out, 'utf8')) as object;
	} catch {
		// Missing or half-written: start again.
	}
	writeAtomic(out, JSON.stringify({ ...old, [key]: value }, null, 2));
}
