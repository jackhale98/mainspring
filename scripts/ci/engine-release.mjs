// SPDX-License-Identifier: GPL-2.0-or-later
// engine-release.mjs - refuse to deploy an engine built on a test interpreter (phase-4 T13).
//
//   node scripts/ci/engine-release.mjs <site>/engine/manifest.json
//
// engine/build-bundle.mjs --ruby-wasm (or MAINSPRING_RUBY_WASM) builds the engine on another
// ruby.wasm binary, for checks such as .github/workflows/ruby-wasm.yml. It records that binary's
// rubyWasm version with a "+<build>" suffix (it refuses a label without one) and puts a "Not for
// release" line in NOTICES.txt. pages.yml runs this on the built site before uploading it, so such
// an engine is never deployed by accident. NOTICES.txt must be next to the manifest: it carries
// the engine's licences.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What stops this engine from being deployed (empty when nothing does).
 * @param {unknown} manifest the parsed manifest.json
 * @param {string | null} notices NOTICES.txt next to it, or null when it is missing
 * @returns {string[]}
 */
export function engineReleaseProblems(manifest, notices) {
	const problems = [];
	const rubyWasm = /** @type {{ rubyWasm?: { version?: unknown } } | null} */ (manifest)?.rubyWasm;
	const version = rubyWasm?.version;
	if (typeof version !== 'string' || version === '') {
		problems.push('manifest.json has no rubyWasm.version');
	} else if (version.includes('+')) {
		problems.push(
			`rubyWasm.version is ${version}: an engine built on a test interpreter (build-bundle.mjs --ruby-wasm) is not for release`,
		);
	}
	if (notices === null) problems.push('NOTICES.txt is missing next to manifest.json');
	else if (/not for release/i.test(notices)) {
		problems.push('NOTICES.txt says the interpreter is not for release');
	}
	return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const file = process.argv[2];
	if (!file) {
		console.error('usage: engine-release.mjs <site>/engine/manifest.json');
		process.exit(2);
	}
	const noticesFile = join(dirname(file), 'NOTICES.txt');
	const problems = engineReleaseProblems(
		JSON.parse(readFileSync(file, 'utf8')),
		existsSync(noticesFile) ? readFileSync(noticesFile, 'utf8') : null,
	);
	if (problems.length) {
		console.error(`engine-release: ${file} must not be deployed:\n  ${problems.join('\n  ')}`);
		process.exit(1);
	}
	console.log(`engine-release: ${file} is a release engine`);
}
