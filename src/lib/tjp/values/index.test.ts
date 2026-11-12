// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createTimeZoneHost } from '../../../engine/runtime';
import {
	KEYWORD_VALUE_KIND,
	checkValue,
	keepOrPrint,
	parseValue,
	printValue,
	projectContext,
	sameValue,
	utcSeconds,
	type TypedValue,
	type ValueKind,
} from './index';

const parsed = (kind: ValueKind, text: string): TypedValue => {
	const r = parseValue(kind, text);
	if (!r.ok) throw new Error(`${kind} ${text}: ${r.error.code}`);
	return r.value;
};

const SAMPLES: ReadonlyArray<readonly [ValueKind, string, string]> = [
	['duration', '5 d', '5d'],
	['date', '2026-1-5-9:00', '2026-01-05-09:00'],
	['interval', '2026-01-05-2026-01-09', '2026-01-05 - 2026-01-09'],
	['intervals', '2026-01-05,2026-02-01 +1w', '2026-01-05, 2026-02-01 +1w'],
	['number', '.5', '0.5'],
	['integer', '0500', '500'],
	['string', "'x'", '"x"'],
	['id', 'ana', 'ana'],
	['idList', 'ana,bob', 'ana, bob'],
	['taskRef', '! !a.b', '!!a.b'],
	['scheduling', 'alap', 'alap'],
	['workinghours', 'mon-fri 9:00-17:00', 'mon - fri 9:00 - 17:00'],
	['leaves', 'holiday "x" 2026-11-26+2d', 'holiday "x" 2026-11-26 +2d'],
	['vacation', '"x" 2026-02-23', '"x" 2026-02-23'],
	['timingresolution', '015 min', '15min'],
];

describe('parseValue and printValue', () => {
	it.each(SAMPLES)('%s: %s prints as %s and means the same', (kind, text, canon) => {
		const v = parsed(kind, text);
		expect(v.kind).toBe(kind);
		expect(printValue(v)).toEqual({ ok: true, value: canon });
		expect(sameValue(parsed(kind, canon), v)).toBe(true);
	});

	it('refuses other scheduling words', () => {
		expect(parseValue('scheduling', 'asapx')).toMatchObject({
			ok: false,
			error: { code: 'unexpected-token' },
		});
	});

	it('tells different values apart', () => {
		expect(sameValue(parsed('duration', '5d'), parsed('duration', '5.0d'))).toBe(false);
		expect(sameValue(parsed('duration', '5d'), parsed('number', '5'))).toBe(false);
		expect(sameValue(parsed('idList', 'a, b'), parsed('idList', 'b, a'))).toBe(false);
	});
});

describe('keepOrPrint', () => {
	it("keeps the user's spelling when the value is unchanged", () => {
		expect(keepOrPrint('5 d', parsed('duration', '5d'))).toEqual({
			ok: true,
			value: { text: '5 d', changed: false },
		});
		expect(keepOrPrint("'Ana'", parsed('string', '"Ana"'))).toEqual({
			ok: true,
			value: { text: "'Ana'", changed: false },
		});
		expect(keepOrPrint('2026-1-5', parsed('date', '2026-01-05-00:00'))).toMatchObject({
			value: { changed: false },
		});
		// The value has `\n`; the file keeps its own line breaks.
		expect(keepOrPrint('"a\r\nb"', parsed('string', '"a\nb"'))).toEqual({
			ok: true,
			value: { text: '"a\r\nb"', changed: false },
		});
	});

	it('writes canonical text when the value changes', () => {
		expect(keepOrPrint('5 d', parsed('duration', '6d'))).toEqual({
			ok: true,
			value: { text: '6d', changed: true },
		});
		expect(keepOrPrint(null, parsed('duration', '6d'))).toEqual({
			ok: true,
			value: { text: '6d', changed: true },
		});
		expect(keepOrPrint('${len}', parsed('duration', '6d'))).toMatchObject({
			value: { changed: true },
		});
	});
});

