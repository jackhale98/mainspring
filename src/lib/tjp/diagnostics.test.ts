// SPDX-License-Identifier: GPL-2.0-or-later
// Engine messages of the golden results mapped to ranges (phase-1.md 6.6, T9), unlocated
// messages, severities, merging with local diagnostics.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EngineMessage, ScheduleResult } from '../../engine/protocol';
import { createTimeZoneHost } from '../../engine/runtime';
import { ROOT } from '../../../tests/grammar/corpus';
import type { WorkspaceSnapshot } from '../workspace/workspace';
import {
	engineDiagnostics,
	localDiagnostics,
	mergeDiagnostics,
	type TjpDiagnostic,
} from './diagnostics';
import { buildIndex } from './index';
import { golden, inline } from './index/testing';

const zones = createTimeZoneHost();

function goldenResult(id: string): ScheduleResult {
	const g = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${id}.json`), 'utf8'),
	) as { result: Omit<ScheduleResult, 'revision' | 'timings'> };
	return {
		...g.result,
		revision: 7,
		timings: { writeFsMs: 0, parseMs: 0, scheduleMs: 0, serializeMs: 0, totalMs: 0 },
	};
}

const textOf = (s: WorkspaceSnapshot, d: TjpDiagnostic): string =>
	d.file === null ? '' : (s.files.get(d.file)?.text.sliceString(d.from, d.to) ?? '');

/** For each golden message kind: the text its range must hold, its precision and its line. */
const EXPECTED: Record<string, { text: string; precision: string; line: number | null }> = {
	'bridge-header-only/no_tasks': { text: 'project hdr', precision: 'none', line: null },
	'bridge-include-subfolder/marco_redefinition': { text: 'owner', precision: 'token', line: 2 },
	'bridge-parse-failure/no_reduce': { text: 'colour', precision: 'token', line: 14 },
	'bridge-scenario-warning/maxend': { text: 'maxend 2026-03-13', precision: 'statement', line: 24 },
	'bridge-schedule-error/task_pred_before': { text: 'a', precision: 'token', line: 17 },
	'syn-04-limits-task-min-per-resource/maxend': {
		text: 'maxend 2026-01-09',
		precision: 'statement',
		line: 67,
	},
	'syn-16-constraints-violations/minstart': {
		text: 'minstart 2026-02-02',
		precision: 'statement',
		line: 25,
	},
	'syn-17-priority-efficiency/overbooked_effort': {
		text: 'effort 2d',
		precision: 'statement',
		line: 51,
	},
	'syn-19-errors-parse/no_reduce': { text: '@', precision: 'token', line: 6 },
	'syn-22-tz-kathmandu-resolution/too_large_timing_res': {
		text: '30min',
		precision: 'token',
		line: 9,
	},
	'upstream-fedora-20/attr_overwrite': {
		text: 'hidetask hidden | isleaf()',
		precision: 'statement',
		line: 91,
	},
};

const GOLDENS = fs
	.readdirSync(path.join(ROOT, 'engine/golden/expected'))
	.map((f) => f.replace(/\.json$/, ''))
	.filter((id) => goldenResult(id).messages.length > 0);

describe('engineDiagnostics on the golden results', () => {
	it('covers every golden message kind', () => {
		const kinds = GOLDENS.flatMap((id) => goldenResult(id).messages.map((m) => `${id}/${m.id}`));
		expect([...new Set(kinds)].sort()).toEqual(Object.keys(EXPECTED).sort());
	});

	for (const id of GOLDENS) {
		it(`maps each message of ${id} to the token or statement it is about`, () => {
			const s = golden(id).snapshot();
			const result = goldenResult(id);
			const ds = engineDiagnostics(result, s, buildIndex(s, undefined, { zones }));
			expect(ds).toHaveLength(result.messages.length);
			for (const [i, d] of ds.entries()) {
				const m = result.messages[i] as EngineMessage;
				const want = EXPECTED[`${id}/${m.id}`];
				expect(want).toBeDefined();
				expect(textOf(s, d)).toContain(want?.text);
				expect([d.precision, d.line]).toEqual([want?.precision, want?.line]);
				expect(d).toMatchObject({
					source: 'engine',
					messageId: m.id,
					message: m.text,
					scenario: m.scenario,
					revision: 7,
					stale: false,
				});
				expect(d.file).toBe(m.file ?? s.entry);
				if (d.line !== null) {
					const line = s.files.get(d.file ?? '')?.text.line(d.line);
					expect(d.column).toBe(d.from - (line?.from ?? 0) + 1);
				}
			}
		});
	}

	it('carries the scenario of a warning and maps severities', () => {
		const s = golden('bridge-scenario-warning').snapshot();
		const [d] = engineDiagnostics(goldenResult('bridge-scenario-warning'), s);
		expect(d).toMatchObject({ severity: 'warning', scenario: 'delayed' });
	});

	it('falls back to the statement without an index, or with one of another snapshot', () => {
		const ws = golden('syn-22-tz-kathmandu-resolution');
		const s = ws.snapshot();
		const stale = buildIndex(s, undefined, { zones });
		const state = ws.state('plan.tjp');
		ws.commit('plan.tjp', state.update({ changes: { from: 0, insert: '\n' } }), 'typing');
		const r = goldenResult('syn-22-tz-kathmandu-resolution');
		const moved = { ...r, messages: r.messages.map((m) => ({ ...m, line: 10 })) };
		for (const [sent, res, idx] of [
			[s, r, undefined],
			[ws.snapshot(), moved, stale],
		] as const) {
			const [d] = engineDiagnostics(res, sent, idx);
			expect(d?.precision).toBe('statement');
			expect(d && textOf(sent, d)).toBe('timingresolution 30min');
		}
	});
});

function message(over: Partial<EngineMessage>): EngineMessage {
	return {
		level: 'error',
		id: 'x',
		text: '',
		file: 'plan.tjp',
		line: 1,
		column: null,
		scenario: null,
		...over,
	};
}

function result(messages: EngineMessage[]): ScheduleResult {
	return { ...goldenResult('bridge-header-only'), messages, ok: false };
}

describe('unlocated and dropped messages', () => {
	const s = inline({
		'plan.tjp': '# head\nproject p "P" 2026-01-05 +1m {\n}\ntask a "A"\n',
	}).snapshot();

	it('puts messages without a workspace file or line on the entry header', () => {
		const ds = engineDiagnostics(
			result([
				message({ file: null, line: null }),
				message({ file: 'gone.tji', line: 3 }),
				message({ line: null }),
				message({ line: 0 }),
			]),
			s,
		);
		for (const d of ds) {
			expect(d).toMatchObject({ file: 'plan.tjp', precision: 'none', line: null, column: null });
			expect(textOf(s, d)).toBe('project p "P" 2026-01-05 +1m');
		}
	});

	it('drops debug messages and maps fatal to error', () => {
		const ds = engineDiagnostics(
			result([
				message({ level: 'debug' }),
				message({ level: 'fatal' }),
				message({ level: 'info' }),
			]),
			s,
		);
		expect(ds.map((d) => d.severity)).toEqual(['error', 'info']);
	});

	it('clamps a line past the end to the last line', () => {
		const [d] = engineDiagnostics(result([message({ line: 99 })]), s);
		expect(d?.precision).toBe('line');
		expect(d && textOf(s, d)).toBe('task a "A"');
	});

	it('uses offset 0 when the entry file has no project header', () => {
		const bare = inline({ 'plan.tjp': 'task a "A"\n' }).snapshot();
		const [d] = engineDiagnostics(result([message({ file: null, line: null })]), bare);
		expect(d && [d.from, d.to]).toEqual([0, 0]);
	});
});

describe('mergeDiagnostics', () => {
	it('keeps the engine message where a syntax error is at the same place', () => {
		const s = golden('bridge-parse-failure').snapshot();
		const engine = engineDiagnostics(goldenResult('bridge-parse-failure'), s);
		const local = localDiagnostics(s, buildIndex(s));
		expect(local.map((d) => [d.source, d.line])).toEqual([['syntax', 14]]);
		const merged = mergeDiagnostics(engine, local);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.source).toBe('engine');
	});

	it('keeps the engine message where a value check found the same error', () => {
		const s = golden('syn-22-tz-kathmandu-resolution').snapshot();
		const idx = buildIndex(s, undefined, { zones });
		const local = localDiagnostics(s, idx);
		expect(local.map((d) => [d.source, d.messageId])).toEqual([['value', 'too_large_timing_res']]);
		const engine = engineDiagnostics(goldenResult('syn-22-tz-kathmandu-resolution'), s);
		expect(engine[0]?.precision).toBe('statement');
		const merged = mergeDiagnostics(engine, local);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({ source: 'engine', precision: 'token' });
		expect(merged[0] && textOf(s, merged[0])).toBe('30min');
	});

	it('adds the did-you-mean hint to the engine message about the same token', () => {
		const s = inline({
			'plan.tjp':
				'project p "P" 2026-01-05 +1m\nresource r "R"\ntask a "A" {\n  Effort 2d\n  allocate r\n}\n',
		}).snapshot();
		const local = localDiagnostics(s, buildIndex(s));
		expect(local.map((d) => [d.messageId, d.hint])).toEqual([
			['attribute:undeclared', 'Did you mean effort?'],
		]);
		const engine = engineDiagnostics(
			result([
				message({
					id: 'no_reduce',
					line: 4,
					text: "Unexpected token 'Effort' found. Expecting one of 'adopt', '}'",
				}),
			]),
			s,
		);
		const merged = mergeDiagnostics(engine, local);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toMatchObject({ source: 'engine', hint: 'Did you mean effort?' });
		expect(merged[0] && textOf(s, merged[0])).toBe('Effort');
	});

	it('keeps local diagnostics elsewhere and sorts by file and position', () => {
		const s = inline({
			'plan.tjp': 'project p "P" 2026-01-05 +1m\ntask a "A" {\n  effort 2d\n}\n}\n',
		}).snapshot();
		const local = localDiagnostics(s);
		const engine = engineDiagnostics(result([message({ id: 'w', level: 'warning', line: 2 })]), s);
		expect(mergeDiagnostics(engine, local).map((d) => [d.source, d.line])).toEqual([
			['engine', 2],
			['syntax', 5],
		]);
	});

	// Messages below are the wasm engine's for these plans (the warning variant aside).
	const P = 'project p "P" 2026-01-05 +3m {\n}\nresource r "R"\n';
	const run = (text: string, messages: EngineMessage[]) => {
		const s = inline({ 'plan.tjp': text }).snapshot();
		const idx = buildIndex(s);
		const engine = engineDiagnostics(result(messages), s, idx);
		const merged = mergeDiagnostics(engine, localDiagnostics(s, idx));
		return {
			engine,
			s,
			merged: merged.map((d) => [d.source, d.messageId, textOf(s, d), d.hint]),
		};
	};

	it('keeps a local error on the line of an unrelated engine message', () => {
		const text = `${P}task a "A" { duration 1d }\ntask t "T" { depends a { gapduration 30min } priority 5000 duration 1d }\n`;
		const { merged } = run(text, [
			message({
				id: 'iv_duration_not_aligned',
				line: 5,
				text: 'The interval duration must be a multiple of the specified timing resolution (60min) of the project.',
			}),
		]);
		expect(merged).toEqual([
			['engine', 'iv_duration_not_aligned', '30min', null],
			['value', 'task_priority', '5000', null],
		]);
	});

	it('gives the did-you-mean hint to the parse error about the token, not its neighbour', () => {
		const text = `${P}task t "T" { start 2026-01-06 start 2026-01-07 Effort 1d }\n`;
		const { merged } = run(text, [
			message({
				level: 'warning',
				id: 'attr_overwrite',
				line: 4,
				text: 'Overwriting a previously provided value for attribute start',
			}),
			message({ id: 'no_reduce', line: 4, text: "Unexpected token 'Effort' found. Expecting '}'" }),
		]);
		expect(merged).toEqual([
			['engine', 'attr_overwrite', 'start 2026-01-07', null],
			['engine', 'no_reduce', 'Effort', 'Did you mean effort?'],
		]);
	});

	it('never merges into a stale or less severe engine entry', () => {
		const text = `${P}task t "T" {\n  priority 100\n  priority 200 complete 150\n}\n`;
		const warn = message({
			level: 'warning',
			id: 'task_complete',
			line: 6,
			text: 'Complete value must be between 0 and 100',
		});
		const fresh = run(text, [warn]);
		expect(fresh.merged.map((d) => d[0])).toEqual(['engine', 'value']);
		const err = { ...warn, level: 'error' as const };
		const { engine, s } = run(text, [err]);
		const stale = engine.map((d) => ({ ...d, stale: true }));
		const merged = mergeDiagnostics(stale, localDiagnostics(s, buildIndex(s)));
		expect(merged.map((d) => [d.source, d.stale])).toEqual([
			['engine', true],
			['value', false],
		]);
		expect(run(text, [err]).merged.map((d) => d[0])).toEqual(['engine']);
	});
});
