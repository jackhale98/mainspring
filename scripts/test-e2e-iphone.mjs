// SPDX-License-Identifier: GPL-2.0-or-later
// npm run test:e2e:iphone -- <spec or playwright args>: runs the end-to-end specs on the iPhone 14
// project (WebKit) with the browsers folder that `npm run setup:webkit` filled. It does not build:
// the preview serves dist/, so run `astro build` first and after every source change.
import { spawnSync } from 'node:child_process';
import { webkitBrowsersPath } from './webkit-path.mjs';

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: webkitBrowsersPath() };
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const r = spawnSync(
	npx,
	['playwright', 'test', '--project=iphone-14', '--trace', 'off', ...process.argv.slice(2)],
	{ stdio: 'inherit', env, shell: process.platform === 'win32' },
);
process.exit(r.status ?? 1);
