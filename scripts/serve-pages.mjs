// SPDX-License-Identifier: GPL-2.0-or-later
// A static server that serves a built site the way GitHub Pages serves a project site (ADR-0006),
// for the base-path test (npm run test:base-path). Test tooling only; nothing here ships.
//
// - Files are served only under the base path; every other path is 404.
// - A directory without its trailing slash redirects (301) to it, keeping the query; a directory
//   serves its index.html, and "name" also finds "name.html".
// - Files go out as stored, typed by extension, never with Content-Encoding: a .gz file is
//   application/gzip, so the app has to gunzip the engine assets itself, as on Pages.
// - No Jekyll: names that start with "_" (Astro's _astro/) are served like any other.
//
//   node scripts/serve-pages.mjs [--dir dist] [--base /mainspring/] [--port 4324] [--host localhost]
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Content types by extension, as GitHub Pages sends them; anything else is octet-stream. */
export const CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.wasm': 'application/wasm',
	'.gz': 'application/gzip',
};

/** @param {string} path @returns {import('node:fs').Stats | null} */
function statOrNull(path) {
	try {
		return statSync(path);
	} catch {
		return null;
	}
}

/**
 * The file a request path names inside `root`, or a redirect, or null for 404.
 * @param {string} root absolute
 * @param {string} rel the decoded path below the base, without its leading slash
 * @returns {{ file: string } | { redirect: true } | null}
 */
function lookup(root, rel) {
	const path = resolve(root, rel);
	if (path !== root && !path.startsWith(root + sep)) return null;
	const stat = statOrNull(path);
	if (stat?.isDirectory()) {
		if (rel !== '' && !rel.endsWith('/')) return { redirect: true };
		const index = join(path, 'index.html');
		return statOrNull(index)?.isFile() ? { file: index } : null;
	}
	if (stat?.isFile()) return { file: path };
	if (!rel.endsWith('/') && statOrNull(`${path}.html`)?.isFile()) return { file: `${path}.html` };
	return null;
}

/**
 * An HTTP server (not yet listening) for the site in `dir` under `base`.
 * @param {{ dir: string, base: string }} options base with both slashes, e.g. "/mainspring/"
 * @returns {import('node:http').Server}
 */
export function createPagesServer({ dir, base }) {
	const root = resolve(dir);
	return createServer((req, res) => {
		const notFound = () => {
			res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end(req.method === 'HEAD' ? undefined : 'Not found\n');
		};
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { Allow: 'GET, HEAD' });
			res.end();
			return;
		}
		const url = new URL(req.url ?? '/', 'http://pages.invalid');
		if (url.pathname === base.slice(0, -1)) {
			res.writeHead(301, { Location: base + url.search });
			res.end();
			return;
		}
		if (!url.pathname.startsWith(base)) return notFound();
		let rel;
		try {
			rel = decodeURIComponent(url.pathname.slice(base.length));
		} catch {
			return notFound();
		}
		if (rel.includes('\0')) return notFound();
		const found = lookup(root, rel);
		if (found === null) return notFound();
		if ('redirect' in found) {
			res.writeHead(301, { Location: `${url.pathname}/${url.search}` });
			res.end();
			return;
		}
		const type = CONTENT_TYPES[/** @type {keyof typeof CONTENT_TYPES} */ (extname(found.file))];
		res.writeHead(200, {
			'Content-Type': type ?? 'application/octet-stream',
			'Content-Length': statSync(found.file).size,
			'Cache-Control': 'max-age=600',
		});
		if (req.method === 'HEAD') res.end();
		else createReadStream(found.file).pipe(res);
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			dir: { type: 'string', default: 'dist' },
			base: { type: 'string', default: '/mainspring/' },
			port: { type: 'string', default: '4324' },
			host: { type: 'string', default: 'localhost' },
		},
	});
	const base = values.base;
	if (!base.startsWith('/') || !base.endsWith('/') || base === '/') {
		console.error('serve-pages: --base must be a path with both slashes, such as /mainspring/');
		process.exit(2);
	}
	const server = createPagesServer({ dir: values.dir, base });
	server.listen(Number(values.port), values.host, () => {
		console.log(`serve-pages: ${values.dir} at http://${values.host}:${values.port}${base}`);
	});
}
