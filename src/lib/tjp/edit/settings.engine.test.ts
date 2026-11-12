// SPDX-License-Identifier: GPL-2.0-or-later
// The resource, project, working-hours and leave intents on golden plans, scheduled by the wasm
// engine booted in Node (engine/golden/run-wasm.mjs; phase-1.md 9.3 P4).
// - Random intents (fast-check, fixed seed) on every golden plan that schedules (the two slowest
//   are left to the nightly fidelity job), indexed with the engine's time-zone data: each edit
//   must keep `ok` and add no new error or fatal message id, except errors that depend on the
//   computed schedule (or on opaque bookings, or the clock), each admitted only by a narrow
//   predicate for its id (settings-engine.ts `scheduleDependent`) and logged with its id;
//   `renameResource` must leave the schedule equal apart from names.
// - Effects, on fixed cases: a leave removes availability (the task it covers ends later, and
//   earlier again once the leave is removed); shorter working hours spread the effort (the task
//   ends later); a time zone shifts the instant of local dates as TaskJuggler reads them (Berlin
//   in May: 09:00 is 07:00Z); a deleted resource no longer books, a moved one keeps its
//   bookings.
// Needs the built engine (npm run build:engine); skipped without it unless EDIT_ENGINE=1.
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../../tests/grammar/corpus';
import type { ScheduleResult } from '../../../engine/protocol';
import { createTimeZoneHost } from '../../../engine/runtime';
import { buildIndex } from '../index';
import { applyIntent } from './apply';
import { linkCorpora, type LinkCorpus } from './links-testing';
import { newErrors, scheduleDependent, sameApartFromNames } from './settings-engine';
import { SETTING_TYPES, settingArb, usable } from './settings-testing';
import { textsAfter } from './testing';
import type { EditIntent } from './types';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['EDIT_ENGINE'] === '1';
const SLOW = new Set(['upstream-fedora-20', 'syn-20-scale-1000']);
const CASES = Number(process.env['SETTING_ENGINE_RUNS'] ?? 8);
const DRAWS = CASES * 20;
const SEED = Number(process.env['SETTING_ENGINE_SEED'] ?? 1112);

type Engine = Awaited<ReturnType<typeof bootNodeEngine>>;
let revision = 0;

const texts = (c: LinkCorpus): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const [p, f] of c.snap.files) out[p] = f.text.toString();
	return out;
};

function schedule(engine: Engine, c: LinkCorpus, files: Record<string, string>): ScheduleResult {
	return engine.schedule({ files, entry: c.snap.entry, revision: ++revision, options: {} });
}

/** Schedules the edit of `intent` on `c`; throws unless the intent gives an edit. */
function scheduleEdit(engine: Engine, c: LinkCorpus, intent: EditIntent): ScheduleResult {
	const r = applyIntent(c.snap, c.index, intent);
	if (r.status !== 'edit') throw new Error(`${JSON.stringify(intent)}: ${JSON.stringify(r)}`);
	return schedule(engine, c, textsAfter(c.snap, r));
}

