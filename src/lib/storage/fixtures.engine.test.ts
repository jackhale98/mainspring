// SPDX-License-Identifier: GPL-2.0-or-later
// The storage fixtures (tests/fixtures/storage, phase-4.md 13.1) keep the bytes they are for, read
// through the import path, and schedule with no error in the wasm engine (booted in Node by
// engine/golden/run-wasm.mjs). The engine part needs the built engine (npm run build:engine) and is
// skipped without it unless STORAGE_FIXTURES_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import { readImport, type ImportFile } from './import';

const DIR = path.join(ROOT, 'tests/fixtures/storage');
const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['STORAGE_FIXTURES_ENGINE'] === '1';

/** Every file of a fixture folder as a folder import gives it (`webkitRelativePath`). */
function folderFiles(name: string): ImportFile[] {
	const out: ImportFile[] = [];
	const walk = (rel: string): void => {
		for (const e of fs.readdirSync(path.join(DIR, rel), { withFileTypes: true })) {
			const p = `${rel}/${e.name}`;
			if (e.isDirectory()) walk(p);
			else {
				const bytes = fs.readFileSync(path.join(DIR, p));
				out.push({
					name: e.name,
					webkitRelativePath: p,
					size: bytes.length,
					arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer),
				});
			}
		}
	};
	walk(name);
	return out;
}

const raw = (p: string): Buffer => fs.readFileSync(path.join(DIR, p));

describe('storage fixtures', () => {
	it('keep their bytes: a BOM and CRLF, a byte that is not UTF-8', () => {
		const crlf = raw('bom-crlf/plan.tjp');
		expect([...crlf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		expect(
			crlf
				.toString('latin1')
				.split('\n')
				.slice(0, -1)
				.every((l) => l.endsWith('\r')),
		).toBe(true);
		expect(raw('invalid-utf8/notes.tji').includes(0xe9)).toBe(true);
	});

	it('import with their paths, lossy where the bytes are not UTF-8', async () => {
		const nested = await readImport(folderFiles('nested'));
		expect(nested.kind === 'plan' && [...nested.plan.files.keys()].sort()).toEqual([
			'people/team.tji',
			'plan.tjp',
			'work/phase1/tasks.tji',
		]);
		const lossy = await readImport(folderFiles('invalid-utf8'));
		expect(lossy.kind === 'plan' && [...lossy.plan.lossy]).toEqual(['notes.tji']);
		const several = await readImport(folderFiles('several'));
		expect(several.kind === 'plan' && several.plan.plans).toEqual(['alpha.tjp', 'beta.tjp']);
	});

	describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('in the engine', () => {
		it.each(['bom-crlf', 'invalid-utf8', 'nested', 'several'])(
			'%s schedules with no error',
			async (name) => {
				const r = await readImport(folderFiles(name));
				if (r.kind !== 'plan') throw new Error(r.kind);
				const engine = await bootNodeEngine({ log: () => {} });
				for (const entry of r.plan.plans) {
					const s = engine.schedule({
						files: Object.fromEntries(r.plan.files),
						entry,
						revision: 1,
						options: {},
					});
					const errors = s.messages
						.filter((m) => m.level === 'error' || m.level === 'fatal')
						.map((m) => `${m.id} ${m.file ?? ''}:${m.line ?? ''} ${m.text}`);
					expect(errors, entry).toEqual([]);
					expect(s.ok, entry).toBe(true);
				}
			},
			120_000,
		);
	});
});
