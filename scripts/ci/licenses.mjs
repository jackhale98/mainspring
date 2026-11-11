// SPDX-License-Identifier: GPL-2.0-or-later
// Fails if a package that can reach the shipped client bundle has a license that is not
// compatible with GPL version 2 (ADR-0001; phase-1 spec 9.5).
//
// It walks the production dependency tree recorded in package-lock.json (every package without
// the `dev` flag), starting at the root's `dependencies`. Packages in BUILD_ONLY run only in
// Node at build time and never reach dist/; the walk does not enter them, so they and anything
// reachable only through them are reported as build-only and not checked. Code that ships
// inside an npm package but is not itself an npm package (OpenSSL in ruby.wasm) is listed in
// EMBEDDED_EXCEPTIONS and reported on every run without failing it.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SPDX ids that are compatible with GPL-2.0 (ADR-0001: "MIT, BSD, ISC and similar", plus the
 * GPL-2.0 family). Anything else fails: Apache-2.0 alone, GPL-3.0 and AGPL in any form,
 * LGPL-3.0, MPL-2.0 (its file-level copyleft would need a decision of its own), CC-BY and
 * unknown or missing licenses.
 */
export const COMPATIBLE = new Set([
	'MIT',
	'MIT-0',
	'ISC',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'0BSD',
	'Zlib',
	'Unlicense',
	'CC0-1.0',
	'BlueOak-1.0.0',
	'Python-2.0',
	// The GPL-2.0 family. Deprecated short forms are kept because old packages still use them.
	'GPL-2.0',
	'GPL-2.0+',
	'GPL-2.0-only',
	'GPL-2.0-or-later',
	'LGPL-2.0',
	'LGPL-2.0+',
	'LGPL-2.0-only',
	'LGPL-2.0-or-later',
	'LGPL-2.1',
	'LGPL-2.1+',
	'LGPL-2.1-only',
	'LGPL-2.1-or-later',
]);

/**
 * `license WITH exception` pairs that are compatible although the license alone is not. The
 * LLVM exception waives the Apache-2.0 terms that conflict with GPL-2.0 (THIRD_PARTY_NOTICES.md,
 * wasi-vfs). A compatible license with any exception is compatible too.
 */
export const COMPATIBLE_WITH = new Set(['Apache-2.0 WITH LLVM-exception']);

/**
 * Production packages that never reach dist/. Each entry names the package and why it is
 * build-only. The walk does not descend into them; a dependency that some shipped package also
 * reaches is still checked. Adding a package here needs the same evidence: it runs only in
 * Node during `astro build`/`astro check`, and the built site contains none of its code.
 */
export const BUILD_ONLY = new Map([
	[
		'sharp',
		"Astro's image service (Apache-2.0, with LGPL-3.0 libvips binaries). It runs in Node at " +
			'build time to process images; the site ships the output images, not sharp.',
	],
	[
		'lightningcss',
		"Vite's optional CSS transformer and minifier (MPL-2.0), a native Node module. The built " +
			'CSS is our own stylesheets; no lightningcss code is in dist/.',
	],
	[
		'typescript',
		'Compiler (Apache-2.0) that @astrojs/svelte and svelte2tsx call for type checking and ' +
			'.svelte type generation. It never runs in the browser.',
	],
	[
		'aria-query',
		'ARIA tables (Apache-2.0) imported only by the Svelte compiler (svelte/src/compiler/.../a11y) ' +
			"and Astro's dev toolbar audit, not by Svelte's client runtime or any built page.",
	],
	[
		'axobject-query',
		'Accessibility tables (Apache-2.0) imported only by the Svelte compiler and the Astro dev ' +
			'toolbar audit, like aria-query.',
	],
]);

/**
 * Code with an incompatible license that ships inside a compatible npm package. Reported on
 * every run, never a failure: each one is an open issue with its own decision.
 */
export const EMBEDDED_EXCEPTIONS = [
	{
		package: '@ruby/3.4-wasm-wasi',
		version: '2.10.1',
		component: 'OpenSSL 3.2.0, statically linked into ruby.wasm and ruby+stdlib.wasm',
		license: 'Apache-2.0',
		reason:
			'ADR-0001 open issue, blocks any public release: Mainspring never loads it, but it ships ' +
			'in public/engine/ruby.*.wasm.gz. See THIRD_PARTY_NOTICES.md.',
	},
];

/** Split an SPDX expression into tokens: `(`, `)`, `AND`, `OR`, `WITH` and ids. */
export function tokenize(expr) {
	return expr
		.replace(/[()]/g, ' $& ')
		.split(/\s+/)
		.filter((t) => t !== '');
}

