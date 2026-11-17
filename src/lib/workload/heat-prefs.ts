// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The heatmap's preferences, per plan, in `localStorage` (phase-3.md 6.7, 18.3; ADR-0008 #3): the
 * zoom (day, week or month), the unit (hours or percent), the two thresholds and the collapsed
 * groups. One JSON value under one key; every field that is missing or not what it should be falls
 * back to its default, so a value written by another version, or by hand, never breaks the view.
 * UI preferences only: no plan text is ever stored. Reads and writes go through state/storage.ts, so
 * blocked or full storage means "defaults".
 */
import { readPref, writePref, type PrefStorage } from '../state/storage';
import { DEFAULT_THRESHOLDS, type BucketKind, type Thresholds } from './types';

export type HeatUnit = 'hours' | 'percent';

export interface HeatPrefs {
	readonly zoom: BucketKind;
	readonly unit: HeatUnit;
	readonly thresholds: Thresholds;
	/** Groups whose members are hidden, by resource id. */
	readonly collapsed: readonly string[];
}

export const ZOOMS: readonly BucketKind[] = ['day', 'week', 'month'];
export const UNITS: readonly HeatUnit[] = ['hours', 'percent'];
export const DEFAULT_HEAT_ZOOM: BucketKind = 'week';
export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 500;

export const DEFAULT_HEAT_PREFS: HeatPrefs = {
	zoom: DEFAULT_HEAT_ZOOM,
	unit: 'hours',
	thresholds: DEFAULT_THRESHOLDS,
	collapsed: [],
};

export const heatKey = (plan: string): string => `mainspring.workload.${plan}`;

/** Both thresholds are percentages in range, and spare is not above over. */
export function validThresholds(t: Thresholds): boolean {
	const ok = (n: number): boolean => Number.isFinite(n) && n >= THRESHOLD_MIN && n <= THRESHOLD_MAX;
	return ok(t.spareBelow) && ok(t.overAbove) && t.spareBelow <= t.overAbove;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** The preferences a stored string holds, field by field, with defaults for the rest. */
export function parseHeatPrefs(raw: string | null): HeatPrefs {
	if (raw === null) return DEFAULT_HEAT_PREFS;
	let v: unknown;
	try {
		v = JSON.parse(raw);
	} catch {
		return DEFAULT_HEAT_PREFS;
	}
	if (!isRecord(v)) return DEFAULT_HEAT_PREFS;
	const zoom = ZOOMS.find((z) => z === v['zoom']) ?? DEFAULT_HEAT_ZOOM;
	const unit = UNITS.find((u) => u === v['unit']) ?? 'hours';
	const t = isRecord(v['thresholds']) ? v['thresholds'] : null;
	const candidate: Thresholds = {
		spareBelow: typeof t?.['spareBelow'] === 'number' ? t['spareBelow'] : NaN,
		overAbove: typeof t?.['overAbove'] === 'number' ? t['overAbove'] : NaN,
	};
	const thresholds = validThresholds(candidate) ? candidate : DEFAULT_THRESHOLDS;
	const list = v['collapsed'];
	const collapsed = Array.isArray(list)
		? list.filter((x): x is string => typeof x === 'string').slice(0, 1000)
		: [];
	return { zoom, unit, thresholds, collapsed };
}

export function readHeatPrefs(storage: PrefStorage | null, plan: string): HeatPrefs {
	return parseHeatPrefs(readPref(storage, heatKey(plan)));
}

export function writeHeatPrefs(storage: PrefStorage | null, plan: string, p: HeatPrefs): void {
	writePref(storage, heatKey(plan), JSON.stringify(p));
}
