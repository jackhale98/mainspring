// SPDX-License-Identifier: GPL-2.0-or-later
// npm run test:base-path (ADR-0006): builds the site as the GitHub Pages workflow does
// (MAINSPRING_BASE=/mainspring/, no dev pages), fails on root-absolute URLs left in the output
// (scripts/ci/base-path-scan.mjs), then serves dist/ under /mainspring/ the way Pages does
// (scripts/serve-pages.mjs) and runs tests/base-path/ in desktop Chromium.
// The build replaces dist/. BASE_PATH_SKIP_BUILD=1 reuses a dist/ already built with that base.
// Any arguments are passed through to `playwright test`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { scanBuild } from './ci/base-path-scan.mjs';

const BASE = '/mainspring/';
const env = { ...process.env, MAINSPRING_BASE: BASE };
delete env.MAINSPRING_DEV_PAGES;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args) {
	const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

if (process.env.BASE_PATH_SKIP_BUILD !== '1') run(npm, ['run', 'build']);
if (!existsSync('dist/app/index.html')) {
	console.error('test:base-path: dist/app/index.html is missing; build the site first');
	process.exit(1);
}
if (existsSync('dist/dev')) {
	console.error('test:base-path: dist/ has dev pages; the Pages build is made without them');
	process.exit(1);
}
const problems = scanBuild('dist', BASE);
if (problems.length > 0) {
	console.error(
		`test:base-path: root-absolute URLs outside ${BASE} (is dist/ built with MAINSPRING_BASE=${BASE}?):\n` +
			problems.map((p) => '  ' + p).join('\n'),
	);
	process.exit(1);
}
console.log(`test:base-path: every site URL in dist/ is under ${BASE}`);
run(npx, ['playwright', 'test', '-c', 'playwright.base-path.config.ts', ...process.argv.slice(2)]);