/**
 * Parse an SPDX expression into a tree of `{ op: 'or' | 'and', args }`, `{ id, exception? }`
 * nodes. Throws on malformed input. `OR` binds looser than `AND`, as in the SPDX spec.
 */
export function parseSpdx(expr) {
	const tokens = tokenize(expr);
	let i = 0;
	const peek = () => tokens[i];
	const next = () => tokens[i++];

	function primary() {
		const t = next();
		if (t === undefined) throw new Error(`unexpected end of "${expr}"`);
		if (t === '(') {
			const inner = orExpr();
			if (next() !== ')') throw new Error(`missing ")" in "${expr}"`);
			return inner;
		}
		if (/^(AND|OR|WITH|\))$/i.test(t)) throw new Error(`unexpected "${t}" in "${expr}"`);
		if (peek()?.toUpperCase() === 'WITH') {
			next();
			const exception = next();
			if (exception === undefined || /^[()]$/.test(exception)) {
				throw new Error(`missing exception after WITH in "${expr}"`);
			}
			return { id: t, exception };
		}
		return { id: t };
	}
	function andExpr() {
		const args = [primary()];
		while (peek()?.toUpperCase() === 'AND') {
			next();
			args.push(primary());
		}
		return args.length === 1 ? args[0] : { op: 'and', args };
	}
	function orExpr() {
		const args = [andExpr()];
		while (peek()?.toUpperCase() === 'OR') {
			next();
			args.push(andExpr());
		}
		return args.length === 1 ? args[0] : { op: 'or', args };
	}

	const tree = orExpr();
	if (i !== tokens.length) throw new Error(`unexpected "${tokens[i]}" in "${expr}"`);
	return tree;
}

function nodeCompatible(node) {
	if ('op' in node) {
		const results = node.args.map(nodeCompatible);
		return node.op === 'or' ? results.some(Boolean) : results.every(Boolean);
	}
	if (COMPATIBLE.has(node.id)) return true;
	return node.exception !== undefined && COMPATIBLE_WITH.has(`${node.id} WITH ${node.exception}`);
}

/**
 * Classify a package's license. `license` is the package.json `license` string, a legacy
 * `{ type }` object, or a legacy `licenses` array (treated as a choice between them), or
 * undefined. Returns `{ ok, expression, reason? }`.
 */
export function classifyLicense(license) {
	let expression;
	if (typeof license === 'string') expression = license.trim();
	else if (Array.isArray(license) && license.length > 0) {
		const ids = license.map((l) => (typeof l === 'string' ? l : l?.type));
		if (ids.some((id) => typeof id !== 'string')) {
			return { ok: false, expression: JSON.stringify(license), reason: 'unreadable license' };
		}
		expression = ids.length === 1 ? ids[0] : `(${ids.join(' OR ')})`;
	} else if (license && typeof license === 'object' && typeof license.type === 'string') {
		expression = license.type;
	}
	if (!expression) return { ok: false, expression: '(none)', reason: 'no license declared' };
	if (/^(UNLICENSED|SEE LICENSE IN\b)/i.test(expression)) {
		return { ok: false, expression, reason: 'not an open-source license id' };
	}
	let tree;
	try {
		tree = parseSpdx(expression);
	} catch (err) {
		return { ok: false, expression, reason: `not a valid SPDX expression (${err.message})` };
	}
	return nodeCompatible(tree)
		? { ok: true, expression }
		: { ok: false, expression, reason: 'not GPL-2.0 compatible' };
}

/** The package name of a lockfile path such as `node_modules/a/node_modules/@b/c`. */
export function nameOfPath(path) {
	const at = path.lastIndexOf('node_modules/');
	return path.slice(at + 'node_modules/'.length);
}

/**
 * Resolve dependency `name` from the package at lockfile path `from` the way Node does: the
 * nearest `node_modules/<name>` walking up from `from`. Returns the lockfile path or null.
 */
