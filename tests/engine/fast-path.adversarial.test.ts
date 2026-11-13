// SPDX-License-Identifier: GPL-2.0-or-later
// The T19 review's repros of the fast path (ADR-0010), as tests: patches that ran fast and differed
// from a full run before the bridge checked its own parse, and patches that must still run fast.
// Each keeps the plan (`retain`), rewrites the named lines, and compares the fast request with a
// full run of the same text: the result must be equal, by the expected path and, when it runs in
// full, for the expected reason. The edits are what a wrong or hostile main thread could send, so
// the bridge alone must catch them. Opt-in with FAST_PATH=1, like the other engine suites.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootNodeEngine } from '../../engine/golden/run-wasm.mjs';
import type { FastEdit, ScheduleRequest, ScheduleResult } from '../../src/engine/protocol';
import { REPO } from '../golden/corpus';
import { canonicalResult } from './fast-path-cases';

const ENGINE = path.join(REPO, 'public/engine/manifest.json');
const ON = process.env['FAST_PATH'] === '1';
const NOW = { now: '2026-01-05T09:00:00Z' };
const P = 'plan.tjp';

type Engine = { schedule(r: ScheduleRequest): ScheduleResult };
let engine: Engine;
let revision = 0;

interface Edit {
	file?: string;
	line: number;
	/** The whole new line. */
	text: string;
	task: string;
	attribute: FastEdit['attribute'];
	value: string;
}

/** Keeps `files`, rewrites the lines, runs fast and in full; returns both. */
function compare(files: Record<string, string>, edits: Edit[], options: { now?: string } = NOW) {
	const base = engine.schedule({ files, entry: P, options, retain: true, revision: ++revision });
	const next = { ...files };
	for (const e of edits) {
		const f = e.file ?? P;
		const lines = (next[f] ?? '').split('\n');
		lines[e.line - 1] = e.text;
		next[f] = lines.join('\n');
	}
	const fastEdits: FastEdit[] = edits.map((e) => ({
		task: e.task,
		attribute: e.attribute,
		scenario: null,
		value: e.value,
		file: e.file ?? P,
		line: e.line,
	}));
	const fast = engine.schedule({ files: next, entry: P, options, revision: ++revision, fast: { base: base.revision, edits: fastEdits } });
	const full = engine.schedule({ files: next, entry: P, options, revision: ++revision });
	return { fast, full };
}

const E = (line: number, text: string, task: string, attribute: FastEdit['attribute'], value: string, file?: string): Edit => ({
	line,
	text,
	task,
	attribute,
	value,
	...(file ? { file } : {}),
});

interface Case {
	name: string;
	files: Record<string, string>;
	edits: Edit[];
	/** null: must run fast. */
	reason: RegExp | null;
	options?: { now?: string };
}

const SCENARIOS = 'project p "P" 2026-01-05 +3m {\n  scenario plan "Plan" {\n    scenario test "Test"\n  }\n}\nresource r "R"\n';
const LATE = 'project p "P" 2026-01-05 +3m {\n  scenario plan "Plan" { scenario late "Late" }\n}\nresource r "R"\n';
const PLAIN = 'project p "P" 2026-01-05 +3m\nresource r "R"\n';

