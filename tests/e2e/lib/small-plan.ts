// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The oracle of the specs that run on a small plan (ADR-0016 change 4): the plans of tests/fixtures
 * have no native goldens, so what a view must show is computed here, in the spec's own Node process,
 * by the same engine build the page runs (the wasm engine booted in Node, once per worker) and the
 * unit oracles of src/lib (`checkPlan`, `explainTask`) over its result. A spec on `fedora-res` uses
 * the committed golden for that; these specs check that the view says what the oracle says, and the
 * golden parity job checks the engine itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import type { ScheduleResult } from '../../../src/engine/protocol';
import { inputOf } from '../../../src/lib/health/testing';
import { checkPlan } from '../../../src/lib/health/report';
import type { HealthReport, HealthSettings } from '../../../src/lib/health/types';
import { contextOf, zones } from '../../../src/lib/schedule/explain-testing';
import type { ExplainContext } from '../../../src/lib/schedule/explain-types';
import { buildIndex, hintsFromResult } from '../../../src/lib/tjp/index';
import { inline } from '../../../src/lib/tjp/index/testing';
import { REPO } from '../../golden/corpus';

/** A sample id of the small plans, and the folder of its files. */
export const SMALL_ROOTS = {
	'ui-basic': 'tests/fixtures/ui/basic',
	'ui-people': 'tests/fixtures/ui/people',
	'ui-multifile': 'tests/fixtures/ui/multifile',
	'gantt-manipulation': 'tests/fixtures/gantt/manipulation',
} as const;
export type SmallPlan = keyof typeof SMALL_ROOTS;

function filesOf(root: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (dir: string): void => {
		for (const e of fs.readdirSync(path.join(REPO, root, dir), { withFileTypes: true })) {
			const rel = dir === '' ? e.name : `${dir}/${e.name}`;
			if (e.isDirectory()) walk(rel);
			else if (/\.tj[ip]$/.test(e.name))
				out[rel] = fs.readFileSync(path.join(REPO, root, rel), 'utf8');
		}
	};
	walk('');
	return out;
}

type Engine = Awaited<ReturnType<typeof bootNodeEngine>>;
let engine: Promise<Engine> | null = null;
let revision = 0;
const contexts = new Map<string, Promise<ExplainContext>>();

/** The explainer's context of plan files, scheduled by the engine run in this process (cached). */
export function contextOfFiles(files: Record<string, string>): Promise<ExplainContext> {
	const key = JSON.stringify(files);
	let c = contexts.get(key);
	if (!c) contexts.set(key, (c = schedule(files)));
	return c;
}

async function schedule(files: Record<string, string>): Promise<ExplainContext> {
	engine ??= bootNodeEngine({ log: () => {} });
	const result: ScheduleResult = (await engine).schedule({
		files,
		entry: 'plan.tjp',
		revision: ++revision,
		options: {},
	});
	if (!result.ok) throw new Error('the plan did not schedule');
	const index = buildIndex(
		inline(files).snapshot(),
		hintsFromResult(result, (_f, l) => l),
		{ cache: null, zones },
	);
	return contextOf(result, index);
}

/** The explainer's context of a small plan, from the engine run in this process. */
export function smallContext(plan: SmallPlan): Promise<ExplainContext> {
	return contextOfFiles(filesOf(SMALL_ROOTS[plan]));
}

/** The health report the panel must show for a small plan, with the settings. */
export async function smallReport(
	plan: SmallPlan,
	settings?: HealthSettings,
): Promise<HealthReport> {
	return checkPlan(inputOf(await smallContext(plan), settings));
}

/** The explainer's context of a plan typed into the editor (one file, `plan.tjp`). */
export const contextOfText = (text: string): Promise<ExplainContext> =>
	contextOfFiles({ 'plan.tjp': text });

/** The health report of a plan typed into the editor (one file, `plan.tjp`). */
export async function reportOfText(text: string, settings?: HealthSettings): Promise<HealthReport> {
	return checkPlan(inputOf(await contextOfFiles({ 'plan.tjp': text }), settings));
}
