// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the status strip and the Plan summary show (phase-1.md 8.2), computed from the runner's
 * state as plain data: the scheduler's state, the finish date in the project's time zone and its
 * change since the previous good run, the problem counts, and the messages that have no place
 * in the text (`precision: 'none'`, listed apart because the editor cannot mark them).
 *
 * The finish date is the last good run's. When the newest outcome is not that run (`outdated`:
 * errors or a failed run), the view dims it and adds a "last good" label; the colour stays at
 * full contrast, because dimming by opacity would fail WCAG 1.4.3.
 */
import type { Minutes } from '../../engine/protocol';
import { formatFinish } from '../schedule/finish';
import { strings } from '../strings';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import type { RunnerState } from '../workspace/schedule-runner';

export type StatusKind = 'booting' | 'idle' | 'scheduling' | 'ok' | 'errors' | 'failed';

export interface StatusView {
	readonly kind: StatusKind;
	/** The short state line ("Scheduled", "Scheduling…"). */
	readonly label: string;
	/** Date and time of the finish, or null before the first good schedule. */
	readonly finish: string | null;
	/** The time zone the finish is shown in. */
	readonly zone: string | null;
	/** "2 days later", or null when there is no change or no previous run. */
	readonly delta: string | null;
	/** True when the finish is not from the newest outcome. */
	readonly outdated: boolean;
	readonly errors: number;
	readonly warnings: number;
	readonly counts: string;
	/** Diagnostics that no text position can show, in order. */
	readonly unlocated: readonly TjpDiagnostic[];
	/** Why the scheduler failed, or null. */
	readonly failure: string | null;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * 60;

/** "3 days", "5 hours" or "20 minutes" for a span of minutes (the sign is ignored). */
export function formatSpan(minutes: Minutes, locale?: string): string {
	const m = Math.abs(minutes);
	const [unit, value] =
		m >= MINUTES_PER_DAY
			? (['day', m / MINUTES_PER_DAY] as const)
			: m >= MINUTES_PER_HOUR
				? (['hour', m / MINUTES_PER_HOUR] as const)
				: (['minute', m] as const);
	const rounded = Math.round(value * 10) / 10;
	return new Intl.NumberFormat(locale, {
		style: 'unit',
		unit,
		unitDisplay: 'long',
		maximumFractionDigits: 1,
	}).format(rounded);
}

/** "2 days later" or "5 hours earlier"; null for no change (or a change below a minute). */
export function formatDelta(delta: Minutes | null, locale?: string): string | null {
	if (delta === null || Math.abs(delta) < 1) return null;
	const span = formatSpan(delta, locale);
	return delta > 0 ? strings.status.later(span) : strings.status.earlier(span);
}

function kindOf(s: RunnerState): StatusKind {
	if (s.engine === 'booting' && s.latest === null) return 'booting';
	return s.status;
}

/** The state line: "errors" is split by whether the latest run produced a schedule at all. */
function labelOf(s: RunnerState, kind: StatusKind): string {
	if (kind === 'errors' && s.latest && !s.latest.result.ok) return strings.status.notScheduled;
	return LABELS[kind];
}

const LABELS: Record<StatusKind, string> = {
	booting: strings.status.engineStarting,
	idle: strings.status.idle,
	scheduling: strings.status.scheduling,
	ok: strings.status.ok,
	errors: strings.status.errors,
	failed: strings.status.failed,
};

export function statusView(s: RunnerState, locale?: string): StatusView {
	const finish = s.finish;
	const failure = s.failure ? strings.engine.failure[s.failure.error.kind] : null;
	return {
		kind: kindOf(s),
		label: labelOf(s, kindOf(s)),
		finish: finish ? formatFinish(finish, locale) : null,
		zone: finish ? (finish.timezone ?? 'UTC') : null,
		delta: finish ? formatDelta(finish.delta, locale) : null,
		outdated: s.outdated,
		errors: s.counts.errors,
		warnings: s.counts.warnings,
		counts: strings.status.counts(s.counts.errors, s.counts.warnings),
		unlocated: s.diagnostics.filter((d) => d.precision === 'none'),
		failure: s.status === 'failed' || s.engine === 'failed' ? (failure ?? LABELS.failed) : null,
	};
}
