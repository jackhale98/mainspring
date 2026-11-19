// SPDX-License-Identifier: GPL-2.0-or-later
// The keyword docs asset of the built engine (ADR-0017, npm run build:engine): after gunzip it
// deep-equals what that engine's syntax() gives in Node, its name and the manifest's sha256 match
// its bytes, the app's loader (src/engine/docs-asset.ts) accepts it, and `build:engine --check`
// fails when it is missing or stale. Opt-in with ENGINE_DOCS=1 (CI's engine job); a missing engine
// then fails instead of skipping.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../engine/golden/run-wasm.mjs';
import { createEngineDocsLoader } from '../../src/engine/docs-asset';
import { REPO } from '../golden/corpus';

const ON = process.env['ENGINE_DOCS'] === '1';
const DIR = path.join(REPO, 'public/engine');
const run = promisify(execFile);

interface Ref {
	path: string;
	sha256: string;
	bytes: number;
	rawBytes: number;
}

function docsRef(): Ref {
	const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as {
		docs?: Ref;
	};
	if (!manifest.docs) throw new Error('manifest.json names no docs asset');
	return manifest.docs;
}

/** `build:engine --check` against `out`: its exit code and what it printed. */
async function check(out: string): Promise<{ code: number; output: string }> {
	try {
		const r = await run(process.execPath, ['engine/build-bundle.mjs', '--check', '--out', out], {
			cwd: REPO,
			maxBuffer: 16 * 2 ** 20,
		});
		return { code: 0, output: r.stdout + r.stderr };
	} catch (error) {
		const e = error as { code?: number; stdout?: string; stderr?: string };
		return { code: e.code ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
}

describe.skipIf(!ON)('the keyword docs asset of the built engine', () => {
	it('equals syntax() of the engine beside it, and its hashes match its bytes', async () => {
		expect(fs.existsSync(path.join(DIR, 'manifest.json')), 'run npm run build:engine').toBe(true);
		const ref = docsRef();
		const gz = fs.readFileSync(path.join(DIR, ref.path));
		const raw = gunzipSync(gz);
		const sha = createHash('sha256').update(raw).digest('hex');
		expect(ref.sha256).toBe(sha);
		expect(ref.path).toBe(`tj-docs.${sha.slice(0, 12)}.json.gz`);
		expect(ref.bytes).toBe(gz.length);
		expect(ref.rawBytes).toBe(raw.length);

		const engine = await bootNodeEngine({ log: () => {} });
		const syntax = engine.syntax();
		expect(JSON.parse(raw.toString('utf8'))).toEqual(syntax);

		// What the app gets through its loader, from these files.
		const fetch = (async (input: RequestInfo | URL) => {
			const name = path.basename(new URL(String(input)).pathname);
			return new Response(fs.readFileSync(path.join(DIR, name)));
		}) as typeof globalThis.fetch;
		const loader = createEngineDocsLoader({
			manifestUrl: new URL('https://example.test/engine/manifest.json'),
			fetch,
		});
		expect(await loader.load()).toEqual(syntax);
	}, 120_000);

	it('makes build:engine --check fail when it is missing or stale', async () => {
		const ref = docsRef();
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-docs-check-'));
		try {
			for (const name of fs.readdirSync(DIR)) fs.copyFileSync(path.join(DIR, name), path.join(tmp, name));
			const ok = await check(tmp);
			expect(ok.code, ok.output).toBe(0);

			fs.rmSync(path.join(tmp, ref.path));
			const missing = await check(tmp);
			expect(missing.code).toBe(1);
			expect(missing.output).toContain(`${ref.path}: missing`);

			// An earlier build's docs beside this build's, and this build's name with other bytes.
			fs.copyFileSync(path.join(DIR, ref.path), path.join(tmp, 'tj-docs.000000000000.json.gz'));
			fs.writeFileSync(path.join(tmp, ref.path), gunzipSync(fs.readFileSync(path.join(DIR, ref.path))));
			const stale = await check(tmp);
			expect(stale.code).toBe(1);
			expect(stale.output).toContain('tj-docs.000000000000.json.gz: stale, not produced by this build');
			expect(stale.output).toContain(`${ref.path}: differs`);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	}, 600_000);
});
