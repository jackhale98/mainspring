// SPDX-License-Identifier: GPL-2.0-or-later
// The schedule runner against the real engine (phase-1.md 6.8): the wasm bundle booted in Node
// (engine/golden/run-wasm.mjs) behind the real engine client, through an in-process WorkerLike
// (testing/node-worker.ts). On golden plans: the first run matches the golden, an edit typed in
// the workspace is scheduled after the debounce and moves the finish date, an error shows as an
// engine diagnostic on its line while the last good run stays, and Fedora's macro ids resolve
// through engine hints. Prints the Fedora timings. Needs the built engine (npm run
// build:engine); skipped without it, except with SCHEDULE_RUNNER_ENGINE=1 (the CI engine job),
// where a missing engine fails.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	bootNodeEngine,
	compareWithGolden,
	loadCorpus,
	planRequest,
} from '../../../engine/golden/run-wasm.mjs';
import { ROOT } from '../../../tests/grammar/corpus';
import { createEngineClient, type EngineClient } from '../../engine/client';
import type { EngineLike } from '../../engine/dispatch';
import type { ScheduleResult } from '../../engine/protocol';
import { finishMinutes } from '../schedule/finish';
import { createScheduleRunner, type RunnerState, type ScheduleRunner } from './schedule-runner';
import { NodeWorker } from './testing/node-worker';
import { createWorkspace, type Workspace } from './workspace';

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['SCHEDULE_RUNNER_ENGINE'] === '1';

interface Golden {
	entry: string;
	files: string[];
	options: { now: string | null };
	result: ScheduleResult;
}

function seed(id: string): { entry: string; files: Record<string, string>; golden: Golden } {
	const corpus = loadCorpus([id]) as Array<{ plan: { id: string; root: string }; golden: Golden }>;
	const c = corpus[0];
	if (!c) throw new Error(`no golden ${id}`);
	const request = planRequest(c.plan, c.golden, 1) as { files: Record<string, string> };
	return { entry: c.golden.entry, files: request.files, golden: c.golden };
}

/** The first state (the current one included) that satisfies `ok`. */
function waitFor(
	runner: ScheduleRunner,
	ok: (s: RunnerState) => boolean,
	ms = 60_000,
): Promise<RunnerState> {
	return new Promise((resolve, reject) => {
		let done = false;
		let off: (() => void) | null = null;
		const timer = setTimeout(() => {
			done = true;
			off?.();
			reject(new Error(`no matching runner state within ${ms} ms (${runner.state.status})`));
		}, ms);
		off = runner.subscribe((s) => {
			if (done || !ok(s)) return;
			done = true;
			clearTimeout(timer);
			queueMicrotask(() => off?.());
			resolve(s);
		});
		if (done) off();
	});
}

/** Replaces the first `find` in `path` as typing. */
function typeOver(ws: Workspace, path: string, find: string, insert: string): number {
	const state = ws.state(path);
	const from = state.doc.toString().indexOf(find);
	if (from < 0) throw new Error(`${find} not in ${path}`);
	ws.commit(path, state.update({ changes: { from, to: from + find.length, insert } }), 'typing');
	return state.doc.lineAt(from).number;
}

