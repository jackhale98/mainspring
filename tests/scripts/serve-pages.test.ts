// SPDX-License-Identifier: GPL-2.0-or-later
// The GitHub Pages stand-in used by the base-path test (scripts/serve-pages.mjs, ADR-0006).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPagesServer } from '../../scripts/serve-pages.mjs';

interface Reply {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: Buffer;
}

let parent = '';
let server: Server;
let port = 0;

/** A raw request, so that the path reaches the server exactly as written. */
function get(path: string, method = 'GET'): Promise<Reply> {
	return new Promise((done, fail) => {
		const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (c: Buffer) => chunks.push(c));
			res.on('end', () =>
				done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
			);
		});
		req.on('error', fail);
		req.end();
	});
}

beforeAll(async () => {
	parent = mkdtempSync(join(tmpdir(), 'serve-pages-'));
	const dir = join(parent, 'site');
	const files: Record<string, string | Buffer> = {
		'index.html': '<a href="/mainspring/app">Open</a>',
		'app/index.html': '<h1>App</h1>',
		'_astro/app.js': 'export {};',
		'engine/assets.json.gz': gzipSync('{"ok":true}'),
		'about.html': '<h1>About</h1>',
	};
	for (const [name, data] of Object.entries(files)) {
		mkdirSync(join(dir, name, '..'), { recursive: true });
		writeFileSync(join(dir, name), data);
	}
	writeFileSync(join(parent, 'outside.txt'), 'secret');
	server = createPagesServer({ dir, base: '/mainspring/' });
	await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
	port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
	await new Promise((closed) => server.close(closed));
	rmSync(parent, { recursive: true, force: true });
});

describe('createPagesServer', () => {
	it('serves nothing outside the base path', async () => {
		expect((await get('/')).status).toBe(404);
		expect((await get('/app')).status).toBe(404);
		expect((await get('/engine/assets.json.gz')).status).toBe(404);
		expect((await get('/mainspringx/app/')).status).toBe(404);
	});

	it('redirects the base and directories to their trailing slash, keeping the query', async () => {
		const root = await get('/mainspring');
		expect(root.status).toBe(301);
		expect(root.headers['location']).toBe('/mainspring/');
		const app = await get('/mainspring/app?sample=upstream-tutorial');
		expect(app.status).toBe(301);
		expect(app.headers['location']).toBe('/mainspring/app/?sample=upstream-tutorial');
	});

	it('serves index.html for a directory and name.html for an extensionless name', async () => {
		const home = await get('/mainspring/');
		expect(home.status).toBe(200);
		expect(home.headers['content-type']).toBe('text/html; charset=utf-8');
		expect((await get('/mainspring/app/')).body.toString()).toBe('<h1>App</h1>');
		expect((await get('/mainspring/about')).body.toString()).toBe('<h1>About</h1>');
	});

	it('serves paths that start with "_" (no Jekyll) as JavaScript', async () => {
		const js = await get('/mainspring/_astro/app.js');
		expect(js.status).toBe(200);
		expect(js.headers['content-type']).toBe('application/javascript; charset=utf-8');
	});

	it('serves .gz files as stored: application/gzip, no Content-Encoding', async () => {
		const gz = await get('/mainspring/engine/assets.json.gz');
		expect(gz.status).toBe(200);
		expect(gz.headers['content-type']).toBe('application/gzip');
		expect(gz.headers['content-encoding']).toBeUndefined();
		expect([...gz.body.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
	});

	it('answers HEAD without a body', async () => {
		const head = await get('/mainspring/', 'HEAD');
		expect(head.status).toBe(200);
		expect(head.body.length).toBe(0);
	});

	it('never leaves the site directory', async () => {
		expect((await get('/mainspring/../outside.txt')).status).toBe(404);
		expect((await get('/mainspring/%2e%2e/outside.txt')).status).toBe(404);
		expect((await get('/mainspring//etc/hostname')).status).toBe(404);
		expect((await get('/mainspring/%E0%A4%A')).status).toBe(404);
	});

	it('refuses methods other than GET and HEAD', async () => {
		expect((await get('/mainspring/', 'POST')).status).toBe(405);
	});
});
