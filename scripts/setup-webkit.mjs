// SPDX-License-Identifier: GPL-2.0-or-later
// npm run setup:webkit: installs Playwright's WebKit into a local browsers folder and checks that
// it starts (ADR-0016 section 2). The folder is PLAYWRIGHT_BROWSERS_PATH when set, else
// `.cache/pw-webkit` (git-ignored); `0` is Playwright's "inside node_modules". On Linux a missing
// system library is fixed with `npx playwright install-deps webkit` only when asked with `--deps`
// (it runs apt, so never unasked, root or not); otherwise the command is printed. Run the iPhone specs with `npm run test:e2e:iphone -- tests/e2e/<spec>.spec.ts`.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { webkitBrowsersPath } from './webkit-path.mjs';

const browsersPath = webkitBrowsersPath();
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath };
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const shell = process.platform === 'win32';

function run(args) {
	return spawnSync(npx, ['playwright', ...args], { stdio: 'inherit', env, shell }).status ?? 1;
}

/** Starts WebKit once; returns the error text, or null when it works. */
function launchError() {
	const probe =
		"import('@playwright/test').then(async ({ webkit }) => { const b = await webkit.launch(); await b.close(); })" +
		'.catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });';
	const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
		env,
		encoding: 'utf8',
	});
	return r.status === 0 ? null : (r.stderr || 'WebKit did not start').trim();
}

if (browsersPath !== '0') mkdirSync(browsersPath, { recursive: true });
console.log(
	`WebKit folder: ${browsersPath === '0' ? 'inside node_modules (PLAYWRIGHT_BROWSERS_PATH=0)' : browsersPath}`,
);
if (run(['install', 'webkit']) !== 0) process.exit(1);

let problem = launchError();
if (problem && process.platform === 'linux') {
	if (process.argv.includes('--deps')) {
		console.log('WebKit did not start; installing its system libraries (needs apt).');
		if (run(['install-deps', 'webkit']) === 0) problem = launchError();
	} else {
		console.error(
			'WebKit is installed but did not start (a system library is probably missing). Run:\n' +
				'  sudo npx playwright install-deps webkit\n' +
				'or run this script again with --deps (it runs that command).',
		);
	}
}
if (problem) {
	console.error(`\nWebKit does not start:\n${problem}`);
	process.exit(1);
}
console.log('WebKit starts. Run the iPhone 14 project with:');
console.log('  npm run test:e2e:iphone -- tests/e2e/<spec>.spec.ts');