const settled = (after: number) => (s: RunnerState) =>
	!s.pending && s.latest !== null && s.latest.revision > after;

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('schedule runner on the real engine', () => {
	let engine: EngineLike;
	const open: Array<{ runner: ScheduleRunner; client: EngineClient }> = [];

	function start(ws: Workspace): ScheduleRunner {
		const client = createEngineClient({ transport: () => new NodeWorker(engine) });
		const runner = createScheduleRunner({ workspace: ws, client, debounceMs: 30 });
		open.push({ runner, client });
		return runner;
	}

	beforeAll(async () => {
		engine = await bootNodeEngine({ log: () => {} });
	}, 120_000);

	afterAll(() => {
		for (const { runner, client } of open) {
			runner.dispose();
			client.dispose();
		}
	});

	it('schedules Tutorial, then edits, errors and recovers', async () => {
		const { entry, files, golden } = seed('upstream-tutorial');
		const ws = createWorkspace({ entry, files });
		const runner = start(ws);
		const first = await waitFor(runner, settled(0));
		expect(first.status).toBe('ok');
		expect(compareWithGolden(golden, { ...(first.latest?.result ?? {}) })).toEqual([]);
		expect(first.finish?.minutes).toBe(finishMinutes(golden.result));
		expect(first.finish?.timezone).toBe('Europe/Paris');

		// A longer beta test moves the delivery, and so the finish, later.
		typeOver(ws, entry, 'effort 4w', 'effort 8w');
		expect(runner.state.pending).toBe(true);
		const longer = await waitFor(runner, settled(first.latest?.revision ?? 0));
		expect(longer.status).toBe('ok');
		expect(longer.latest?.workspaceVersion).toBe(1);
		expect(longer.finish?.delta).toBeGreaterThan(0);
		expect(longer.finish?.minutes).toBe((first.finish?.minutes ?? 0) + (longer.finish?.delta ?? 0));

		// An unknown dependency: an engine error on its line; the last good run stays.
		const line = typeOver(ws, entry, 'depends !alpha', 'depends !nosuch');
		const broken = await waitFor(runner, settled(longer.latest?.revision ?? 0));
		expect(broken).toMatchObject({ status: 'errors', outdated: true });
		expect(broken.latest?.result.ok).toBe(false);
		expect(broken.lastGood).toBe(longer.lastGood);
		expect(broken.finish).toBe(longer.finish);
		const engineErrors = broken.diagnostics.filter(
			(d) => d.source === 'engine' && d.severity === 'error',
		);
		expect(engineErrors.map((d) => [d.line, d.stale])).toEqual([[line, false]]);
		expect(broken.counts.errors).toBeGreaterThanOrEqual(1);

		typeOver(ws, entry, 'depends !nosuch', 'depends !alpha');
		const fixed = await waitFor(runner, settled(broken.latest?.revision ?? 0));
		expect(fixed).toMatchObject({ status: 'ok', outdated: false, failure: null });
		expect(fixed.finish?.minutes).toBe(longer.finish?.minutes);
		expect(fixed.finish?.delta).toBe(0);
	}, 120_000);

	it('resolves Fedora macro ids through engine hints and keeps them through an edit', async () => {
		const { entry, files } = seed('upstream-fedora-20');
		const ws = createWorkspace({ entry, files });
		const runner = start(ws);
		const first = await waitFor(runner, settled(0), 120_000);
		const result = first.latest?.result;
		if (!result) throw new Error('no result');
		expect(first.index.tasks.size).toBe(result.tasks.length);
		expect([...first.index.tasks.keys()]).toEqual(result.tasks.map((t) => t.id));
		const fromEngine = [...first.index.tasks.values()].filter((t) => t.idSource === 'engine');
		expect(fromEngine.length).toBeGreaterThan(0);
		const shown = result.messages.filter((m) => m.level !== 'debug').length;
		expect(first.diagnostics.filter((d) => d.source === 'engine')).toHaveLength(shown);
		expect(first.finish?.minutes).toBe(finishMinutes(result));

		// A comment line typed at the top shifts every hint; none is lost.
		const state = ws.state(entry);
		ws.commit(entry, state.update({ changes: { from: 0, insert: '# edited\n' } }), 'typing');
		expect(runner.state.index.tasks.size).toBe(result.tasks.length);
		expect(
			[...runner.state.index.tasks.values()].filter((t) => t.idSource === 'engine'),
		).toHaveLength(fromEngine.length);
		const second = await waitFor(runner, settled(first.latest?.revision ?? 0), 120_000);
		expect(second.index.tasks.size).toBe(result.tasks.length);
		expect(second.finish?.minutes).toBe(first.finish?.minutes);
		for (const [label, s] of [
			['first run', first],
			['after a one-line edit', second],
		] as const) {
			const t = s.timings;
			console.info(
				`runner on Fedora 20, ${label}: engine total ${t?.engine.totalMs} ms (parse ${t?.engine.parseMs}, schedule ${t?.engine.scheduleMs}), round trip ${t?.roundTripMs.toFixed(0)} ms, processing ${t?.processMs.toFixed(1)} ms`,
			);
		}
	}, 240_000);
});
