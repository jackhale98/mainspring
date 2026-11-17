// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The engine side of the health tests (health.engine.test.ts): a plan's files scheduled on the
 * wasm engine booted in Node (engine/golden/run-wasm.mjs), indexed with its engine hints as the
 * app does, checked, and edited through the edit API. Node only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootNodeEngine } from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import type { ScheduleRequest, ScheduleResult } from '../../engine/protocol';
import { contextOf, zones } from '../schedule/explain-testing';
import { applyIntent } from '../tjp/edit/apply';
import { textsAfter } from '../tjp/edit/testing';
import type { EditIntent, EditResult } from '../tjp/edit/types';
import { buildIndex, hintsFromResult, type SymbolIndex } from '../tjp/index';
import { createWorkspace, type WorkspaceSnapshot } from '../workspace/workspace';
import { checkPlan } from './report';
import { inputOf } from './testing';
import { DEFAULT_HEALTH_SETTINGS, type HealthReport, type HealthSettings } from './types';

export const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
export type Files = Record<string, string>;

let engine: Awaited<ReturnType<typeof bootNodeEngine>> | null = null;
let revision = 0;

/** A health fixture's files (tests/fixtures/health/<dir>/<side>). */
export function fixtureFiles(dir: string, side: 'pass' | 'fail'): Files {
	const file = path.join(ROOT, 'tests/fixtures/health', dir, side, 'plan.tjp');
	return { 'plan.tjp': fs.readFileSync(file, 'utf8') };
}

export interface Checked {
	readonly files: Files;
	readonly result: ScheduleResult;
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
	readonly report: HealthReport;
}

/** Schedules the files on the engine and checks the result. */
export async function check(
	files: Files,
	settings: HealthSettings = DEFAULT_HEALTH_SETTINGS,
	request: { entry?: string; options?: ScheduleRequest['options'] } = {},
): Promise<Checked> {
	engine ??= await bootNodeEngine({ log: () => {} });
	const entry = request.entry ?? 'plan.tjp';
	const result: ScheduleResult = engine.schedule({
		files,
		entry,
		revision: ++revision,
		options: request.options ?? {},
	});
	const snap = createWorkspace({ entry, files }).snapshot();
	const lines = (f: string): string[] => snap.files.get(f)?.text.toString().split('\n') ?? [];
	const hints = hintsFromResult(
		result,
		(_f, l) => l,
		(f, l) => lines(f)[l - 1] ?? null,
	);
	const index = buildIndex(snap, hints, { cache: null, zones });
	const report = checkPlan(inputOf(contextOf(result, index), settings));
	return { files, result, snap, index, report };
}

/** The files after `intent`; throws when the edit API gives no edit. */
export function edit(c: Pick<Checked, 'snap' | 'index'>, intent: EditIntent): Files {
	const r: EditResult = applyIntent(c.snap, c.index, intent);
	return textsAfter(c.snap, r);
}

/** Error and fatal message ids of a result, sorted. */
export const errorIds = (r: ScheduleResult): string[] =>
	r.messages
		.filter((m) => m.level === 'error' || m.level === 'fatal')
		.map((m) => `${m.level}:${m.id}`)
		.sort();