export function resolveDep(packages, from, name) {
	let base = from;
	for (;;) {
		const candidate = base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`;
		if (Object.hasOwn(packages, candidate)) return candidate;
		if (base === '') return null;
		const at = base.lastIndexOf('/node_modules/');
		base = at === -1 ? '' : base.slice(0, at);
	}
}

/**
 * Check a parsed package-lock.json (lockfileVersion 2 or 3). `readLicense(path)` is the fallback
 * for lock entries without a `license` field (it reads node_modules/<path>/package.json in the
 * CLI). Returns the report; `failures` empty means the check passes.
 *
 * @param {{ packages?: Record<string, any> }} lock
 * @param {{
 *   buildOnly?: Map<string, string>,
 *   embedded?: Array<{ package: string, version: string, component: string, license: string, reason: string }>,
 *   readLicense?: (path: string) => unknown,
 * }} [options]
 */
export function checkLock(
	lock,
	{
		buildOnly = BUILD_ONLY,
		embedded = EMBEDDED_EXCEPTIONS,
		readLicense = (_path) => undefined,
	} = {},
) {
	const packages = lock.packages ?? {};
	const root = packages[''] ?? {};
	const failures = [];
	const warnings = [];
	const shipped = new Map();
	const buildOnlySeen = new Set();

	for (const name of Object.keys(root.dependencies ?? {})) {
		if (buildOnly.has(name)) {
			failures.push({
				path: `node_modules/${name}`,
				reason: 'listed as build-only but declared in package.json "dependencies"',
			});
		}
	}

	/** @type {Array<[string, string]>} [from path, dependency name] */
	const queue = [
		...Object.keys(root.dependencies ?? {}),
		...Object.keys(root.optionalDependencies ?? {}),
	].map((name) => ['', name]);
	while (queue.length > 0) {
		const [from, name] = /** @type {[string, string]} */ (queue.shift());
		if (buildOnly.has(name)) {
			buildOnlySeen.add(name);
			continue;
		}
		let path = resolveDep(packages, from, name);
		if (path === null) continue; // optional or peer dependency not installed
		let entry = packages[path];
		if (entry.link && typeof entry.resolved === 'string') {
			path = entry.resolved;
			entry = packages[path] ?? entry;
		}
		if (shipped.has(path)) continue;
		if (entry.dev) {
			warnings.push(`${path} is reached from production dependencies but flagged dev`);
		}
		shipped.set(path, entry);
		for (const dep of Object.keys({
			...entry.dependencies,
			...entry.optionalDependencies,
			...entry.peerDependencies,
		})) {
			queue.push([path, dep]);
		}
	}

	const checked = [];
	for (const [path, entry] of shipped) {
		const license = entry.license ?? readLicense(path);
		const result = classifyLicense(license);
		const name = entry.name ?? nameOfPath(path);
		checked.push({ path, name, version: entry.version, ...result });
		if (!result.ok) {
			failures.push({
				path,
				name,
				version: entry.version,
				license: result.expression,
				reason: result.reason,
			});
		}
	}

	for (const name of buildOnly.keys()) {
		if (!buildOnlySeen.has(name)) {
			warnings.push(`build-only entry "${name}" is not in the production tree; remove it`);
		}
	}

	const production = Object.entries(packages).filter(([p, e]) => p !== '' && !e.dev);
	const buildOnlyPackages = production
		.map(([p]) => p)
		.filter((p) => p.includes('node_modules/') && !shipped.has(p));

	const exceptions = embedded.map((e) => {
		const path = resolveDep(packages, '', e.package);
		const version = path === null ? null : packages[path].version;
		if (version !== null && version !== e.version) {
			warnings.push(
				`${e.package} is ${version}, but its embedded exception was recorded for ${e.version}; recheck it`,
			);
		}
		return { ...e, installed: version };
	});

	return {
		checked,
		failures,
		warnings,
		exceptions,
		buildOnlyRoots: [...buildOnlySeen].sort(),
		buildOnlyPackages,
	};
}

function readInstalledLicense(root, path) {
	const file = join(root, path, 'package.json');
	if (!existsSync(file)) return undefined;
	const pkg = JSON.parse(readFileSync(file, 'utf8'));
	return pkg.license ?? pkg.licenses;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = process.cwd();
	const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
	const report = checkLock(lock, { readLicense: (p) => readInstalledLicense(root, p) });

	console.log(
		`licenses: ${report.checked.length} production packages checked as possibly shipped; ` +
			`${report.buildOnlyPackages.length} production packages are build-only ` +
			`(through ${report.buildOnlyRoots.join(', ') || 'none'}).`,
	);
	for (const e of report.exceptions) {
		console.log(
			`licenses: known exception, not a failure: ${e.component} in ${e.package}@${e.installed ?? 'missing'} ` +
				`is ${e.license}. ${e.reason}`,
		);
	}
	for (const w of report.warnings) console.warn(`licenses: warning: ${w}`);
	if (report.failures.length > 0) {
		console.error(
			'licenses: packages that can ship with a license that is not GPL-2.0 compatible:\n' +
				report.failures
					.map(
						(f) =>
							`  ${f.path}${f.version ? `@${f.version}` : ''}: ${f.license ?? ''} (${f.reason})`,
					)
					.join('\n'),
		);
		process.exit(1);
	}
	console.log('licenses: ok');
}