const task = (r: ScheduleResult, id: string) => {
	const sc = r.project?.scenarios[0]?.id ?? 'plan';
	return r.tasks.find((t) => t.id === id)?.scenarios[sc] ?? null;
};

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('settings intents still schedule', () => {
	// With the engine's time-zone data, as the browser has it, so zone-dependent checks run.
	const zones = createTimeZoneHost();
	const corpora = linkCorpora()
		.filter((c) => c.golden !== null && !SLOW.has(c.golden))
		.map((c) => ({ ...c, index: buildIndex(c.snap, undefined, { zones }) }));
	const byId = (id: string): LinkCorpus => {
		const c = corpora.find((x) => x.golden === id);
		if (!c) throw new Error(`no golden ${id}`);
		return c;
	};

	it('keeps golden plans scheduling', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		const plans: Array<{ c: LinkCorpus; base: ScheduleResult }> = [];
		for (const c of corpora) {
			const base = schedule(engine, c, texts(c));
			if (base.ok) plans.push({ c, base });
		}
		expect(plans.length).toBeGreaterThan(20);
		const failures: string[] = [];
		const counts: Record<string, number> = {};
		const admitted: Record<string, number> = {};
		for (const type of SETTING_TYPES) {
			const pool = plans
				.map((_, i) => i)
				.filter((i) => usable((plans[i] as (typeof plans)[0]).c, type));
			const arb = fc
				.constantFrom(...pool)
				.chain((i) =>
					fc.tuple(fc.constant(i), settingArb((plans[i] as (typeof plans)[0]).c, type)),
				);
			for (const [i, intent] of fc.sample(arb, { numRuns: DRAWS, seed: SEED })) {
				if ((counts[type] ?? 0) >= CASES) break;
				const { c, base } = plans[i] as (typeof plans)[0];
				const r = applyIntent(c.snap, c.index, intent);
				if (r.status !== 'edit') continue;
				counts[type] = (counts[type] ?? 0) + 1;
				const label = `${c.golden} ${JSON.stringify(intent)}`;
				const res = schedule(engine, c, textsAfter(c.snap, r));
				const fresh = newErrors(base, res);
				const rest = fresh.filter((m) => !scheduleDependent(c, intent, m, fresh));
				for (const m of fresh.filter((x) => !rest.includes(x))) {
					admitted[m.id] = (admitted[m.id] ?? 0) + 1;
					console.log(`schedule-dependent ${m.id}: ${label}: ${m.text}`);
				}
				if (rest.length > 0 || (!res.ok && fresh.length === 0)) {
					failures.push(
						`${label}: ok ${res.ok}, new ${rest.map((m) => `${m.id} ${m.text}`).join('; ')}`,
					);
					continue;
				}
				if (intent.type === 'renameResource' && !sameApartFromNames(base, res))
					failures.push(`${label}: rename changed the schedule`);
			}
		}
		console.log(`edits per intent: ${JSON.stringify(counts)}`);
		console.log(`schedule-dependent errors admitted: ${JSON.stringify(admitted)}`);
		expect(failures).toEqual([]);
		for (const type of SETTING_TYPES) expect(counts[type] ?? 0, type).toBeGreaterThanOrEqual(3);
	}, 600_000);

	it('has the expected effects', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		// A leave removes availability: xan's annual leave on build's days pushes build later.
		const leaves = byId('syn-13-calendars-leaves');
		const base = schedule(engine, leaves, texts(leaves));
		const build = task(base, 'calendar.build');
		expect(build?.end).toBeTypeOf('number');
		const away = scheduleEdit(engine, leaves, {
			type: 'addLeave',
			scope: { kind: 'resource', resource: 'xan' },
			leave: { type: 'annual', start: '2026-02-09', end: '2026-02-14' },
		});
		expect(away.ok).toBe(true);
		expect(task(away, 'calendar.build')?.end ?? 0).toBeGreaterThan(build?.end ?? 0);
		const sick = leaves.index.leaves.find(
			(l) =>
				l.keyword === 'leaves' &&
				l.attr.parsed?.kind === 'leaves' &&
				l.attr.parsed.value[0]?.type === 'sick',
		);
		const back = scheduleEdit(engine, leaves, {
			type: 'removeLeave',
			leave: { item: sick?.items[0] ?? { file: '', from: 0, to: 0 } },
		});
		expect(back.ok).toBe(true);
		expect(task(back, 'calendar.build')?.end ?? 0).toBeLessThan(build?.end ?? 0);

		// Working hours spread the effort: ola at 2 h a day instead of 4 h takes longer for `first`.
		const hours = byId('syn-14-workinghours-resolution');
		const hb = schedule(engine, hours, texts(hours));
		const short = scheduleEdit(engine, hours, {
			type: 'setWorkingHours',
			scope: { kind: 'resource', resource: 'ola' },
			days: ['mon', 'tue', 'wed', 'thu', 'fri'],
			hours: [['9:00', '11:00']],
		});
		expect(short.ok).toBe(true);
		expect(task(short, 'hours.first')?.end ?? 0).toBeGreaterThan(task(hb, 'hours.first')?.end ?? 0);

		// A time zone shifts local dates: Berlin is UTC+2 in May, so 09:00 is 07:00Z.
		const utc = byId('syn-12-tz-unset');
		const ub = schedule(engine, utc, texts(utc));
		const berlin = scheduleEdit(engine, utc, {
			type: 'setProjectAttr',
			attr: 'timezone',
			value: '"Europe/Berlin"',
		});
		expect(berlin.ok).toBe(true);
		expect(berlin.project?.timezone).toBe('Europe/Berlin');
		expect(task(berlin, 'plain.kickoff')?.start).toBe(
			(task(ub, 'plain.kickoff')?.start ?? 0) - 120,
		);

		// A deleted resource books nothing; a moved one keeps its bookings.
		const del = scheduleEdit(engine, leaves, { type: 'deleteResource', resource: 'zed' });
		expect(del.ok).toBe(true);
		expect(del.bookings.some((b) => b.resource === 'zed')).toBe(false);
		expect(del.resources.some((r) => r.id === 'zed')).toBe(false);
		const moved = scheduleEdit(engine, leaves, {
			type: 'addResource',
			parent: null,
			index: 9,
			id: 'crew',
			name: 'Crew',
		});
		expect(moved.ok).toBe(true);
	}, 120_000);
});
