// SPDX-License-Identifier: GPL-2.0-or-later
// The Calendar's text-only leave on the wasm engine (facts.ts; T16 review), booted in Node by
// engine/golden/run-wasm.mjs: a person whose macro writes a sick leave and whose text writes an
// annual leave over one of its days. The engine keeps the stronger type (sick) on the shared day,
// no text item names it, so the day lists it as text only beside the annual leave. Needs the built
// engine (npm run build:engine); skipped without it unless TJP_EDIT_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import type { NodeEngine } from '../../engine/runtime';
import { planFrom, ZONES } from '../workload/rebalance-testing';
import { prepareFacts } from './facts';
import { buildGrid } from './grid';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';

const PLAN = [
	'project p "P" 2026-01-05 - 2026-03-02 {',
	'}',
	'macro lv [ leaves sick 2026-02-02 - 2026-02-04 ]',
	'resource dev "Dev" {',
	'  ${lv}',
	'  leaves annual "Trip2" 2026-02-03',
	'}',
	'task t "T" {',
	'  effort 3d',
	'  allocate dev',
	'}',
	'',
].join('\n');

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))(
	'text-only leave on the engine',
	{ timeout: 120_000 },
	() => {
		let engine: NodeEngine;
		beforeAll(async () => {
			engine = await bootNodeEngine({ log: () => {} });
		}, 60_000);

		it('lists the macro’s sick leave beside the text annual leave on the shared day', () => {
			const result = engine.schedule({
				files: { 'plan.tjp': PLAN },
				entry: 'plan.tjp',
				revision: 1,
				options: {},
			});
			expect(result.ok).toBe(true);
			const p = planFrom({ 'plan.tjp': PLAN }, 'plan.tjp', result);
			const grid = buildGrid(result.project, ZONES);
			const of = prepareFacts({
				result,
				index: p.index,
				scope: { kind: 'resource', resource: 'dev' },
				grid,
			});
			const day = (d: number): number =>
				grid.days.findIndex((x) => x.year === 2026 && x.month === 2 && x.date === d);
			const brief = (d: number) => of(day(d)).leaves.map((e) => [e.type, e.name, e.item !== null]);
			// The macro covers the 2nd and the 3rd (the end is exclusive); the text annual the 3rd.
			expect(brief(2)).toEqual([['sick', null, false]]);
			expect(brief(3)).toEqual([
				['annual', 'Trip2', true],
				['sick', null, false],
			]);
			expect(of(day(3)).textOnly).toBe(true);
			expect(brief(4)).toEqual([]);
		});
	},
);
