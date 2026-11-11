// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The project settings a value's meaning depends on, as they stand at the value's position in
 * parse order (TaskJuggler applies `dailyworkinghours`, `workinghours`, `timingresolution` and
 * `timezone` as it reads them). The index (T8) builds one per position; values never look it up.
 *
 * Defaults are TaskJuggler's (Project.rb:80-106): 8.0 daily working hours, 260.714 yearly
 * working days, a 60 min timing resolution, Mon-Fri 9:00-17:00 (WorkingHours.rb:65-71, 40 h a
 * week) and UTC.
 */
import type { ZoneEnv, ZoneOffsets } from './civil';
import { float, type TjNumber } from './number';

export interface ProjectContext extends ZoneEnv {
	/** `dailyworkinghours`, as written (an Integer makes later conversions integer math). */
	readonly dailyWorkingHours: TjNumber;
	/** `yearlyworkingdays`, as written. */
	readonly yearlyWorkingDays: TjNumber;
	/** `WorkingHours#weeklyWorkingHours` of the project working hours: whole hours, rounded down. */
	readonly weeklyWorkingHours: number;
	/** `scheduleGranularity` in seconds (`timingresolution` × 60). */
	readonly granularity: number;
	/** Project start and end (epoch seconds), for TaskJuggler's range checks; null before the header. */
	readonly start: number | null;
	readonly end: number | null;
}

export const DEFAULT_CONTEXT: ProjectContext = {
	dailyWorkingHours: float(8),
	yearlyWorkingDays: float(260.714),
	weeklyWorkingHours: 40,
	granularity: 3600,
	zone: null,
	start: null,
	end: null,
};

/** A context with some settings changed; `zones` is passed through when given. */
export function projectContext(
	over: Partial<Omit<ProjectContext, 'zones'>> & { zones?: ZoneOffsets },
): ProjectContext {
	return { ...DEFAULT_CONTEXT, ...over };
}
