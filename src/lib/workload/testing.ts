// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Builders for the workload tests: resource results and bookings without an engine, on top of
 * schedule/testing.ts (a frame from Monday 2026-01-05 00:00 UTC with Mon-Fri 09:00-17:00 working
 * time), and an index from inline plan text, so a hand-made result can be read with the rows the
 * text declares.
 */
import type {
	BookingResult,
	Minutes,
	ResourceLeaves,
	ResourceResult,
	ScheduleResult,
} from '../../engine/protocol';
import { buildIndex, type SymbolIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';

export interface ResourceSpec {
	parent?: string;
	group?: boolean;
	/** Null (the default) means the project's working time. */
	workingTime?: Array<[Minutes, Minutes]> | null;
	leaves?: ResourceLeaves[];
	efficiency?: number;
	/** More scenarios than 'plan', with the same data. */
	scenarios?: string[];
}

export function resourceResult(id: string, s: ResourceSpec = {}): ResourceResult {
	const group = s.group ?? false;
	const data = {
		efficiency: s.efficiency ?? 1,
		workingTime: group ? [] : (s.workingTime ?? null),
		leaves: group ? [] : (s.leaves ?? []),
	};
	const scenarios: ResourceResult['scenarios'] = {};
	for (const sc of ['plan', ...(s.scenarios ?? [])]) scenarios[sc] = { ...data };
	return { id, name: id, parent: s.parent ?? null, source: null, group, scenarios };
}

export function booking(
	resource: string,
	task: string,
	intervals: Array<[Minutes, Minutes]>,
	scenario = 'plan',
): BookingResult {
	return { scenario, resource, task, intervals };
}

/** The result with these resources and bookings. */
export function withPeople(
	r: ScheduleResult,
	resources: ResourceResult[],
	bookings: BookingResult[],
): ScheduleResult {
	return { ...r, resources, bookings };
}

/** The symbol index of an inline plan (no engine hints: the text names everything). */
export function indexOf(text: string): SymbolIndex {
	return buildIndex(inline({ 'plan.tjp': text }).snapshot(), undefined, { cache: null });
}
