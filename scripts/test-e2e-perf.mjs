// SPDX-License-Identifier: GPL-2.0-or-later
// npm run test:e2e:perf: builds the site and runs the Text mode timings
// (tests/e2e/text-mode-perf.spec.ts, desktop Chrome). The default e2e run skips them because they
// take about 8 minutes; CI runs them nightly. E2E_PERF_SKIP_BUILD=1 reuses an existing dist/.
import { spawnSync } from 'node:child_process';

const env = { ...process.env, E2E_PERF: '1' };
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args) {
	const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
	if (r.status !== 0) process.exit(r.status ?? 1);
}

if (process.env.E2E_PERF_SKIP_BUILD !== '1') run(npm, ['run', 'build']);
run(npx, ['playwright', 'test', 'tests/e2e/text-mode-perf.spec.ts', '--project=desktop']);