const cases: Case[] = [
	// H1: start and end set the direction in every derived scenario too.
	{
		name: 'start, then test:end (the test scenario stays ALAP)',
		files: { [P]: `${SCENARIOS}task t "T" {\n  start 2026-01-06\n  effort 5d\n  allocate r\n  test:end 2026-02-20\n}\n` },
		edits: [E(8, '  start 2026-01-08', 't', 'start', '2026-01-08')],
		reason: /direction/,
	},
	{
		name: 'start, then test:scheduling alap',
		files: { [P]: `${SCENARIOS}task m "M" { start 2026-02-20 }\ntask t "T" {\n  start 2026-01-06\n  effort 5d\n  allocate r\n  test:scheduling alap\n  test:precedes m\n}\n` },
		edits: [E(9, '  start 2026-01-08', 't', 'start', '2026-01-08')],
		reason: /direction/,
	},
	{
		name: 'end, then test:start',
		files: { [P]: `${SCENARIOS}task t "T" {\n  end 2026-02-20\n  effort 5d\n  allocate r\n  test:start 2026-01-06\n}\n` },
		edits: [E(8, '  end 2026-02-18', 't', 'end', '2026-02-18')],
		reason: /direction/,
	},
	{
		name: 'end, then late:depends (the late scenario becomes ASAP)',
		files: { [P]: `${LATE}task a "A" {\n  effort 4d\n  allocate r\n}\ntask t "T" {\n  end 2026-02-20\n  effort 3d\n  allocate r\n  late:depends a\n}\n` },
		edits: [E(10, '  end 2026-02-18', 't', 'end', '2026-02-18')],
		reason: /direction/,
	},
	// M1: the bridge checks the line against its own parse.
	{
		name: 'a start written twice: the first one',
		files: { [P]: `${PLAIN}task t "T" {\n  start 2026-01-06\n  effort 5d\n  allocate r\n  start 2026-01-12\n}\n` },
		edits: [E(4, '  start 2026-01-08', 't', 'start', '2026-01-08')],
		reason: /later statement/,
	},
	{
		name: 'a line inside a block comment',
		files: { [P]: `${PLAIN}task t "T" {\n  effort 5d\n  /*\n  effort 9d\n  */\n  allocate r\n}\n` },
		edits: [E(6, '  effort 2d', 't', 'effort', '2d')],
		reason: /not one statement/,
	},
	{
		name: 'a line in a macro body used by two tasks',
		files: { [P]: `${PLAIN}macro std [\n  effort 5d\n]\ntask a "A" {\n  \${std}\n  allocate r\n}\ntask b "B" {\n  \${std}\n  allocate r\n}\n` },
		edits: [E(4, '  effort 2d', 'a', 'effort', '2d')],
		reason: /not one statement/,
	},
	{
		name: 'an edit that names the wrong task',
		files: { [P]: `${PLAIN}task a "A" {\n  effort 5d\n  allocate r\n}\ntask b "B" {\n  effort 4d\n  allocate r\n}\n` },
		edits: [E(8, '  effort 2d', 'a', 'effort', '2d')],
		reason: /not one statement/,
	},
	{
		name: 'a value that carries more statements',
		files: { [P]: `${PLAIN}task a "A" {\n  effort 5d\n  allocate r\n}\n` },
		edits: [E(4, '  effort 2d } task x "X" { effort 1d', 'a', 'effort', '2d } task x "X" { effort 1d')],
		reason: /not a value of effort/,
	},
	{
		name: 'a report start line labelled as a task',
		files: { [P]: `${PLAIN}task a "A" {\n  start 2026-01-06\n  effort 5d\n  allocate r\n}\ntaskreport rep "rep" {\n  start 2026-01-06\n}\n` },
		edits: [E(9, '  start 2026-01-09', 'a', 'start', '2026-01-09')],
		reason: /not one statement/,
	},
	{
		name: 'one file included twice with two task prefixes',
		files: {
			[P]: `${PLAIN}task a "A" {\n}\ntask b "B" {\n}\ninclude "common.tji" { taskprefix a }\ninclude "common.tji" { taskprefix b }\n`,
			'common.tji': 'task w "W" {\n  effort 3d\n  allocate r\n}\n',
		},
		edits: [E(2, '  effort 7d', 'a.w', 'effort', '7d', 'common.tji')],
		reason: /not one statement/,
	},
	// Still fast, and equal.
	{
		name: 'a rewrite in an included file with a task prefix, in a project zone',
		files: {
			[P]: 'project p "P" 2026-01-05 +3m {\n  timezone "America/New_York"\n}\nresource r "R"\ntask g "G" {\n  task x0 "X0" { length 1d }\n}\ninclude "sub/part.tji" { taskprefix g }\n',
			'sub/part.tji': 'task x "X" {\n  effort 4d\n  allocate r\n  start 2026-01-07-10:00\n}\n',
		},
		edits: [E(4, '  start 2026-01-08-15:00', 'g.x', 'start', '2026-01-08-15:00', 'sub/part.tji')],
		reason: null,
	},
	{
		name: 'a start on a container (children do not copy start)',
		files: { [P]: `${PLAIN}task p "Parent" {\n  start 2026-01-06\n  task c1 "C1" {\n    effort 4d\n    allocate r\n  }\n}\n` },
		edits: [E(4, '  start 2026-01-12', 'p', 'start', '2026-01-12')],
		reason: null,
	},
	{
		name: 'an end after scheduling alap',
		files: { [P]: `${PLAIN}task t "T" {\n  scheduling alap\n  end 2026-02-25\n  effort 2d\n  allocate r\n}\n` },
		edits: [E(5, '  end 2026-02-18', 't', 'end', '2026-02-18')],
		reason: null,
	},
	{
		name: 'a plan reading the clock (no now anywhere)',
		files: { [P]: `${PLAIN}task a "A" {\n  effort 10d\n  allocate r\n}\n` },
		edits: [E(4, '  effort 12d', 'a', 'effort', '12d')],
		reason: null,
		options: {},
	},
];

describe.skipIf(!ON || !fs.existsSync(ENGINE))('fast path: the review repros', () => {
	beforeAll(async () => {
		engine = (await bootNodeEngine({ log: () => {} })) as unknown as Engine;
	}, 300_000);

	for (const c of cases) {
		it(`${c.name}: ${c.reason ? 'runs in full' : 'fast'}, same result`, () => {
			const { fast, full } = compare(c.files, c.edits, c.options);
			expect(fast.timings.path, fast.timings.fastFallback).toBe(c.reason ? 'full' : 'fast');
			if (c.reason) expect(fast.timings.fastFallback).toMatch(c.reason);
			if (full.project?.now === fast.project?.now) {
				expect(canonicalResult(fast)).toBe(canonicalResult(full));
			}
		}, 120_000);
	}
});
