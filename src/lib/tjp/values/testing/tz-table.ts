// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test-only loader for engine/golden/tz-edge-cases.json, the time-zone edge cases that native
 * TaskJuggler and the browser engine are both checked against (engine/golden/tz-edges.mjs):
 * local times at DST and other offset changes with their UTC instants, and each zone's cap on
 * `timingresolution`. Not imported by application code.
 */
import { readFileSync } from 'node:fs';
import type { CivilFields } from '../civil';

export interface TzEdgeCase {
	readonly zone: string;
	/** TaskJuggler date text, `YYYY-MM-DD-hh:mm`. */
	readonly local: string;
	/** ISO 8601 UTC with seconds. */
	readonly utc: string;
	readonly kind: 'gap' | 'overlap' | 'before' | 'after' | 'plain';
}

export interface TzResolutionCase {
	readonly zone: string;
	readonly maxMinutes: number;
	readonly note?: string;
}

const FILE = new URL('../../../../../engine/golden/tz-edge-cases.json', import.meta.url);

export const TZ_TABLE = JSON.parse(readFileSync(FILE, 'utf8')) as {
	readonly cases: readonly TzEdgeCase[];
	readonly resolutions: readonly TzResolutionCase[];
};

/** The fields of a case's `local` text. */
export function caseFields(c: TzEdgeCase): CivilFields {
	const [year, month, day, hour, minute] = c.local.split(/[-:]/).map(Number) as [
		number,
		number,
		number,
		number,
		number,
	];
	return { year, month, day, hour, minute, second: 0 };
}

/** A case's instant in epoch seconds. */
export function caseEpoch(c: TzEdgeCase): number {
	return Date.parse(c.utc) / 1000;
}
