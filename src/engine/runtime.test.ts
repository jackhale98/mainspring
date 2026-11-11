// SPDX-License-Identifier: GPL-2.0-or-later
// The runtime's pure parts. Booting the real engine needs the built assets (npm run
// build:engine); engine/golden/run-wasm.mjs does that and runs every golden plan.
import { describe, expect, it } from 'vitest';
import { EngineFailure, toEngineError } from './failure';
import {
	bootEngine,
	createTimeZoneHost,
	installTimeZoneHost,
	parseBridgeReply,
	parseBundle,
} from './runtime';

const epoch = (iso: string): number => Date.parse(iso) / 1000;

function failureOf(fn: () => unknown): EngineFailure {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(EngineFailure);
		return error as EngineFailure;
	}
	throw new Error('expected an EngineFailure');
}

describe('createTimeZoneHost', () => {
	const tz = createTimeZoneHost();

	it.each([
		['Europe/Berlin', '2026-01-15T12:00:00Z', 3600],
		['Europe/Berlin', '2026-07-15T12:00:00Z', 7200],
		// The March change happens at 01:00 UTC.
		['Europe/Berlin', '2026-03-29T00:59:59Z', 3600],
		['Europe/Berlin', '2026-03-29T01:00:00Z', 7200],
		['Asia/Kathmandu', '2026-06-01T00:00:00Z', 20700],
		['Australia/Sydney', '2026-07-01T00:00:00Z', 36000],
		['Australia/Sydney', '2027-01-01T00:00:00Z', 39600],
		['America/New_York', '2026-11-16T12:00:00Z', -18000],
		['UTC', '2026-01-01T00:00:00Z', 0],
	])('gives the UTC offset of %s at %s', (zone, iso, offset) => {
		expect(tz.offset(zone, epoch(iso))).toBe(offset);
	});

	it('checks zone names with Intl', () => {
		expect(tz.valid('Europe/Berlin')).toBe(true);
		expect(tz.valid('Mars/Olympus_Mons')).toBe(false);
	});

	it('installs itself as tjTz on a target', () => {
		const target: { tjTz?: unknown } = {};
		installTimeZoneHost(target);
		expect(typeof (target.tjTz as { offset: unknown }).offset).toBe('function');
	});
});

describe('parseBridgeReply', () => {
	it('returns a ScheduleResult-shaped reply', () => {
		expect(parseBridgeReply('{"ok":true,"tasks":[]}')).toEqual({ ok: true, tasks: [] });
	});

	it.each([
		['invalid-request', 'invalid-request'],
		['internal', 'internal'],
		['crash', 'crash'],
		['something-new', 'internal'],
	])('turns bridge error kind %s into %s', (kind, expected) => {
		const json = JSON.stringify({ error: { kind, message: 'm', detail: 'd' } });
		const failure = failureOf(() => parseBridgeReply(json));
		expect([failure.kind, failure.message, failure.detail]).toEqual([expected, 'm', 'd']);
	});

	it('rejects invalid JSON and non-objects as internal', () => {
		expect(failureOf(() => parseBridgeReply('{')).kind).toBe('internal');
		expect(failureOf(() => parseBridgeReply('[1]')).kind).toBe('internal');
	});
});

describe('parseBundle', () => {
	it('returns the files of a schema 1 bundle', () => {
		const text = JSON.stringify({ files: { '/tj/a.rb': 'x' }, schemaVersion: 1 });
		expect(parseBundle(text)).toEqual({ '/tj/a.rb': 'x' });
	});

	it('rejects other schemas and non-text files as boot errors', () => {
		expect(failureOf(() => parseBundle('{"files":{},"schemaVersion":2}')).kind).toBe('boot');
		const binary = JSON.stringify({ files: { '/tj/a': 1 }, schemaVersion: 1 });
		expect(failureOf(() => parseBundle(binary)).kind).toBe('boot');
	});
});

describe('bootEngine', () => {
	it('fails with kind boot when the manifest cannot be loaded', async () => {
		const error: unknown = await bootEngine({
			load: () => Promise.reject(new Error('HTTP 404')),
		}).catch((e: unknown) => e);
		expect(toEngineError(error)).toMatchObject({ kind: 'boot', detail: 'Error: HTTP 404' });
	});
});

describe('toEngineError', () => {
	it('keeps the kind, message and detail of an EngineFailure', () => {
		expect(toEngineError(new EngineFailure('invalid-request', 'bad', 'why'))).toEqual({
			kind: 'invalid-request',
			message: 'bad',
			detail: 'why',
		});
		expect(toEngineError(new EngineFailure('internal', 'x'))).toEqual({ kind: 'internal', message: 'x' });
	});

	it('maps wasm traps and RangeErrors to crash, other errors to the fallback', () => {
		expect(toEngineError(new WebAssembly.RuntimeError('memory access out of bounds')).kind).toBe('crash');
		expect(toEngineError(new RangeError('Maximum call stack size exceeded')).kind).toBe('crash');
		expect(toEngineError(new Error('x')).kind).toBe('internal');
		expect(toEngineError('x', 'boot')).toMatchObject({ kind: 'boot', detail: 'x' });
	});
});
