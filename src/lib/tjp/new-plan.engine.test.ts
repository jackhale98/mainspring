// SPDX-License-Identifier: GPL-2.0-or-later
// A new plan on the real engine (wasm, booted in Node): the header alone is `no_tasks` and not
// ok (the app shows it as an empty plan, phase-3.md 9.8), and the plan with its first task, as
// Add task writes it, schedules, with and without a time zone. Needs the built engine
// (npm run build:engine); skipped without it unless EDIT_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import { createTimeZoneHost } from '../../engine/runtime';
import { createWorkspace } from '../workspace/workspace';
import { applyIntent } from './edit/apply';
import { textsAfter } from './edit/testing';
import { buildIndex } from './index';
import { newPlanText } from './new-plan';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['EDIT_ENGINE'] === '1';
const zones = createTimeZoneHost();

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('a new plan on the engine', () => {
	it.each(['Europe/Berlin', null])(
		'is empty, then schedules its first task (zone %s)',
		async (zone) => {
			const engine = await bootNodeEngine({ log: () => {} });
			const { entry, files } = newPlanText({
				name: 'Website',
				start: '2026-11-16',
				timezone: zone,
			});
			const empty = engine.schedule({ files, entry, revision: 1, options: {} });
			expect(empty.ok).toBe(false);
			expect(empty.messages.map((m) => m.id)).toEqual(['no_tasks']);
			expect(empty.tasks).toEqual([]);

			// The first task, written by the edit API as the + control does.
			const snap = createWorkspace({ entry, files }).snapshot();
			const index = buildIndex(snap, undefined, { cache: null, zones });
			const added = applyIntent(snap, index, {
				type: 'addTask',
				parent: null,
				index: 0,
				name: 'New task',
			});
			if (added.status !== 'edit') throw new Error(JSON.stringify(added));
			const res = engine.schedule({
				files: textsAfter(snap, added),
				entry,
				revision: 2,
				options: {},
			});
			expect(res.messages.filter((m) => m.level === 'error' || m.level === 'fatal')).toEqual([]);
			expect(res.ok).toBe(true);
			expect(res.tasks.map((t) => t.id)).toEqual(['new_task']);
		},
		60_000,
	);
});