describe('checkValue', () => {
	const ctx = projectContext({
		start: utcSeconds({ year: 2026, month: 1, day: 5, hour: 0, minute: 0, second: 0 }),
		end: utcSeconds({ year: 2026, month: 3, day: 1, hour: 0, minute: 0, second: 0 }),
	});
	const span = { from: 7, to: 9 };

	it('runs the keyword checks and places errors on the span', () => {
		expect(checkValue('effort', parsed('duration', '5d'), ctx).ok).toBe(true);
		expect(checkValue('effort', parsed('duration', '0d'), ctx, span)).toMatchObject({
			ok: false,
			error: { tj: 'effort_zero', from: 7, to: 9 },
		});
		expect(checkValue('gapduration', parsed('duration', '30min'), ctx)).toMatchObject({
			ok: false,
		});
		expect(checkValue('start', parsed('date', '2026-04-01'), ctx)).toMatchObject({
			ok: false,
			error: { tj: 'date_in_range' },
		});
		expect(checkValue('now', parsed('date', '2026-04-01'), ctx).ok).toBe(true);
		expect(checkValue('complete', parsed('number', '101'), ctx)).toMatchObject({
			ok: false,
			error: { tj: 'task_complete' },
		});
		expect(checkValue('priority', parsed('integer', '1001'), ctx)).toMatchObject({
			ok: false,
			error: { tj: 'task_priority' },
		});
		expect(
			checkValue('leaves', parsed('leaves', 'holiday 2026-01-05 - 2026-01-05'), ctx),
		).toMatchObject({ ok: false });
		expect(checkValue('vacation', parsed('vacation', '2026-01-05 +0d'), ctx)).toMatchObject({
			ok: false,
		});
		expect(checkValue('interval', parsed('interval', '2026-01-05 +1d'), ctx).ok).toBe(true);
		expect(checkValue('note', parsed('string', '"x"'), ctx).ok).toBe(true);
	});

	it('maps every MVP keyword to a value kind', () => {
		for (const k of [
			'effort',
			'length',
			'duration',
			'start',
			'end',
			'now',
			'priority',
			'complete',
			'note',
			'flags',
			'workinghours',
			'leaves',
		]) {
			expect(KEYWORD_VALUE_KIND[k]).toBeDefined();
		}
	});
});

describe('project settings for T8 and T11', () => {
	const zones = createTimeZoneHost();
	it('validates timezone names as the browser engine does', () => {
		const ctx = projectContext({ zones });
		expect(checkValue('timezone', parsed('string', '"UTC"'), projectContext({})).ok).toBe(true);
		expect(checkValue('timezone', parsed('string', '"Europe/Berlin"'), ctx).ok).toBe(true);
		expect(
			checkValue('timezone', parsed('string', '"Mars/Olympus"'), ctx, { from: 9, to: 23 }),
		).toMatchObject({
			ok: false,
			error: { code: 'bad-zone', tj: 'bad_time_zone', from: 9, to: 23 },
		});
		expect(checkValue('timezone', parsed('string', '"EST"'), ctx)).toMatchObject({
			ok: false,
			error: { tj: 'bad_time_zone' },
		});
		expect(
			checkValue('timezone', parsed('string', '"Europe/Berlin"'), projectContext({})),
		).toMatchObject({
			ok: false,
			error: { code: 'zone-data' },
		});
		expect(checkValue('note', parsed('string', '"EST"'), ctx).ok).toBe(true);
	});

	it('reads timingresolution and yearlyworkingdays', () => {
		expect(KEYWORD_VALUE_KIND['timingresolution']).toBe('timingresolution');
		expect(KEYWORD_VALUE_KIND['yearlyworkingdays']).toBe('number');
		expect(parseValue('timingresolution', '15min')).toMatchObject({
			ok: true,
			value: { value: 15 },
		});
		expect(parseValue('timingresolution', '15h')).toMatchObject({
			ok: false,
			error: { code: 'bad-unit' },
		});
		expect(parseValue('timingresolution', '1.5min')).toMatchObject({
			ok: false,
			error: { code: 'unexpected-token' },
		});
		const ctx = projectContext({});
		expect(checkValue('timingresolution', parsed('timingresolution', '30min'), ctx).ok).toBe(true);
		expect(checkValue('timingresolution', parsed('timingresolution', '7min'), ctx)).toMatchObject({
			ok: false,
			error: { tj: 'bad_timing_res' },
		});
		expect(printValue({ kind: 'timingresolution', value: 7 }).ok).toBe(false);
		// The zone in force caps it (Project.maxScheduleGranularity): +05:45 allows 15 min.
		const kathmandu = projectContext({ zone: 'Asia/Kathmandu', zones: createTimeZoneHost() });
		expect(
			checkValue('timingresolution', parsed('timingresolution', '30min'), kathmandu, {
				from: 3,
				to: 8,
			}),
		).toMatchObject({
			ok: false,
			error: { tj: 'too_large_timing_res', from: 3, to: 8, args: { max: 15 } },
		});
		expect(checkValue('timingresolution', parsed('timingresolution', '15min'), kathmandu).ok).toBe(
			true,
		);
		expect(parseValue('number', '260')).toMatchObject({
			ok: true,
			value: { value: { value: 260, float: false } },
		});
	});
});
