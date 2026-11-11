// SPDX-License-Identifier: GPL-2.0-or-later
// npm run test:golden: builds the site with MAINSPRING_DEV_PAGES=1 (the parity test needs the
// /dev/engine page) and runs tests/golden/parity.spec.ts on Chromium.
// GOLDEN_SKIP_BUILD=1 reuses an existing dist/ that already has the dev page.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const env = { ...process.env, MAINSPRING_DEV_PAGES: '1' };
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args) {
	const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

if (process.env.GOLDEN_SKIP_BUILD !== '1') run(npm, ['run', 'build']);
if (!existsSync('dist/dev/engine/index.html')) {
	console.error('test:golden: dist/dev/engine/index.html is missing; the build has no dev pages');
	process.exit(1);
}
run(npx, ['playwright', 'test', '-c', 'playwright.golden.config.ts']);
