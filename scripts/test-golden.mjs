// SPDX-License-Identifier: GPL-2.0-or-later
// npm run test:golden: builds the site with MAINSPRING_DEV_PAGES=1 (the parity test needs the
// /dev/engine page) and runs tests/golden/parity.spec.ts on Chromium by default.
// Browser: GOLDEN_BROWSER=chromium|firefox|webkit, or --browser=<name> / --browser <name>.
// Any other arguments are passed through to `playwright test`.
// GOLDEN_SKIP_BUILD=1 reuses an existing dist/ that already has the dev page.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const passthrough = [];
let browser = process.env.GOLDEN_BROWSER || 'chromium';
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a === '--browser') browser = argv[++i] ?? '';
	else if (a.startsWith('--browser=')) browser = a.slice('--browser='.length);
	else passthrough.push(a);
}
if (!['chromium', 'firefox', 'webkit'].includes(browser)) {
	console.error(`test:golden: unknown browser "${browser}" (chromium, firefox or webkit)`);
	process.exit(1);
}

const env = { ...process.env, MAINSPRING_DEV_PAGES: '1', GOLDEN_BROWSER: browser };
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
run(npx, ['playwright', 'test', '-c', 'playwright.golden.config.ts', ...passthrough]);
