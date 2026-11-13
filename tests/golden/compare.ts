// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Golden comparison (phase-0 spec 6.3): string equality of canonical JSON over everything in
 * the golden's `result`; only `revision` and `timings` of the worker result are left out. A
 * mismatch is reported as per-path lines, with minute values also shown as ISO times.
 *
 * Schema v2 (phase-2 spec 5.3): a golden recorded for another result schema fails with one line
 * that says so, instead of a diff of every field the schemas do not share.
 */
import { GOLDEN_SCHEMA_VERSION, diffPaths, minutesToIso } from '../../engine/golden/lib.mjs';
import type { ScheduleResult } from '../../src/engine/protocol';
import { canonicalJson } from './canonical';

/** The part of a golden file the comparison needs (see GoldenFile in spec 3.4). */
export interface GoldenLike {
	id?: string;
	/** GoldenFile.schemaVersion; when present it must be GOLDEN_SCHEMA_VERSION. */
	schemaVersion?: number;
	result: Omit<ScheduleResult, 'revision' | 'timings'>;
}

export interface Comparison {
	ok: boolean;
	/** Per-path differences, empty when `ok`. At most `limit` lines. */
	diffs: string[];
}

/** A worker result without the fields that are never compared. */
export function comparable(result: ScheduleResult): Omit<ScheduleResult, 'revision' | 'timings'> {
	const { revision: _revision, timings: _timings, ...rest } = result;
	return rest;
}

const DIFF_LINE = /^(\/.*?): expected (.*), got (.*)$/;
/** Paths whose values are instants in minutes: task dates, booking and working-time bounds. */
const MINUTE_PATH = /\/(?:start|end|(?:intervals|workingTime)\/\d+\/\d+)$/;

function isMinute(text: string): boolean {
	return text === 'null' || /^-?\d+$/.test(text);
}

/** Adds the ISO time of start, end, booking and working-time values to a `diffPaths` line. */
export function annotateMinutes(line: string, projectStart: string | null): string {
	const m = DIFF_LINE.exec(line);
	if (!m || projectStart === null || !MINUTE_PATH.test(m[1] ?? '')) return line;
	const [, path = '', expected = '', actual = ''] = m;
	if (!isMinute(expected) || !isMinute(actual)) return line;
	const iso = (text: string): string =>
		minutesToIso(projectStart, text === 'null' ? null : Number(text)) ?? 'null';
	return `${path}: expected ${expected} (${iso(expected)}), got ${actual} (${iso(actual)})`;
}

/** Compares a worker result with a golden. Revision and timings of the result are ignored. */
export function compareWithGolden(
	golden: GoldenLike,
	result: ScheduleResult,
	limit = 20,
): Comparison {
	if (golden.schemaVersion !== undefined && golden.schemaVersion !== GOLDEN_SCHEMA_VERSION) {
		return {
			ok: false,
			diffs: [
				`/schemaVersion: the golden is schema ${golden.schemaVersion}, the engine writes ` +
					`${GOLDEN_SCHEMA_VERSION}; re-record it (npm run golden:record)`,
			],
		};
	}
	const actual = comparable(result);
	if (canonicalJson(actual) === canonicalJson(golden.result)) return { ok: true, diffs: [] };
	const expectedTree: unknown = JSON.parse(canonicalJson(golden.result));
	const actualTree: unknown = JSON.parse(canonicalJson(actual));
	const start = golden.result.project?.start ?? null;
	const diffs = (diffPaths(expectedTree, actualTree, '', [], limit) as string[]).map((line) =>
		annotateMinutes(line, start),
	);
	// The canonical texts differ, so there is at least one difference to show.
	return { ok: false, diffs: diffs.length > 0 ? diffs : ['/: results differ'] };
}
