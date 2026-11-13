// SPDX-License-Identifier: GPL-2.0-or-later
// Astro integration that names each build (ADR-0012). The id is the commit the build came from
// (GITHUB_SHA in CI, else `git rev-parse`), plus the build time. The app gets it as
// `__MAINSPRING_BUILD__`, and the build writes the same value to `version.json` next to the pages,
// so a running app can ask whether a newer build is deployed. A dev server has the id "dev" and
// never asks.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** @param {NodeJS.ProcessEnv} env */
function commitOf(env) {
	if (env.GITHUB_SHA) return env.GITHUB_SHA.slice(0, 8);
	try {
		return execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return 'unknown';
	}
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('astro').AstroIntegration}
 */
export function buildId(env = process.env) {
	/** @type {{ id: string, builtAt: string }} */
	let build = { id: 'dev', builtAt: '' };
	return {
		name: 'mainspring-build-id',
		hooks: {
			'astro:config:setup': ({ command, updateConfig }) => {
				if (command === 'build') {
					const builtAt = new Date().toISOString();
					build = { id: `${commitOf(env)}-${builtAt.replace(/\D/g, '').slice(0, 12)}`, builtAt };
				}
				updateConfig({ vite: { define: { __MAINSPRING_BUILD__: JSON.stringify(build) } } });
			},
			'astro:build:done': ({ dir }) => {
				const file = path.join(fileURLToPath(dir), 'version.json');
				writeFileSync(file, `${JSON.stringify(build)}\n`);
			},
		},
	};
}
