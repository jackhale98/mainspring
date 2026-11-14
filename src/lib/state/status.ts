// SPDX-License-Identifier: GPL-2.0-or-later
import type { EngineState } from '../../engine/client';
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
import type { EngineVersions, Minutes } from '../../engine/protocol';
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
	/** The engine's version and the last run's timings (phase-2.md 9.4), or null before either. */
	readonly engine: EngineInfo | null;
}

/** One line of the engine details: a label and its value. */
export interface InfoLine {
	readonly label: string;
	readonly value: string;
}

/**
 * What the strip says about the engine. `version` is "TaskJuggler 3.8.4"; `last` is the total of
 * the newest run ("182 ms") and `timings` its parts, in the order of the pipeline. Both are null
 * until there is something to say. `versions` lists what the bundle is made of.
 */
export interface EngineInfo {
	readonly version: string | null;
	readonly last: string | null;
	readonly timings: readonly InfoLine[];
	/** Says that the round trip is not all scheduling; null when there are no timings. */
	readonly note: string | null;
	readonly versions: readonly InfoLine[];
}

/** "0.4 ms", "12 ms", "1.2 s": a time for reading, not for computing with. */
export function formatMs(ms: number, locale?: string): string {
	const v = Math.max(0, ms);
	if (v >= 1000) {
		return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v / 1000)} s`;
	}
	const digits = v < 10 ? 1 : 0;
	return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v)} ms`;
}

const T = strings.status.timing;

function infoOf(
	timings: RunnerState['timings'],
	versions: EngineVersions | null,
	locale?: string,
): EngineInfo | null {
	if (!timings && !versions) return null;
	const e = timings?.engine;
	return {
		version: versions ? strings.status.engineVersion(versions.tj) : null,
		last: e ? formatMs(e.totalMs, locale) : null,
		timings:
			timings && e
				? [
						{ label: T.engine, value: formatMs(e.totalMs, locale) },
						{ label: T.writeFs, value: formatMs(e.writeFsMs, locale) },
						{ label: T.parse, value: formatMs(e.parseMs, locale) },
						{ label: T.schedule, value: formatMs(e.scheduleMs, locale) },
						{ label: T.serialize, value: formatMs(e.serializeMs, locale) },
						{ label: T.roundTrip, value: formatMs(timings.roundTripMs, locale) },
						{ label: T.process, value: formatMs(timings.processMs, locale) },
					]
				: [],
		note: timings && e ? strings.status.timingNote : null,
		versions: versions
			? [
					{ label: T.tj, value: versions.tj },
					{ label: T.commit, value: versions.tjCommit.slice(0, 7) },
					{ label: T.ruby, value: versions.rubyWasm },
					{ label: T.bundle, value: versions.bundleHash.slice(0, 12) },
				]
			: [],
	};
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

/**
 * Whether a run that has settled is said aloud. When the Gantt is on screen it already says what
 * a reschedule moved, so only the plain case stays quiet: an ok run with no warnings that follows
 * an ok run. Everything else is said: a problem or failure (every time), a warning, and an ok run
 * after a problem (the confirmation that it was fixed). `previous` is the kind of the run before,
 * or null for the first one.
 */
export function announcesRun(
	v: Pick<StatusView, 'kind' | 'warnings'>,
	previous: StatusKind | null,
	ganttShown: boolean,
): boolean {
	return !(ganttShown && v.kind === 'ok' && v.warnings === 0 && previous === 'ok');
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

export function statusView(
	s: RunnerState,
	locale?: string,
	versions: EngineVersions | null = null,
): StatusView {
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
		engine: infoOf(s.timings, versions, locale),
	};
}

/**
 * The shape the phone's status button wears: the ticking mark while the scheduler works, then a
 * circle (fine), a triangle (warnings only) or a diamond (errors, or the scheduler failed). The
 * shapes differ, not only the colours (WCAG 1.4.1). A failure outranks a run that is under way;
 * without a status yet the scheduler is still starting.
 */
export type StatusGlyph = 'busy' | 'ok' | 'warning' | 'error';

export function statusGlyph(
	v: Pick<StatusView, 'kind' | 'errors' | 'warnings' | 'failure'> | null,
	engine?: EngineState,
): StatusGlyph {
	// Before any plan has a status, the engine's own state decides: a failed engine is a diamond.
	if (!v) return engine === 'failed' ? 'error' : 'busy';
	if (v.failure !== null || v.kind === 'failed') return 'error';
	if (v.kind === 'booting' || v.kind === 'idle' || v.kind === 'scheduling') return 'busy';
	if (v.kind === 'errors' || v.errors > 0) return 'error';
	return v.warnings > 0 ? 'warning' : 'ok';
}
