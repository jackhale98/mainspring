// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Health settings per plan in `localStorage` (phase-3.md 6.4, 18.8; ADR-0008 #3, ADR-0014 #6): the
 * long-gap and long-task thresholds and which checks are on, like the Workload's view and the
 * Gantt's zoom (workload/prefs.ts, gantt/prefs.ts). UI preferences only: no plan text is stored.
 * Every read and write goes through state/storage.ts, so blocked or full storage means "no
 * preference" and the defaults apply.
 *
 * Read field by field: a value that is missing, of the wrong type or out of range keeps its
 * default, and the rest of what is stored still applies. Thresholds are whole or fractional days
 * from 0 to `MAX_DAYS`.
 */
// T11: what is stored is only what differs from the defaults, so a later change of a default
// (18.8) reaches every plan whose user never changed that setting.
import { readPref, writePref, type PrefStorage } from '../state/storage';
import { CHECK_IDS, DEFAULT_HEALTH_SETTINGS, type CheckId, type HealthSettings } from './types';

export const healthKey = (plan: string): string => `mainspring.health.${plan}`;

/** The largest threshold kept, in days (a stored value above it is ignored). */
export const MAX_DAYS = 3650;

const days = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_DAYS ? v : null;

/** The settings a stored value gives, with defaults for whatever it does not give. */
export function parseHealthSettings(raw: string | null): HealthSettings {
	const d = DEFAULT_HEALTH_SETTINGS;
	let v: unknown = null;
	try {
		v = raw === null ? null : JSON.parse(raw);
	} catch {
		v = null;
	}
	const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
	const on =
		typeof o['enabled'] === 'object' && o['enabled'] !== null
			? (o['enabled'] as Record<string, unknown>)
			: {};
	const enabled = {} as Record<CheckId, boolean>;
	for (const c of CHECK_IDS) {
		const x = on[c];
		enabled[c] = typeof x === 'boolean' ? x : d.enabled[c];
	}
	return {
		longGapDays: days(o['longGapDays']) ?? d.longGapDays,
		longTaskDays: days(o['longTaskDays']) ?? d.longTaskDays,
		enabled,
	};
}

/** What `writeHealthSettings` stores: only the differences from the defaults. */
export function serializeHealthSettings(s: HealthSettings): string {
	const d = DEFAULT_HEALTH_SETTINGS;
	const out: {
		longGapDays?: number;
		longTaskDays?: number;
		enabled?: Partial<Record<CheckId, boolean>>;
	} = {};
	if (s.longGapDays !== d.longGapDays && days(s.longGapDays) !== null)
		out.longGapDays = s.longGapDays;
	if (s.longTaskDays !== d.longTaskDays && days(s.longTaskDays) !== null)
		out.longTaskDays = s.longTaskDays;
	const enabled: Partial<Record<CheckId, boolean>> = {};
	for (const c of CHECK_IDS) if (s.enabled[c] !== d.enabled[c]) enabled[c] = s.enabled[c];
	if (Object.keys(enabled).length > 0) out.enabled = enabled;
	return JSON.stringify(out);
}

export function readHealthSettings(storage: PrefStorage | null, plan: string): HealthSettings {
	return parseHealthSettings(readPref(storage, healthKey(plan)));
}

export function writeHealthSettings(
	storage: PrefStorage | null,
	plan: string,
	s: HealthSettings,
): void {
	writePref(storage, healthKey(plan), serializeHealthSettings(s));
}

/** The settings with one check turned on or off. */
export function withCheck(s: HealthSettings, check: CheckId, on: boolean): HealthSettings {
	return { ...s, enabled: { ...s.enabled, [check]: on } };
}

/** The defaults, as a fresh object (for "Reset to defaults"). */
export function defaultHealthSettings(): HealthSettings {
	return parseHealthSettings(null);
}
