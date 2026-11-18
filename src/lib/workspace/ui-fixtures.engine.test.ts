// SPDX-License-Identifier: GPL-2.0-or-later
// The small plans for the interface specs (tests/fixtures/ui, ADR-0016 change 4) schedule cleanly
// in the wasm engine, booted in Node by engine/golden/run-wasm.mjs: no error, no warning, every
// task scheduled, and the size the recipe promises (10 to 30 tasks, 3 to 5 people). They have no
// native goldens, so this is their only engine check. Needs the built engine (npm run build:engine);
// skipped without it unless UI_FIXTURES_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import { SAMPLES } from './samples';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['UI_FIXTURES_ENGINE'] === '1';
const UI = SAMPLES.filter((s) => s.id.startsWith('ui-'));

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('UI fixtures in the engine', () => {
	it('registers the three variants', () => {
		expect(UI.map((s) => s.id)).toEqual(['ui-basic', 'ui-people', 'ui-multifile']);
	});

	it.each(UI.map((s) => [s.id, s] as const))(
		'%s schedules with no error and no warning',
		async (_id, s) => {
			const engine = await bootNodeEngine({ log: () => {} });
			const { entry, files } = await s.load();
			const r = engine.schedule({ files, entry, revision: 1, options: {} });
			const problems = r.messages
				.filter((m) => m.level !== 'info' && m.level !== 'debug')
				.map((m) => `${m.level}:${m.id} ${m.file ?? ''}:${m.line ?? ''} ${m.text}`);
			expect(problems).toEqual([]);
			expect(r.ok).toBe(true);
			for (const t of r.tasks) {
				expect(t.scenarios['plan']?.scheduled, t.id).toBe(true);
			}
			expect(r.tasks.length).toBeGreaterThanOrEqual(10);
			expect(r.tasks.length).toBeLessThanOrEqual(30);
			const people = r.resources.filter((x) => !x.group);
			expect(people.length).toBeGreaterThanOrEqual(3);
			expect(people.length).toBeLessThanOrEqual(5);
		},
		120_000,
	);
});
